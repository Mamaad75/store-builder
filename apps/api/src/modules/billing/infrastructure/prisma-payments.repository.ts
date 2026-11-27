import { GATEWAY_CASH_MAX_TOMAN, GATEWAY_CASH_MIN_TOMAN, MAX_WALLET_TOMAN, REFERRAL_PERCENT, nextPeriod, percentOf, quotePurchase } from "@store-builder/shared/modules/billing/billing";
import { db } from "../../../lib/db.js";
import type { BeginPurchase, BeginTopup, PaymentRow, PaymentsRepository, SettleResult } from "../application/payment-ports.js";
import { lockWallets, moveWallet, recordInTx, writeAudit, type Tx } from "./prisma-billing.repository.js";

// The other file of the billing module that reaches the database. A payment's wallet part is taken when it opens and given back if it never succeeds, all under the wallet lock.

const TX = { timeout: 15_000, maxWait: 10_000 } as const;
const prismaCode = (e: unknown) => (typeof e === "object" && e !== null ? (e as { code?: unknown }).code : undefined);

type Row = NonNullable<Awaited<ReturnType<typeof db.platformPayment.findUnique>>>;
const row = (p: Row): PaymentRow => ({
  id: p.id, storeId: p.storeId, userId: p.userId, purpose: p.purpose, planId: p.planId, planName: p.planName, priceToman: p.priceToman, discountToman: p.discountToman, heldToman: p.heldToman,
  amountToman: p.amountToman, status: p.status, sandbox: p.sandbox, authority: p.authority, refId: p.refId, createdAt: p.createdAt, paidAt: p.paidAt,
});

/** Locks one payment row for the rest of the transaction and returns it fresh. */
async function lockPayment(tx: Tx, id: string): Promise<Row | null> {
  await tx.$queryRaw`SELECT "id" FROM "PlatformPayment" WHERE "id" = ${id} FOR UPDATE`;
  return tx.platformPayment.findUnique({ where: { id } });
}

export class PrismaPaymentsRepository implements PaymentsRepository {
  beginPurchase(i: { storeId: string; userId: string; planId: string; useWallet: boolean; sandbox: boolean; gatewayReady: boolean; now: Date }): Promise<BeginPurchase> {
    const { storeId, now } = i;
    return db
      .$transaction(async (tx) => {
        const store = await tx.store.findUnique({ where: { id: storeId }, select: { id: true } });
        if (!store) return "no_store" as const;
        const p = await tx.plan.findUnique({ where: { id: i.planId } });
        if (!p) return "no_plan" as const;
        if (!p.active) return "plan_inactive" as const;
        // Settled entirely by the wallet (or free): done now, in the same transaction as the check.
        const done = await recordInTx(tx, storeId, p, { useWallet: i.useWallet, note: "خرید توسط فروشنده", onlyIfCovered: true }, now, { actorId: i.userId, action: "platform.self_purchase", targetType: "store", targetId: storeId });
        if (done !== "needs_payment") return { kind: "activated" as const, result: done };
        if (!i.gatewayReady) return "gateway_unavailable" as const;
        if (await tx.platformPayment.findFirst({ where: { storeId, status: "CREATED" }, select: { id: true } })) return "open_exists" as const;
        const ref = await tx.referral.findUnique({ where: { referredStoreId: storeId } });
        const balances = await lockWallets(tx, [storeId], now);
        const q = quotePurchase({ price: p.priceToman, invited: ref?.status === "PENDING", walletBalance: balances.get(storeId)!, useWallet: i.useWallet });
        if (q.cash < GATEWAY_CASH_MIN_TOMAN || q.cash > GATEWAY_CASH_MAX_TOMAN) return "cash_out_of_range" as const;
        const payment = await tx.platformPayment.create({
          data: { storeId, userId: i.userId, purpose: "PURCHASE", planId: p.id, planName: p.name, durationDays: p.durationDays, priceToman: q.price, discountToman: q.discount, heldToman: q.walletUsed, amountToman: q.cash, sandbox: i.sandbox, createdAt: now },
        });
        if (q.walletUsed > 0) await moveWallet(tx, storeId, balances.get(storeId)!, -q.walletUsed, "PURCHASE", p.name, payment.id, now);
        return { kind: "opened" as const, payment: row(payment), quote: q };
      }, TX)
      .catch((e) => {
        if (prismaCode(e) === "P2002") return "open_exists" as const; // two simultaneous starts: the unique index lets one through
        throw e;
      });
  }

  beginTopup(i: { storeId: string; userId: string; amountToman: number; sandbox: boolean; now: Date }): Promise<BeginTopup> {
    return db
      .$transaction(async (tx) => {
        if (!(await tx.store.findUnique({ where: { id: i.storeId }, select: { id: true } }))) return "no_store" as const;
        const balance = (await lockWallets(tx, [i.storeId], i.now)).get(i.storeId)!;
        if (await tx.platformPayment.findFirst({ where: { storeId: i.storeId, status: "CREATED" }, select: { id: true } })) return "open_exists" as const;
        if (balance + i.amountToman > MAX_WALLET_TOMAN) return "wallet_full" as const;
        const payment = await tx.platformPayment.create({ data: { storeId: i.storeId, userId: i.userId, purpose: "TOPUP", amountToman: i.amountToman, sandbox: i.sandbox, createdAt: i.now } });
        return { kind: "opened" as const, payment: row(payment) };
      }, TX)
      .catch((e) => {
        if (prismaCode(e) === "P2002") return "open_exists" as const;
        throw e;
      });
  }

  async attachAuthority(id: string, authority: string): Promise<void> {
    await db.platformPayment.updateMany({ where: { id, authority: null, status: "CREATED" }, data: { authority } });
  }

  release(id: string, status: "FAILED" | "EXPIRED", now: Date): Promise<boolean> {
    return db.$transaction(async (tx) => {
      const head = await tx.platformPayment.findUnique({ where: { id }, select: { storeId: true } });
      if (!head) return false;
      const balance = (await lockWallets(tx, [head.storeId], now)).get(head.storeId)!; // wallet first, then the payment row: the order settle() uses too
      const p = await lockPayment(tx, id);
      if (!p || p.status !== "CREATED") return false;
      await tx.platformPayment.update({ where: { id }, data: { status, updatedAt: now } });
      if (p.heldToman > 0) {
        await moveWallet(tx, p.storeId, balance, Math.min(p.heldToman, MAX_WALLET_TOMAN - balance), "REFUND", p.planName ?? "", p.id, now);
      }
      return true;
    }, TX);
  }

  settle(id: string, paid: { refId: string; cardPan: string | null }, now: Date): Promise<SettleResult> {
    return db.$transaction(async (tx) => {
      const head = await tx.platformPayment.findUnique({ where: { id }, select: { storeId: true } });
      if (!head) return { kind: "missing" as const };
      const storeId = head.storeId;
      const ref = await tx.referral.findUnique({ where: { referredStoreId: storeId } });
      // wallets first (the order every money transaction uses), then the payment row
      const balances = await lockWallets(tx, ref ? [storeId, ref.referrerStoreId] : [storeId], now);
      const p = await lockPayment(tx, id);
      if (!p) return { kind: "missing" as const };
      if (p.status === "PAID" || p.status === "LATE_CREDITED") return { kind: "already" as const, payment: row(p) };
      const stamp = { refId: paid.refId.slice(0, 40), cardPan: paid.cardPan, paidAt: now, updatedAt: now };
      const balance = balances.get(storeId)!;

      if (p.status !== "CREATED") {
        // Paid after the payment was closed (its held credit is already back): the money is not lost, it becomes wallet credit.
        const credit = Math.min(p.amountToman, MAX_WALLET_TOMAN - balance);
        if (credit > 0) await moveWallet(tx, storeId, balance, credit, "TOPUP", "پرداخت دیرهنگام", p.id, now);
        const done = await tx.platformPayment.update({ where: { id }, data: { status: "LATE_CREDITED", ...stamp } });
        await writeAudit(tx, { actorId: p.userId, action: "platform.payment_late_credited", targetType: "store", targetId: storeId, metadata: { amountToman: p.amountToman, creditedToman: credit } });
        return { kind: "late" as const, payment: row(done) };
      }

      if (p.purpose === "TOPUP") {
        const credit = Math.min(p.amountToman, MAX_WALLET_TOMAN - balance); // the start refused anything that would not fit; a race with a reward can only cut it
        if (credit > 0) await moveWallet(tx, storeId, balance, credit, "TOPUP", "شارژ از درگاه", p.id, now);
        const done = await tx.platformPayment.update({ where: { id }, data: { status: "PAID", ...stamp } });
        await writeAudit(tx, { actorId: p.userId, action: "platform.wallet_topup", targetType: "store", targetId: storeId, metadata: { amountToman: p.amountToman, creditedToman: credit } });
        return { kind: "paid" as const, payment: row(done) };
      }

      // A plan: granted from what the payment recorded when it opened; the wallet part was taken then.
      const plan = { id: p.planId!, name: p.planName!, priceToman: p.priceToman, durationDays: p.durationDays! };
      const fresh = ref ? await tx.referral.findUnique({ where: { id: ref.id } }) : null;
      const sub = await tx.storeSubscription.findUnique({ where: { storeId } });
      const period = nextPeriod(sub?.endsAt ?? null, now, plan.durationDays);
      const purchase = await tx.subscriptionPurchase.create({
        data: { storeId, planId: plan.id, planName: plan.name, priceToman: p.priceToman, discountToman: p.discountToman, walletUsedToman: p.heldToman, cashToman: p.amountToman, periodStart: period.startsAt, periodEnd: period.endsAt, note: "پرداخت از درگاه", recordedById: p.userId, paymentId: p.id, createdAt: now },
      });
      await tx.storeSubscription.upsert({
        where: { storeId },
        create: { storeId, planId: plan.id, planName: plan.name, startsAt: period.startsAt, endsAt: period.endsAt, updatedAt: now },
        update: { planId: plan.id, planName: plan.name, startsAt: sub && sub.endsAt.getTime() > now.getTime() ? sub.startsAt : period.startsAt, endsAt: period.endsAt, updatedAt: now },
      });
      let credited = 0;
      if (fresh && fresh.status === "PENDING" && p.priceToman > 0) {
        const refBalance = balances.get(fresh.referrerStoreId)!;
        credited = Math.max(0, Math.min(percentOf(p.priceToman - p.discountToman, REFERRAL_PERCENT), MAX_WALLET_TOMAN - refBalance));
        if (credited > 0) await moveWallet(tx, fresh.referrerStoreId, refBalance, credited, "REFERRAL_REWARD", "", fresh.id, now);
        await tx.referral.update({ where: { id: fresh.id }, data: { status: "REWARDED", rewardToman: credited, rewardedAt: now, purchaseId: purchase.id } });
      }
      const done = await tx.platformPayment.update({ where: { id }, data: { status: "PAID", ...stamp } });
      await writeAudit(tx, { actorId: p.userId, action: "platform.self_purchase", targetType: "store", targetId: storeId, metadata: { planId: plan.id, priceToman: p.priceToman, discountToman: p.discountToman, walletUsedToman: p.heldToman, cashToman: p.amountToman, rewardToman: credited } });
      return { kind: "paid" as const, payment: row(done) };
    }, TX);
  }

  async byAuthority(storeId: string, authority: string) {
    const p = await db.platformPayment.findFirst({ where: { storeId, authority } });
    return p ? row(p) : null;
  }

  async open(storeId: string) {
    const p = await db.platformPayment.findFirst({ where: { storeId, status: "CREATED" } });
    return p ? row(p) : null;
  }

  async recent(storeId: string, limit: number) {
    return (await db.platformPayment.findMany({ where: { storeId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit })).map(row);
  }

  async due(olderThan: Date, now: Date, limit: number, backoffMs: number) {
    const found = await db.platformPayment.findMany({ where: { status: "CREATED", createdAt: { lt: olderThan }, nextCheckAt: { lte: now } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: limit });
    for (const p of found) await db.platformPayment.update({ where: { id: p.id }, data: { checks: { increment: 1 }, nextCheckAt: new Date(now.getTime() + backoffMs) } });
    return found.map(row);
  }
}
