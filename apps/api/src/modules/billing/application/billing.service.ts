import { planInputSchema, purchaseInputSchema, redeemReferralSchema, REFERRAL_PERCENT, normalizeReferralCode, walletAdjustSchema } from "@store-builder/shared/modules/billing/billing";
import { NotFoundError, ValidationError } from "@store-builder/shared/modules/stores/errors";
import { INSUFFICIENT_MESSAGE, NO_PLAN_MESSAGE, PLAN_INACTIVE_MESSAGE, PLAN_LIMIT_MESSAGE, REDEEM_MESSAGES, WALLET_FULL_MESSAGE, stateOf } from "../domain/billing.js";
import type { BillingRepository } from "./ports.js";

const ID_RE = /^[a-z0-9]{1,64}$/;
type Issues = { issues: { path: PropertyKey[]; message: string }[] };
function parse<T>(schema: { safeParse(v: unknown): { success: true; data: T } | { success: false; error: Issues } }, body: unknown): T {
  const r = schema.safeParse(body);
  if (r.success) return r.data;
  const out: Record<string, string[]> = {};
  for (const i of r.error.issues) (out[String(i.path[0] ?? "form")] ??= []).push(i.message);
  throw new ValidationError(out);
}
const known = (id: string) => {
  if (!ID_RE.test(id)) throw new NotFoundError();
  return id;
};

const LIST = 20;
const LEDGER = 50;

/** The owner's finance pages of ONE store (the caller's, from the access guard). */
export class StoreBillingService {
  constructor(
    private readonly repo: BillingRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /** The current subscription and its state, the plans on sale, recent purchases, and the invitation discount still waiting. */
  async overview(a: { storeId: string }) {
    const now = this.clock();
    const [subscription, plans, purchases, referredBy, held, wallet] = await Promise.all([this.repo.subscription(a.storeId), this.repo.plans(true), this.repo.purchases(a.storeId, LIST), this.repo.referredBy(a.storeId), this.repo.limitsAndUsage(a.storeId, now), this.repo.wallet(a.storeId, 0)]);
    return { subscription, state: stateOf(subscription?.endsAt ?? null, now), plans, purchases, referralDiscountPercent: referredBy?.status === "PENDING" ? REFERRAL_PERCENT : 0, limits: held.limits, free: held.free, usage: held.usage, walletToman: wallet.balanceToman };
  }

  wallet(a: { storeId: string }) {
    return this.repo.wallet(a.storeId, LEDGER);
  }

  async referral(a: { storeId: string }) {
    const [code, made, referredBy] = await Promise.all([this.repo.referralCode(a.storeId), this.repo.referralsMade(a.storeId, LIST), this.repo.referredBy(a.storeId)]);
    return { code, percent: REFERRAL_PERCENT, referrals: made, referredBy };
  }

  async redeem(a: { storeId: string }, body: unknown): Promise<void> {
    const { code } = parse(redeemReferralSchema, body);
    const c = normalizeReferralCode(code);
    if (!c) throw new ValidationError({ code: [REDEEM_MESSAGES.unknown_code] });
    const r = await this.repo.redeem(a.storeId, c, this.clock());
    if (r !== "ok") throw new ValidationError({ code: [REDEEM_MESSAGES[r]] });
  }
}

/** The platform staff's side: plans, and recording what a store paid. */
export class StaffBillingService {
  constructor(
    private readonly repo: BillingRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  plans() {
    return this.repo.plans(false);
  }

  async createPlan(staffId: string, body: unknown) {
    const input = parse(planInputSchema, body);
    const r = await this.repo.createPlan(input, this.clock(), { actorId: staffId, action: "platform.plan_created", targetType: "plan", targetId: "", metadata: { name: input.name, priceToman: input.priceToman, durationDays: input.durationDays } });
    if (r === "limit") throw new ValidationError({ name: [PLAN_LIMIT_MESSAGE] });
    return r;
  }

  async updatePlan(staffId: string, id: string, body: unknown) {
    const input = parse(planInputSchema, body);
    const r = await this.repo.updatePlan(known(id), input, this.clock(), { actorId: staffId, action: "platform.plan_updated", targetType: "plan", targetId: id, metadata: { priceToman: input.priceToman, durationDays: input.durationDays, active: input.active } });
    if (!r) throw new NotFoundError();
    return r;
  }

  /** One store's money in one view: subscription, wallet and ledger, purchases, invitation. */
  async storeView(storeId: string) {
    const sid = known(storeId);
    const name = await this.repo.storeName(sid);
    if (!name) throw new NotFoundError();
    const now = this.clock();
    const [subscription, purchases, wallet, code, made, referredBy, plans] = await Promise.all([
      this.repo.subscription(sid), this.repo.purchases(sid, LEDGER), this.repo.wallet(sid, LEDGER), this.repo.referralCode(sid), this.repo.referralsMade(sid, LIST), this.repo.referredBy(sid), this.repo.plans(true),
    ]);
    return { storeId: sid, storeName: name, subscription, state: stateOf(subscription?.endsAt ?? null, now), purchases, wallet, code, referrals: made, referredBy, plans };
  }

  async recordPurchase(staffId: string, storeId: string, body: unknown) {
    const input = parse(purchaseInputSchema, body);
    const sid = known(storeId);
    const r = await this.repo.recordPurchase(sid, known(input.planId), { useWallet: input.useWallet, note: input.note }, this.clock(), { actorId: staffId, action: "platform.purchase_recorded", targetType: "store", targetId: sid });
    if (r === "no_store") throw new NotFoundError();
    if (r === "no_plan") throw new ValidationError({ planId: [NO_PLAN_MESSAGE] });
    if (r === "plan_inactive") throw new ValidationError({ planId: [PLAN_INACTIVE_MESSAGE] });
    return r;
  }

  async adjustWallet(staffId: string, storeId: string, body: unknown) {
    const input = parse(walletAdjustSchema, body);
    const sid = known(storeId);
    const r = await this.repo.adjustWallet(sid, input.amountToman, input.reason, this.clock(), { actorId: staffId, action: "platform.wallet_adjusted", targetType: "store", targetId: sid });
    if (r === "no_store") throw new NotFoundError();
    if (r === "insufficient") throw new ValidationError({ amountToman: [INSUFFICIENT_MESSAGE] });
    if (r === "too_much") throw new ValidationError({ amountToman: [WALLET_FULL_MESSAGE] });
    return r;
  }
}
