import { PAYMENT_OPEN_MINUTES, payPlanSchema, topupSchema, verifyPlatformPaymentSchema } from "@store-builder/shared/modules/billing/billing";
import { PaymentGatewayError } from "@store-builder/shared/modules/orders/errors";
import { NotFoundError, ValidationError } from "@store-builder/shared/modules/stores/errors";
import { GATEWAY_UNAVAILABLE_MESSAGE, PAYMENT_MESSAGES } from "../domain/billing.js";
import type { GatewayConfig, PaymentRow, PaymentsRepository, PlatformGateway } from "./payment-ports.js";
import type { PurchaseResult } from "./ports.js";

type Issues = { issues: { path: PropertyKey[]; message: string }[] };
function parse<T>(schema: { safeParse(v: unknown): { success: true; data: T } | { success: false; error: Issues } }, body: unknown): T {
  const r = schema.safeParse(body);
  if (r.success) return r.data;
  const out: Record<string, string[]> = {};
  for (const i of r.error.issues) (out[String(i.path[0] ?? "form")] ??= []).push(i.message);
  throw new ValidationError(out);
}

const MINUTE = 60_000;
/** A payment younger than this is left to the buyer (still at the bank): only the gateway's own "failed" after it, or an explicit "cancelled" return, closes it. */
const SETTLE_AFTER_MS = 2 * MINUTE;
const RECENT = 10;
const BACKOFF_MS = 5 * MINUTE;
const BATCH = 50;

export type StartResult = { status: "activated"; result: PurchaseResult } | { status: "redirect"; url: string; payment: PaymentRow };
export type ReturnOutcome = { outcome: "paid" | "failed" | "pending"; payment: PaymentRow };

/**
 * A store paying the PLATFORM through the gateway: a plan (wallet credit first, the rest from the gateway) or a wallet top-up. Nothing is granted on
 * the buyer's word: only a server-side verify with the platform's merchant id grants it, once (the settle transaction is idempotent), and a payment
 * that never succeeds gives its held wallet credit back.
 */
export class PlatformPaymentsService {
  constructor(
    private readonly repo: PaymentsRepository,
    private readonly gateway: PlatformGateway,
    private readonly config: GatewayConfig,
    /** The page the gateway sends the buyer back to (the store's own finance page). */
    private readonly returnUrl: (storeId: string) => string,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /** The finance page's facts: can the gateway be used, the open payment (settled or closed first when the gateway already knows), and the latest payments. */
  async summary(a: { storeId: string }) {
    const cfg = await this.config.current();
    const open = await this.repo.open(a.storeId);
    if (open) await this.resolve(open, cfg.merchantId, { minAgeMs: SETTLE_AFTER_MS });
    const [stillOpen, recent] = await Promise.all([open ? this.repo.open(a.storeId) : null, this.repo.recent(a.storeId, RECENT)]);
    return { gatewayReady: cfg.ready, open: stillOpen, recent };
  }

  /** Can a payment be opened now (the switch is on and the merchant id is set)? */
  async gatewayReady(): Promise<boolean> {
    return (await this.config.current()).ready;
  }

  /** Buy a plan: covered by the wallet = active at once; otherwise a gateway session for the rest. */
  async pay(a: { storeId: string; actorId: string }, body: unknown): Promise<StartResult> {
    const input = parse(payPlanSchema, body);
    const cfg = await this.config.current();
    await this.clearOpen(a.storeId, cfg.merchantId);
    const r = await this.repo.beginPurchase({ storeId: a.storeId, userId: a.actorId, planId: input.planId, useWallet: input.useWallet, sandbox: cfg.sandbox, gatewayReady: cfg.ready, now: this.clock() });
    if (r === "no_store") throw new NotFoundError();
    if (r === "no_plan") throw new ValidationError({ planId: [PAYMENT_MESSAGES.no_plan] });
    if (r === "plan_inactive") throw new ValidationError({ planId: [PAYMENT_MESSAGES.plan_inactive] });
    if (r === "open_exists") throw new ValidationError({ form: [PAYMENT_MESSAGES.open_exists] });
    if (r === "cash_out_of_range") throw new ValidationError({ form: [PAYMENT_MESSAGES.cash_out_of_range] });
    if (r === "gateway_unavailable") throw new ValidationError({ form: [GATEWAY_UNAVAILABLE_MESSAGE] });
    if (r.kind === "activated") return { status: "activated", result: r.result };
    return this.session(r.payment, cfg.merchantId);
  }

  /** Charge the wallet through the gateway. */
  async topup(a: { storeId: string; actorId: string }, body: unknown): Promise<StartResult> {
    const input = parse(topupSchema, body);
    const cfg = await this.config.current();
    if (!cfg.ready) throw new ValidationError({ form: [GATEWAY_UNAVAILABLE_MESSAGE] });
    await this.clearOpen(a.storeId, cfg.merchantId);
    const r = await this.repo.beginTopup({ storeId: a.storeId, userId: a.actorId, amountToman: input.amountToman, sandbox: cfg.sandbox, now: this.clock() });
    if (r === "no_store") throw new NotFoundError();
    if (r === "open_exists") throw new ValidationError({ form: [PAYMENT_MESSAGES.open_exists] });
    if (r === "wallet_full") throw new ValidationError({ amountToman: [PAYMENT_MESSAGES.wallet_full] });
    return this.session(r.payment, cfg.merchantId);
  }

  /** The buyer is back from the gateway. `OK` only triggers a server-side verify; `NOK` asks the gateway what really happened (a forged NOK cannot fail a real payment). */
  async returned(a: { storeId: string }, body: unknown): Promise<ReturnOutcome> {
    const { authority, status } = parse(verifyPlatformPaymentSchema, body);
    const p = await this.repo.byAuthority(a.storeId, authority);
    if (!p) throw new NotFoundError();
    if (p.status === "PAID" || p.status === "LATE_CREDITED") return { outcome: "paid", payment: p };
    const cfg = await this.config.current();
    let outcome = status === "OK" ? await this.verify(p, cfg.merchantId) : await this.resolve(p, cfg.merchantId, { minAgeMs: 0 });
    // The buyer left the gateway without paying and the gateway does not say "paid": closed now (the held credit returns). Should money still arrive for it, it is
    // credited to the wallet when it is verified (settle), so closing early can never lose it.
    if (status === "NOK" && outcome === "open" && (await this.repo.release(p.id, "FAILED", this.clock()))) outcome = "failed";
    return { outcome: outcome === "open" ? "pending" : outcome, payment: (await this.repo.byAuthority(a.storeId, authority)) ?? p };
  }

  /** The job: open payments nobody came back for are asked about; paid ones are granted, failed or too old ones closed and their wallet credit returned. */
  async reconcile(): Promise<{ checked: number; paid: number; closed: number }> {
    const now = this.clock();
    const cfg = await this.config.current();
    const list = await this.repo.due(new Date(now.getTime() - SETTLE_AFTER_MS), now, BATCH, BACKOFF_MS);
    let paid = 0;
    let closed = 0;
    for (const p of list) {
      const o = await this.resolve(p, cfg.merchantId, { minAgeMs: SETTLE_AFTER_MS });
      if (o === "paid") paid++;
      else if (o === "failed") closed++;
    }
    return { checked: list.length, paid, closed };
  }

  // ---- internals ----

  /** An older open payment is settled or closed first, so a new one can start; a young one is left alone (the buyer may be at the bank). */
  private async clearOpen(storeId: string, merchantId: string | null): Promise<void> {
    const open = await this.repo.open(storeId);
    if (open) await this.resolve(open, merchantId, { minAgeMs: SETTLE_AFTER_MS });
  }

  private async session(p: PaymentRow, merchantId: string | null): Promise<StartResult> {
    const r = merchantId
      ? await this.gateway.request({
          sandbox: p.sandbox, merchantId, amountRial: p.amountToman * 10, callbackUrl: this.returnUrl(p.storeId), orderRef: p.id, attemptRef: p.id, mobile: null,
          description: p.purpose === "TOPUP" ? "شارژ کیف پول" : `اشتراک ${p.planName ?? ""}`.trim(),
        })
      : ({ ok: false, code: null } as const);
    if (!r.ok) {
      await this.repo.release(p.id, "FAILED", this.clock()); // nothing was opened at the gateway: the held credit goes straight back
      throw new PaymentGatewayError();
    }
    await this.repo.attachAuthority(p.id, r.authority);
    return { status: "redirect", url: this.gateway.startUrl(p.sandbox, r.authority), payment: { ...p, authority: r.authority } };
  }

  /** Verify with the gateway (the amount is the stored one) and grant on success. */
  private async verify(p: PaymentRow, merchantId: string | null): Promise<"paid" | "failed" | "open"> {
    if (!merchantId || !p.authority) return "open";
    const v = await this.gateway.verify({ sandbox: p.sandbox, merchantId, amountRial: p.amountToman * 10, authority: p.authority });
    if (v.outcome === "paid") {
      const s = await this.repo.settle(p.id, { refId: v.refId, cardPan: v.cardPan }, this.clock());
      return s.kind === "missing" ? "open" : "paid";
    }
    if (v.outcome === "failed") return (await this.repo.release(p.id, "FAILED", this.clock())) ? "failed" : "open";
    // "not paid (yet)" or no answer: the buyer may still be paying; after the open window the payment is closed
    return this.tooOld(p) && v.outcome === "pending" ? ((await this.repo.release(p.id, "EXPIRED", this.clock())) ? "failed" : "open") : "open";
  }

  private tooOld(p: PaymentRow): boolean {
    return this.clock().getTime() - p.createdAt.getTime() > PAYMENT_OPEN_MINUTES * MINUTE;
  }

  /** Decide an open payment from what the gateway knows. */
  private async resolve(p: PaymentRow, merchantId: string | null, o: { minAgeMs: number }): Promise<"paid" | "failed" | "open"> {
    if (p.status !== "CREATED") return p.status === "PAID" || p.status === "LATE_CREDITED" ? "paid" : "failed";
    const age = this.clock().getTime() - p.createdAt.getTime();
    if (!p.authority) {
      // the session never opened (a crash between the two steps): nothing can be paid for it
      return age >= SETTLE_AFTER_MS && (await this.repo.release(p.id, "EXPIRED", this.clock())) ? "failed" : "open";
    }
    if (!merchantId) return "open";
    const q = this.gateway.inquiry ? (await this.gateway.inquiry({ sandbox: p.sandbox, merchantId, authority: p.authority })).status : "unknown";
    if (q === "PAID" || q === "VERIFIED") return this.verify(p, merchantId);
    if (q === "FAILED" || q === "REVERSED") return age >= o.minAgeMs && (await this.repo.release(p.id, "FAILED", this.clock())) ? "failed" : "open";
    // at the bank or no answer: after the open window one verify decides (it may have been paid)
    return this.tooOld(p) ? this.verify(p, merchantId) : "open";
  }
}
