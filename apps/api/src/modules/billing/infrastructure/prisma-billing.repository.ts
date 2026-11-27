import { MAX_PLANS, MAX_WALLET_TOMAN, nextPeriod, quotePurchase, type PlanInput } from "@store-builder/shared/modules/billing/billing";
import { db } from "../../../lib/db.js";
import type { RedeemRefusal } from "../domain/billing.js";
import type { BillingRepository, EntryRow, PlanRow, PlatformAudit, PurchaseResult, PurchaseRow, ReferralRow, SubscriptionRow } from "../application/ports.js";

// The only file of the billing module that reaches the database. Money moves only here, inside one transaction, under the wallet row's lock.

const TX = { timeout: 15_000, maxWait: 10_000 } as const;
type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];
const prismaCode = (e: unknown) => (typeof e === "object" && e !== null ? (e as { code?: unknown }).code : undefined);

const plan = (p: { id: string; name: string; description: string; priceToman: number; durationDays: number; active: boolean; createdAt: Date }): PlanRow => ({ id: p.id, name: p.name, description: p.description, priceToman: p.priceToman, durationDays: p.durationDays, active: p.active, createdAt: p.createdAt });
const purchase = (p: PurchaseRow & Record<string, unknown>): PurchaseRow => ({ id: p.id, planName: p.planName, priceToman: p.priceToman, discountToman: p.discountToman, walletUsedToman: p.walletUsedToman, cashToman: p.cashToman, periodStart: p.periodStart, periodEnd: p.periodEnd, note: p.note, createdAt: p.createdAt });
const referral = (r: { id: string; status: "PENDING" | "REWARDED"; rewardToman: number; createdAt: Date; rewardedAt: Date | null }): ReferralRow => ({ id: r.id, status: r.status, rewardToman: r.rewardToman, createdAt: r.createdAt, rewardedAt: r.rewardedAt });

const audit = (tx: Tx, a: PlatformAudit) => tx.auditEvent.create({ data: { storeId: null, actorId: a.actorId, action: a.action, targetType: a.targetType, targetId: a.targetId, metadata: a.metadata as never } });

/** Makes the wallet row if the store has none, then locks the given wallets (in id order, so two stores can never wait on each other) and returns their balances. */
async function lockWallets(tx: Tx, storeIds: string[], now: Date): Promise<Map<string, number>> {
  const ids = [...new Set(storeIds)].sort();
  for (const id of ids) await tx.$executeRaw`INSERT INTO "StoreWallet" ("storeId", "balanceToman", "updatedAt") VALUES (${id}, 0, ${now}) ON CONFLICT ("storeId") DO NOTHING`;
  const out = new Map<string, number>();
  for (const id of ids) {
    const rows = await tx.$queryRaw<{ balanceToman: number }[]>`SELECT "balanceToman" FROM "StoreWallet" WHERE "storeId" = ${id} FOR UPDATE`;
    out.set(id, rows[0]!.balanceToman);
  }
  return out;
}

/** Applies a signed amount to a LOCKED wallet and writes its ledger line. The caller has checked the result stays within 0..MAX_WALLET_TOMAN. */
async function moveWallet(tx: Tx, storeId: string, balance: number, delta: number, kind: "REFERRAL_REWARD" | "PURCHASE" | "ADMIN_ADJUST", note: string, refId: string | null, now: Date): Promise<number> {
  const after = balance + delta;
  await tx.storeWallet.update({ where: { storeId }, data: { balanceToman: after, updatedAt: now } });
  await tx.walletEntry.create({ data: { storeId, amountToman: delta, balanceAfter: after, kind, note, refId, createdAt: now } });
  return after;
}

export class PrismaBillingRepository implements BillingRepository {
  constructor(private readonly newCode: () => string) {}

  async plans(activeOnly: boolean) {
    return (await db.plan.findMany({ where: activeOnly ? { active: true } : {}, orderBy: [{ priceToman: "asc" }, { createdAt: "asc" }] })).map(plan);
  }

  createPlan(input: PlanInput, now: Date, a: PlatformAudit): Promise<PlanRow | "limit"> {
    return db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('plans'))`; // two simultaneous creates cannot pass the limit together
      if ((await tx.plan.count()) >= MAX_PLANS) return "limit" as const;
      const p = await tx.plan.create({ data: { ...input, createdAt: now } });
      await audit(tx, { ...a, targetId: p.id });
      return plan(p);
    }, TX);
  }

  updatePlan(id: string, input: PlanInput, now: Date, a: PlatformAudit): Promise<PlanRow | null> {
    return db.$transaction(async (tx) => {
      if (!(await tx.plan.findUnique({ where: { id }, select: { id: true } }))) return null;
      const p = await tx.plan.update({ where: { id }, data: { ...input, updatedAt: now } });
      await audit(tx, a);
      return plan(p);
    }, TX);
  }

  async storeName(storeId: string) {
    return (await db.store.findUnique({ where: { id: storeId }, select: { name: true } }))?.name ?? null;
  }

  async subscription(storeId: string): Promise<SubscriptionRow | null> {
    const s = await db.storeSubscription.findUnique({ where: { storeId } });
    return s ? { planId: s.planId, planName: s.planName, startsAt: s.startsAt, endsAt: s.endsAt } : null;
  }

  async purchases(storeId: string, limit: number) {
    return (await db.subscriptionPurchase.findMany({ where: { storeId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit })).map(purchase);
  }

  async wallet(storeId: string, limit: number): Promise<{ balanceToman: number; entries: EntryRow[] }> {
    const [w, entries] = await Promise.all([db.storeWallet.findUnique({ where: { storeId }, select: { balanceToman: true } }), db.walletEntry.findMany({ where: { storeId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit })]);
    return { balanceToman: w?.balanceToman ?? 0, entries: entries.map((e) => ({ id: e.id, amountToman: e.amountToman, balanceAfter: e.balanceAfter, kind: e.kind, note: e.note, createdAt: e.createdAt })) };
  }

  async referralCode(storeId: string): Promise<string> {
    const have = await db.storeReferralCode.findUnique({ where: { storeId } });
    if (have) return have.code;
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        return (await db.storeReferralCode.create({ data: { storeId, code: this.newCode() } })).code;
      } catch (e) {
        if (prismaCode(e) !== "P2002") throw e;
        // either the code collided (try another) or this store just got its own from a simultaneous request (use it)
        const again = await db.storeReferralCode.findUnique({ where: { storeId } });
        if (again) return again.code;
      }
    }
    throw new Error("could not make a referral code");
  }

  async referralsMade(storeId: string, limit: number) {
    return (await db.referral.findMany({ where: { referrerStoreId: storeId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit })).map(referral);
  }

  async referredBy(storeId: string) {
    const r = await db.referral.findUnique({ where: { referredStoreId: storeId } });
    return r ? referral(r) : null;
  }

  redeem(storeId: string, code: string, now: Date): Promise<"ok" | RedeemRefusal> {
    return db.$transaction(async (tx) => {
      const found = await tx.storeReferralCode.findUnique({ where: { code }, select: { storeId: true, store: { select: { ownerId: true } } } });
      if (!found) return "unknown_code" as const;
      if (found.storeId === storeId) return "own_code" as const;
      const me = await tx.store.findUnique({ where: { id: storeId }, select: { ownerId: true } });
      if (!me) return "unknown_code" as const;
      if (me.ownerId === found.store.ownerId) return "same_owner" as const;
      // The same lock a purchase takes: the code cannot be accepted while a first purchase is being recorded.
      await lockWallets(tx, [storeId], now);
      if (await tx.referral.findUnique({ where: { referredStoreId: storeId }, select: { id: true } })) return "already" as const;
      if (await tx.subscriptionPurchase.findFirst({ where: { storeId, cashToman: { gt: 0 } }, select: { id: true } })) return "has_purchase" as const;
      if (await tx.subscriptionPurchase.findFirst({ where: { storeId, walletUsedToman: { gt: 0 } }, select: { id: true } })) return "has_purchase" as const;
      try {
        await tx.referral.create({ data: { referrerStoreId: found.storeId, referredStoreId: storeId, createdAt: now } });
      } catch (e) {
        if (prismaCode(e) === "P2002") return "already" as const;
        throw e;
      }
      return "ok" as const;
    }, TX);
  }

  recordPurchase(storeId: string, planId: string, o: { useWallet: boolean; note: string }, now: Date, a: Omit<PlatformAudit, "metadata">): Promise<PurchaseResult | "no_store" | "no_plan" | "plan_inactive"> {
    return db.$transaction(async (tx) => {
      if (!(await tx.store.findUnique({ where: { id: storeId }, select: { id: true } }))) return "no_store" as const;
      const p = await tx.plan.findUnique({ where: { id: planId } });
      if (!p) return "no_plan" as const;
      if (!p.active) return "plan_inactive" as const;
      const ref = await tx.referral.findUnique({ where: { referredStoreId: storeId } });
      // Lock this store's wallet (and the inviter's, in id order): the money of one purchase moves as one unit.
      const balances = await lockWallets(tx, ref ? [storeId, ref.referrerStoreId] : [storeId], now);
      const fresh = ref ? await tx.referral.findUnique({ where: { id: ref.id } }) : null; // re-read under the lock
      const invited = fresh?.status === "PENDING";
      const q = quotePurchase({ price: p.priceToman, invited, walletBalance: balances.get(storeId)!, useWallet: o.useWallet });

      const sub = await tx.storeSubscription.findUnique({ where: { storeId } });
      const period = nextPeriod(sub?.endsAt ?? null, now, p.durationDays);
      const row = await tx.subscriptionPurchase.create({
        data: { storeId, planId: p.id, planName: p.name, priceToman: q.price, discountToman: q.discount, walletUsedToman: q.walletUsed, cashToman: q.cash, periodStart: period.startsAt, periodEnd: period.endsAt, note: o.note, recordedById: a.actorId, createdAt: now },
      });
      const subscription = await tx.storeSubscription.upsert({
        where: { storeId },
        create: { storeId, planId: p.id, planName: p.name, startsAt: period.startsAt, endsAt: period.endsAt, updatedAt: now },
        update: { planId: p.id, planName: p.name, startsAt: sub && sub.endsAt.getTime() > now.getTime() ? sub.startsAt : period.startsAt, endsAt: period.endsAt, updatedAt: now },
      });
      if (q.walletUsed > 0) await moveWallet(tx, storeId, balances.get(storeId)!, -q.walletUsed, "PURCHASE", p.name, row.id, now);

      let rewardedStoreId: string | null = null;
      let credited = 0;
      if (invited && fresh && q.price > 0) {
        const referrerBalance = balances.get(fresh.referrerStoreId)!;
        // A full wallet cannot take the reward (it would break the ceiling): the reward is then cut to what fits. Never an error for the purchase.
        const reward = Math.min(q.reward, MAX_WALLET_TOMAN - referrerBalance);
        if (reward > 0) {
          await moveWallet(tx, fresh.referrerStoreId, referrerBalance, reward, "REFERRAL_REWARD", "", fresh.id, now);
          rewardedStoreId = fresh.referrerStoreId;
          credited = reward;
        }
        await tx.referral.update({ where: { id: fresh.id }, data: { status: "REWARDED", rewardToman: credited, rewardedAt: now, purchaseId: row.id } });
      }
      await audit(tx, { ...a, metadata: { planId: p.id, priceToman: q.price, discountToman: q.discount, walletUsedToman: q.walletUsed, cashToman: q.cash, rewardToman: credited, rewardedStoreId } });
      return { purchase: purchase(row), quote: q, subscription: { planId: subscription.planId, planName: subscription.planName, startsAt: subscription.startsAt, endsAt: subscription.endsAt }, rewardedStoreId };
    }, TX);
  }

  adjustWallet(storeId: string, amountToman: number, reason: string, now: Date, a: Omit<PlatformAudit, "metadata">): Promise<{ balanceToman: number } | "no_store" | "insufficient" | "too_much"> {
    return db.$transaction(async (tx) => {
      if (!(await tx.store.findUnique({ where: { id: storeId }, select: { id: true } }))) return "no_store" as const;
      const balance = (await lockWallets(tx, [storeId], now)).get(storeId)!;
      if (balance + amountToman < 0) return "insufficient" as const;
      if (balance + amountToman > MAX_WALLET_TOMAN) return "too_much" as const;
      const after = await moveWallet(tx, storeId, balance, amountToman, "ADMIN_ADJUST", reason, null, now);
      await audit(tx, { ...a, metadata: { amountToman, balanceAfter: after } });
      return { balanceToman: after };
    }, TX);
  }
}
