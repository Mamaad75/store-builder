import {
  MAX_ONLINE_TOMAN,
  MAX_PAYMENT_ATTEMPTS,
  ZARINPAL_MERCHANT_ID_RE,
  tomanToRial,
  verifyPaymentSchema,
} from "@store-builder/shared/modules/orders/orders";
import { OrderRateLimitedError, PaymentGatewayError, PaymentNotAllowedError, PaymentUnavailableError } from "@store-builder/shared/modules/orders/errors";
import { NotFoundError, ValidationError } from "@store-builder/shared/modules/stores/errors";
import { paymentDescription } from "../domain/orders.js";
import type { Limiter, OrderTokens, PaymentAttempt, PaymentConfig, PaymentGateway, PaymentStore } from "./ports.js";

/** An attempt is reconciled once it is this old (the buyer is usually back from the bank by then). */
const RECONCILE_AFTER_MS = 2 * 60_000;
/** A verification that has not finished in this long was interrupted (crash, timeout) and is resumed by the reconciler. */
const STALE_VERIFY_MS = 3 * 60_000;
/** Unpaid orders expire this long AFTER their payment deadline: a buyer who started paying just before it can still finish. */
export const EXPIRE_GRACE_MS = 15 * 60_000;
/** Starting a payment: per network per store (each start opens a gateway session). */
const PAY_START_RULE = { limit: 30, windowSeconds: 3600 } as const;
/** Coming back from the gateway: per network per store. */
const PAY_VERIFY_RULE = { limit: 60, windowSeconds: 3600 } as const;
/** Reconciler back-off for attempts still at the bank or unanswered: 1, 2, 4, 8, then every 10 minutes. */
const backoffMs = (checks: number) => Math.min(2 ** checks, 10) * 60_000;

/** refund = the money was captured but the order was no longer payable: the store returns it (the merchant sees REFUND_REQUIRED). */
export type ReturnOutcome = "paid" | "pending" | "failed" | "closed" | "refund";

/**
 * Online payment through Zarinpal (phase 3.5, D35-1; hardened by the 3.5 security review).
 *
 * - start: an AWAITING_PAYMENT order (before its deadline, fewer than MAX_PAYMENT_ATTEMPTS attempts) gets a new gateway session; the
 *   amount is the order's own total (never a client value), in rial. The session remembers which merchant id opened it (fingerprint) and
 *   the hash of a return key that only the paying browser holds (HttpOnly cookie).
 * - verify on return: Status=OK only TRIGGERS a server-side verify; it proves nothing. The attempt is claimed under the order lock (one
 *   verification per order at a time), marked "verify sent", verified with the stored amount and the merchant id it was opened with, then
 *   settled. Only a captured answer (100/101 with a reference) settles it as paid; only -50/-54 as failed; every other answer (including
 *   "not paid yet", -51, which a forged early return can provoke) leaves it open for the reconciler. A LOST answer keeps the "verify sent"
 *   mark: such an attempt may hold captured money, so it blocks cancelling and expiring the order until a definite answer arrives.
 * - the order link goes back only to the browser holding the return key, or to the order's own signed-in customer.
 * - reconcile: attempts nobody came back for are asked about (inquiry) with back-off; interrupted verifications are resumed; unpaid orders
 *   past deadline + grace are checked one last time and expire (stock back). An attempt that is never verified is refunded to the buyer by
 *   Zarinpal itself (auto_verify=false); captured money on an order no longer payable is recorded as REFUND_REQUIRED for the merchant.
 */
export class PaymentsService {
  constructor(
    private readonly store: PaymentStore,
    private readonly gateway: PaymentGateway,
    private readonly config: PaymentConfig,
    private readonly tokens: OrderTokens,
    private readonly limiter: Limiter,
    /** The store's own return address, e.g. https://label.example.com/checkout/payment/return (Zarinpal checks its domain: error -14). */
    private readonly callbackUrl: (label: string) => string,
    private readonly newId: () => string,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  private async merchant(storeId: string): Promise<{ merchantId: string; sandbox: boolean } | null> {
    const p = await this.config.platform();
    if (!p.enabled) return null;
    const id = await this.config.merchantId(storeId).catch(() => null);
    return id && ZARINPAL_MERCHANT_ID_RE.test(id) ? { merchantId: id, sandbox: p.sandbox } : null;
  }

  /** Whether this store can take online payments now (for the checkout page). */
  async available(storeId: string): Promise<boolean> {
    return (await this.merchant(storeId)) !== null;
  }

  /** Placing an ONLINE order: refused unless the store can take online payments and the amount is within Zarinpal's range. */
  async assertCanPay(storeId: string, totalToman: number): Promise<void> {
    if (!(await this.merchant(storeId))) throw new PaymentUnavailableError("off");
    if (totalToman > MAX_ONLINE_TOMAN || tomanToRial(totalToman) < 1000) throw new PaymentUnavailableError("amount");
  }

  private async limit(key: string, rule: { limit: number; windowSeconds: number }) {
    const r = await this.limiter.consume(key, rule);
    if (!r.allowed) throw new OrderRateLimitedError(r.retryAfterSeconds);
  }

  /** A new gateway session for the order: the address to send the buyer to, and the return key to give ONLY to this browser. */
  async start(storeId: string, label: string, orderId: string, ipKey: string): Promise<{ url: string; returnKey: string }> {
    await this.limit(`pay-start:${storeId}:ip:${ipKey}`, PAY_START_RULE);
    const m = await this.merchant(storeId);
    if (!m) throw new PaymentUnavailableError("off");
    const o = await this.store.orderForPayment(storeId, orderId);
    if (!o) throw new NotFoundError();
    const can = await this.store.canStart(storeId, orderId, this.clock(), MAX_PAYMENT_ATTEMPTS);
    if (can === "busy") throw new PaymentNotAllowedError("busy");
    if (can !== "ok") throw new PaymentNotAllowedError("closed");
    if (o.total > MAX_ONLINE_TOMAN) throw new PaymentUnavailableError("amount");
    const amountRial = tomanToRial(o.total);
    const r = await this.gateway.request({
      sandbox: m.sandbox,
      merchantId: m.merchantId,
      amountRial,
      description: paymentDescription(o.storeName, o.number),
      callbackUrl: this.callbackUrl(label),
      orderRef: String(o.number),
      mobile: /^\+989\d{9}$/.test(o.phone) ? `0${o.phone.slice(3)}` : /^09\d{9}$/.test(o.phone) ? o.phone : null, // Zarinpal: 09xxxxxxxxx
    });
    if (!r.ok) throw new PaymentGatewayError();
    // An authority from the wrong environment would never verify: refuse it now rather than send the buyer to a dead session.
    if (r.authority.startsWith("S") !== m.sandbox) throw new PaymentGatewayError();
    const rk = this.config.newReturnKey();
    // Checked again under the lock: a session opened meanwhile for a paid, expired or saturated order is never recorded nor verified.
    const recorded = await this.store.record(
      { id: this.newId(), storeId, orderId, sandbox: m.sandbox, authority: r.authority, amountRial, merchantFingerprint: this.config.fingerprint(m.merchantId), returnKeyHash: rk.hash },
      this.clock(),
      MAX_PAYMENT_ATTEMPTS,
    );
    if (recorded === "busy") throw new PaymentNotAllowedError("busy");
    if (recorded !== "ok") throw new PaymentNotAllowedError("closed");
    return { url: this.gateway.startUrl(m.sandbox, r.authority), returnKey: rk.key };
  }

  /**
   * The buyer is back from the gateway. Status=NOK changes nothing (the reconciler asks the gateway itself). The order link is answered
   * only to the browser holding this attempt's return key, or to the order's own signed-in customer (review 3.5: the authority travels in
   * URLs and is not a secret).
   */
  async verifyReturn(
    storeId: string,
    body: unknown,
    who: { ipKey: string; returnKey: string | null; customerId: string | null },
  ): Promise<{ outcome: ReturnOutcome; accessToken: string | null }> {
    const q = verifyPaymentSchema.safeParse(body);
    if (!q.success) throw new ValidationError({ authority: ["شناسه‌ی پرداخت نامعتبر است"] });
    await this.limit(`pay-verify:${storeId}:ip:${who.ipKey}`, PAY_VERIFY_RULE);
    const a = await this.store.byAuthority(storeId, q.data.authority);
    if (!a) throw new NotFoundError();
    const o = await this.store.orderForPayment(storeId, a.orderId);
    const keyHash = who.returnKey ? this.config.hashReturnKey(who.returnKey) : null;
    const bound = (keyHash !== null && keyHash === a.returnKeyHash) || (who.customerId !== null && o?.customerId === who.customerId && !o.linkedByPhone);
    const accessToken = bound ? this.tokens.tokenFor(a.orderId) : null;
    if (q.data.status === "NOK") {
      const outcome: ReturnOutcome =
        a.status === "PAID" ? "paid" : a.status === "REFUND_REQUIRED" ? "refund" : !o || o.status === "EXPIRED" || o.status === "CANCELLED" ? "closed" : o.status === "AWAITING_PAYMENT" ? "failed" : "paid";
      return { outcome, accessToken };
    }
    return { outcome: await this.verifyAttempt(storeId, q.data.authority), accessToken };
  }

  /** Claim -> verify -> settle. */
  private async verifyAttempt(storeId: string, authority: string): Promise<ReturnOutcome> {
    const now = this.clock();
    const c = await this.store.claim(storeId, authority, now, new Date(now.getTime() - STALE_VERIFY_MS));
    if (!c.ok) {
      const a = await this.store.byAuthority(storeId, authority);
      if (c.reason === "paid") {
        if (a?.status === "PAID") return "paid";
        if (a) await this.store.settleUnpaid(a.id, "EXPIRED", null); // never verified: Zarinpal refunds it (no-op if a verify answer was lost)
        return "paid";
      }
      if (c.reason === "closed") {
        if (a) await this.store.settleUnpaid(a.id, "EXPIRED", null);
        return "closed";
      }
      if (c.reason === "busy") return "pending";
      if (c.reason === "failed") return a?.status === "REFUND_REQUIRED" ? "refund" : a?.status === "EXPIRED" ? "closed" : "failed";
      throw new NotFoundError();
    }
    const a = c.attempt;
    const claimedAt = a.claimedAt!;
    const m = await this.config.merchantId(storeId).catch(() => null);
    // Only the merchant id that opened the session can verify it (review 3.5: a changed id must not turn into a "failed" payment).
    if (!m || this.config.fingerprint(m) !== a.merchantFingerprint) {
      await this.store.release(a.id, claimedAt, null, a.verifySentAt?.getTime() === claimedAt.getTime()); // nothing was sent this time
      return "pending";
    }
    const v = await this.gateway.verify({ sandbox: a.sandbox, merchantId: m, amountRial: a.amountRial, authority: a.authority });
    if (v.outcome === "paid") {
      const r = await this.store.settlePaid(a.id, claimedAt, { refId: v.refId, cardPan: v.cardPan, fee: v.fee, code: v.code }, this.clock());
      return r === "refund" ? "refund" : r === "placed" ? "paid" : "pending";
    }
    if (v.outcome === "failed") {
      await this.store.settleUnpaid(a.id, "FAILED", v.code, claimedAt);
      return "failed";
    }
    // An answer with a code settled nothing (e.g. -51 not paid yet): nothing was captured. No answer at all: keep the "verify sent" mark.
    await this.store.release(a.id, claimedAt, v.code ?? null, typeof v.code === "number");
    return v.code === -51 ? "failed" : "pending";
  }

  /** One open attempt, from the reconciler. */
  private async check(a: PaymentAttempt, now: Date): Promise<"paid" | "failed" | "expired" | "unclear"> {
    const o = await this.store.orderForPayment(a.storeId, a.orderId);
    if (o && o.status !== "AWAITING_PAYMENT" && a.verifySentAt === null && a.status === "CREATED") {
      await this.store.settleUnpaid(a.id, "EXPIRED", null); // paid by another attempt, cancelled or expired: never verified (refunded)
      return "expired";
    }
    if (a.status === "CREATED") {
      const m = await this.config.merchantId(a.storeId).catch(() => null);
      if (!m || this.config.fingerprint(m) !== a.merchantFingerprint) {
        await this.store.defer(a.id, new Date(now.getTime() + backoffMs(a.checks)));
        return "unclear";
      }
      const s = (await this.gateway.inquiry({ sandbox: a.sandbox, merchantId: m, authority: a.authority })).status;
      if (s === "FAILED" || s === "REVERSED") {
        await this.store.settleUnpaid(a.id, "FAILED", null);
        return "failed";
      }
      if (s !== "PAID" && s !== "VERIFIED") {
        await this.store.defer(a.id, new Date(now.getTime() + backoffMs(a.checks))); // IN_BANK (still paying) or no answer
        return "unclear";
      }
    }
    const r = await this.verifyAttempt(a.storeId, a.authority);
    return r === "paid" || r === "refund" ? "paid" : r === "failed" ? "failed" : r === "closed" ? "expired" : "unclear";
  }

  /**
   * The periodic job (scripts/reconcile-payments.ts). Works within `budgetMs` (the job is killed at 4 minutes), a few attempts at a time;
   * orders past deadline + grace get their own last check and expiry pass so a slow gateway cannot keep their stock held by itself.
   */
  async reconcile(o: { limit?: number; budgetMs?: number; concurrency?: number } = {}) {
    const limit = o.limit ?? 100;
    const now = this.clock();
    const stopAt = Date.now() + (o.budgetMs ?? 150_000);
    const out = { paid: 0, failed: 0, expiredAttempts: 0, expiredOrders: 0, unclear: 0 };
    const tally = (r: "paid" | "failed" | "expired" | "unclear") => void (r === "expired" ? out.expiredAttempts++ : out[r]++);
    const pool = async <T>(items: T[], f: (x: T) => Promise<void>, share: number) => {
      const until = Date.now() + (stopAt - Date.now()) * share;
      let i = 0;
      await Promise.all(Array.from({ length: Math.max(1, o.concurrency ?? 4) }, async () => {
        while (i < items.length && Date.now() < until) await f(items[i++]!);
      }));
    };

    // 1. orders past deadline + grace: their open attempts are checked one last time, then the order expires (unless money may be held)
    const before = new Date(now.getTime() - EXPIRE_GRACE_MS);
    await pool(await this.store.expirable(before, limit), async (e) => {
      try {
        for (const a of await this.store.openAttempts(e.storeId, e.orderId)) tally(await this.check(a, now).catch(() => "unclear" as const));
        if (await this.store.expire(e.storeId, e.orderId, before)) out.expiredOrders++;
      } catch {
        out.unclear++;
      }
    }, 0.4);

    // 2. every other attempt that is due
    const pending = await this.store.pending(now, new Date(now.getTime() - RECONCILE_AFTER_MS), new Date(now.getTime() - STALE_VERIFY_MS), limit);
    await pool(pending, async (a) => tally(await this.check(a, now).catch(() => "unclear" as const)), 1);
    return out;
  }

  /**
   * The merchant's view of online payment (no secret value, only whether one is set): the platform switch, sandbox mode, whether the
   * store's merchant id is set and well-formed, and the return address whose domain must be the one registered at Zarinpal.
   */
  async settingsView(storeId: string) {
    const p = await this.config.platform();
    const id = await this.config.merchantId(storeId).catch(() => null);
    const label = await this.store.labelOf(storeId);
    return {
      platformEnabled: p.enabled,
      sandbox: p.sandbox,
      secretsReady: this.config.secretsReady(),
      merchantConfigured: id !== null,
      merchantValid: id !== null && ZARINPAL_MERCHANT_ID_RE.test(id),
      active: p.enabled && id !== null && ZARINPAL_MERCHANT_ID_RE.test(id),
      callbackUrl: label ? this.callbackUrl(label) : null,
    };
  }

  /** The attempts of one order (merchant's order page): status, reference and masked card only. */
  attempts(storeId: string, orderId: string) {
    return this.store.forOrder(storeId, orderId);
  }
}
