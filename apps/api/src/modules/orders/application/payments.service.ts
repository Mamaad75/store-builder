import {
  GATEWAYS,
  GATEWAY_AUTO_REFUNDS,
  GATEWAY_CREDENTIAL_RE,
  UNVERIFIED_ATTEMPT_TTL_HOURS,
  GATEWAY_TOMAN_RANGE,
  MAX_PAYMENT_ATTEMPTS,
  tomanToRial,
  verifyPaymentSchema,
  type Gateway,
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
    /** D35c-1: every gateway the platform knows (a store uses those it has a credential for and the platform has switched on). */
    private readonly gateways: Readonly<Partial<Record<Gateway, PaymentGateway>>>,
    private readonly config: PaymentConfig,
    private readonly tokens: OrderTokens,
    private readonly limiter: Limiter,
    /** The store's own return address per gateway (each gateway checks its domain: Zarinpal -14, Aghaye Pardakht -15). */
    private readonly callbackUrl: (label: string, gateway: Gateway) => string,
    private readonly newId: () => string,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  private gw(g: Gateway): PaymentGateway {
    const x = this.gateways[g];
    if (!x) throw new PaymentUnavailableError("off");
    return x;
  }

  /** The store's credential for a gateway, when the platform has the gateway on and the credential is well-formed. */
  private async merchant(storeId: string, g: Gateway): Promise<{ merchantId: string; sandbox: boolean } | null> {
    const p = await this.config.platform();
    if (!p.enabled[g] || !this.gateways[g]) return null;
    const id = await this.config.credential(storeId, g).catch(() => null);
    return id && GATEWAY_CREDENTIAL_RE[g].test(id) ? { merchantId: id, sandbox: p.sandbox } : null;
  }

  /** The gateways this store can take payments through now (for the checkout page), in a fixed order. */
  async available(storeId: string): Promise<Gateway[]> {
    const out: Gateway[] = [];
    for (const g of GATEWAYS) if (await this.merchant(storeId, g)) out.push(g);
    return out;
  }

  /** Placing an ONLINE order: refused unless the store can take this gateway's payments and the amount is within the gateway's range. */
  async assertCanPay(storeId: string, totalToman: number, g: Gateway = "ZARINPAL"): Promise<void> {
    if (!(await this.merchant(storeId, g))) throw new PaymentUnavailableError("off");
    const [min, max] = GATEWAY_TOMAN_RANGE[g];
    if (totalToman < min || totalToman > max) throw new PaymentUnavailableError("amount");
  }

  private async limit(key: string, rule: { limit: number; windowSeconds: number }) {
    const r = await this.limiter.consume(key, rule);
    if (!r.allowed) throw new OrderRateLimitedError(r.retryAfterSeconds);
  }

  /** A new gateway session for the order: the address to send the buyer to, and the return key to give ONLY to this browser. */
  async start(storeId: string, label: string, orderId: string, ipKey: string): Promise<{ url: string; returnKey: string }> {
    await this.limit(`pay-start:${storeId}:ip:${ipKey}`, PAY_START_RULE);
    const o = await this.store.orderForPayment(storeId, orderId);
    if (!o) throw new NotFoundError();
    if (!o.gateway) throw new PaymentNotAllowedError("closed"); // not an online order
    const g = o.gateway;
    const m = await this.merchant(storeId, g);
    if (!m) throw new PaymentUnavailableError("off");
    const can = await this.store.canStart(storeId, orderId, this.clock(), MAX_PAYMENT_ATTEMPTS);
    if (can === "busy") throw new PaymentNotAllowedError("busy");
    if (can !== "ok") throw new PaymentNotAllowedError("closed");
    if (o.total < GATEWAY_TOMAN_RANGE[g][0] || o.total > GATEWAY_TOMAN_RANGE[g][1]) throw new PaymentUnavailableError("amount");
    const amountRial = tomanToRial(o.total);
    const attemptId = this.newId();
    const r = await this.gw(g).request({
      sandbox: m.sandbox,
      merchantId: m.merchantId,
      amountRial,
      description: paymentDescription(o.storeName, o.number),
      callbackUrl: this.callbackUrl(label, g),
      orderRef: String(o.number),
      attemptRef: attemptId.slice(0, 8),
      mobile: /^\+989\d{9}$/.test(o.phone) ? `0${o.phone.slice(3)}` : /^09\d{9}$/.test(o.phone) ? o.phone : null, // Zarinpal: 09xxxxxxxxx
    });
    if (!r.ok) throw new PaymentGatewayError();
    // A Zarinpal authority from the wrong environment would never verify: refuse it now rather than send the buyer to a dead session.
    if (g === "ZARINPAL" && r.authority.startsWith("S") !== m.sandbox) throw new PaymentGatewayError();
    const rk = this.config.newReturnKey();
    // Checked again under the lock: a session opened meanwhile for a paid, expired or saturated order is never recorded nor verified.
    const recorded = await this.store.record(
      { id: attemptId, storeId, orderId, provider: g, sandbox: m.sandbox, authority: r.authority, amountRial, merchantFingerprint: this.config.fingerprint(g, m.merchantId), returnKeyHash: rk.hash },
      this.clock(),
      MAX_PAYMENT_ATTEMPTS,
    );
    if (recorded === "busy") throw new PaymentNotAllowedError("busy");
    if (recorded !== "ok") throw new PaymentNotAllowedError("closed");
    return { url: this.gw(g).startUrl(m.sandbox, r.authority), returnKey: rk.key };
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
    if (!a || a.provider !== q.data.gateway) throw new NotFoundError();
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

  /** An attempt of a gateway that does not refund unverified payments may be closed unverified only once it is this old. */
  private mayCloseUnverified(a: PaymentAttempt, now: Date): boolean {
    return GATEWAY_AUTO_REFUNDS[a.provider] || now.getTime() - a.createdAt.getTime() > UNVERIFIED_ATTEMPT_TTL_HOURS * 3600_000;
  }

  /** Claim -> verify -> settle. */
  private async verifyAttempt(storeId: string, authority: string): Promise<ReturnOutcome> {
    const now = this.clock();
    const before = await this.store.byAuthority(storeId, authority);
    if (!before) throw new NotFoundError();
    // Review D35c-1: a gateway that does not refund unverified payments is verified even on a closed order (until the TTL).
    const force = !this.mayCloseUnverified(before, now);
    const c = await this.store.claim(storeId, authority, now, new Date(now.getTime() - STALE_VERIFY_MS), force);
    if (!c.ok) {
      const a = await this.store.byAuthority(storeId, authority);
      if (c.reason === "paid") {
        if (a?.status === "PAID") return "paid";
        if (a && this.mayCloseUnverified(a, now)) await this.store.settleUnpaid(a.id, "EXPIRED", null); // never verified: refunded by the gateway
        return "paid";
      }
      if (c.reason === "closed") {
        if (a && this.mayCloseUnverified(a, now)) await this.store.settleUnpaid(a.id, "EXPIRED", null);
        return "closed";
      }
      if (c.reason === "busy") return "pending";
      if (c.reason === "failed") return a?.status === "REFUND_REQUIRED" ? "refund" : a?.status === "EXPIRED" ? "closed" : "failed";
      throw new NotFoundError();
    }
    const a = c.attempt;
    const claimedAt = a.claimedAt!;
    // Review D35c-1: a sandbox session never places an order once the platform has left sandbox mode.
    if (a.sandbox && !(await this.config.platform()).sandbox) {
      await this.store.settleUnpaid(a.id, "FAILED", null, claimedAt);
      return "failed";
    }
    const m = await this.config.credential(storeId, a.provider).catch(() => null);
    // Only the credential that opened the session can verify it (review 3.5: a changed id must not turn into a "failed" payment).
    if (!m || this.config.fingerprint(a.provider, m) !== a.merchantFingerprint || !this.gateways[a.provider]) {
      await this.store.release(a.id, claimedAt, null, a.verifySentAt?.getTime() === claimedAt.getTime()); // nothing was sent this time
      return "pending";
    }
    const v = await this.gw(a.provider).verify({ sandbox: a.sandbox, merchantId: m, amountRial: a.amountRial, authority: a.authority });
    if (v.outcome === "paid") {
      const r = await this.store.settlePaid(a.id, claimedAt, { refId: v.refId, cardPan: v.cardPan, fee: v.fee, code: v.code }, this.clock());
      return r === "refund" ? "refund" : r === "placed" ? "paid" : "pending";
    }
    if (v.outcome === "failed") {
      await this.store.settleUnpaid(a.id, "FAILED", v.code, claimedAt);
      return "failed";
    }
    if (v.outcome === "pending") {
      // "Not paid (yet)" (Zarinpal -51, Aghaye Pardakht 0): nothing captured; the attempt stays open (a forged early return cannot fail it).
      await this.store.release(a.id, claimedAt, v.code, true);
      const o = await this.store.orderForPayment(storeId, a.orderId);
      return o && o.status !== "AWAITING_PAYMENT" ? "closed" : "failed";
    }
    // Any other answer (no answer, an unknown code) proves nothing either way: the "verify sent" mark stays (review D35c-1).
    await this.store.release(a.id, claimedAt, v.code ?? null, false);
    return "pending";
  }

  /** One open attempt, from the reconciler. */
  private async check(a: PaymentAttempt, now: Date): Promise<"paid" | "failed" | "expired" | "unclear"> {
    const o = await this.store.orderForPayment(a.storeId, a.orderId);
    if (o && o.status !== "AWAITING_PAYMENT" && a.verifySentAt === null && a.status === "CREATED" && this.mayCloseUnverified(a, now)) {
      await this.store.settleUnpaid(a.id, "EXPIRED", null); // paid by another attempt, cancelled or expired: never verified (refunded)
      return "expired";
    }
    const gateway = this.gateways[a.provider];
    if (a.status === "CREATED" && gateway?.inquiry) {
      const m = await this.config.credential(a.storeId, a.provider).catch(() => null);
      if (!m || this.config.fingerprint(a.provider, m) !== a.merchantFingerprint) {
        await this.store.defer(a.id, new Date(now.getTime() + backoffMs(a.checks)));
        return "unclear";
      }
      const s = (await gateway.inquiry({ sandbox: a.sandbox, merchantId: m, authority: a.authority })).status;
      if (s === "FAILED" || s === "REVERSED") {
        await this.store.settleUnpaid(a.id, "FAILED", null);
        return "failed";
      }
      if (s !== "PAID" && s !== "VERIFIED") {
        await this.store.defer(a.id, new Date(now.getTime() + backoffMs(a.checks))); // IN_BANK (still paying) or no answer
        return "unclear";
      }
    }
    // Gateways without an inquiry (Aghaye Pardakht) are verified directly: harmless when unpaid ("not paid" leaves the attempt open).
    const r = await this.verifyAttempt(a.storeId, a.authority);
    if (r === "failed" || r === "pending" || r === "closed") {
      const still = await this.store.byAuthority(a.storeId, a.authority);
      if (still?.status === "CREATED") {
        await this.store.defer(a.id, new Date(now.getTime() + backoffMs(a.checks)));
        return "unclear";
      }
    }
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
   * The merchant's view of online payment (no secret value, only whether one is set), per gateway: the platform switch, whether the
   * store's credential is set and well-formed, and the return address whose domain must be the one registered at the gateway.
   */
  async settingsView(storeId: string) {
    const p = await this.config.platform();
    const label = await this.store.labelOf(storeId);
    const gateways = [];
    for (const g of GATEWAYS) {
      const id = await this.config.credential(storeId, g).catch(() => null);
      const valid = id !== null && GATEWAY_CREDENTIAL_RE[g].test(id);
      gateways.push({
        gateway: g,
        platformEnabled: p.enabled[g] && Boolean(this.gateways[g]),
        configured: id !== null,
        valid,
        active: p.enabled[g] && Boolean(this.gateways[g]) && valid,
        callbackUrl: label ? this.callbackUrl(label, g) : null,
      });
    }
    return { sandbox: p.sandbox, secretsReady: this.config.secretsReady(), gateways };
  }

  /** The attempts of one order (merchant's order page): status, reference and masked card only. */
  attempts(storeId: string, orderId: string) {
    return this.store.forOrder(storeId, orderId);
  }
}
