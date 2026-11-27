import { Body, Controller, Get, HttpCode, Inject, Post, UseGuards } from "@nestjs/common";
import { SessionGuard } from "../../../auth/session.guard.js";
import { Audit, RequirePermission, StoreAccess, StoreAccessGuard, type StoreAccessContext } from "../../access/access.api.js";
import { StoreBillingService } from "../application/billing.service.js";
import { PlatformPaymentsService } from "../application/payments.service.js";
import { entryDto, paymentDto, planDto, purchaseDto, referralDto, subscriptionDto } from "./dto.js";

/**
 * The owner's finance pages (`billing.manage`: the owner only, like payout and secrets): subscription, wallet, referral. Reads work while the
 * store is suspended; entering a referral code is a write and is refused then.
 */
@Controller("stores/:storeId")
@UseGuards(SessionGuard, StoreAccessGuard)
export class StoreBillingController {
  constructor(
    @Inject(StoreBillingService) private readonly billing: StoreBillingService,
    @Inject(PlatformPaymentsService) private readonly payments: PlatformPaymentsService,
  ) {}

  @Get("billing")
  @RequirePermission("billing.manage")
  async overview(@StoreAccess() a: StoreAccessContext) {
    const [o, pay] = await Promise.all([this.billing.overview(a), this.payments.summary(a)]);
    return {
      gatewayReady: pay.gatewayReady,
      openPayment: pay.open ? paymentDto(pay.open) : null,
      payments: pay.recent.map(paymentDto), subscription: subscriptionDto(o.subscription), state: o.state, plans: o.plans.map(planDto), purchases: o.purchases.map(purchaseDto), referralDiscountPercent: o.referralDiscountPercent, limits: o.limits, free: o.free, usage: o.usage, walletToman: o.walletToman };
  }

  /** Buy a plan: the wallet first, the rest through the gateway. Active at once when the wallet covers it, otherwise the address to pay at. */
  @Post("billing/pay")
  @HttpCode(200)
  @RequirePermission("billing.manage")
  async pay(@StoreAccess() a: StoreAccessContext, @Body() body: unknown) {
    const r = await this.payments.pay(a, body);
    return r.status === "activated"
      ? { status: "activated" as const, purchase: purchaseDto(r.result.purchase), quote: r.result.quote, subscription: subscriptionDto(r.result.subscription)! }
      : { status: "redirect" as const, url: r.url, payment: paymentDto(r.payment) };
  }

  @Post("billing/topup")
  @HttpCode(200)
  @RequirePermission("billing.manage")
  async topup(@StoreAccess() a: StoreAccessContext, @Body() body: unknown) {
    const r = await this.payments.topup(a, body);
    if (r.status !== "redirect") throw new Error("a top-up always goes through the gateway");
    return { status: "redirect" as const, url: r.url, payment: paymentDto(r.payment) };
  }

  /** The buyer is back from the gateway (the page posts what the address carried). Only the server's own verify grants anything. */
  @Post("billing/payments/verify")
  @HttpCode(200)
  @RequirePermission("billing.manage")
  async verify(@StoreAccess() a: StoreAccessContext, @Body() body: unknown) {
    const r = await this.payments.returned(a, body);
    return { outcome: r.outcome, payment: paymentDto(r.payment) };
  }

  @Get("wallet")
  @RequirePermission("billing.manage")
  async wallet(@StoreAccess() a: StoreAccessContext) {
    const [w, gatewayReady] = await Promise.all([this.billing.wallet(a), this.payments.gatewayReady()]);
    return { balanceToman: w.balanceToman, entries: w.entries.map(entryDto), gatewayReady };
  }

  @Get("referral")
  @RequirePermission("billing.manage")
  async referral(@StoreAccess() a: StoreAccessContext) {
    const r = await this.billing.referral(a);
    return { code: r.code, percent: r.percent, referrals: r.referrals.map(referralDto), referredBy: r.referredBy ? referralDto(r.referredBy) : null };
  }

  @Post("referral/redeem")
  @HttpCode(204)
  @RequirePermission("billing.manage")
  @Audit("referral.redeemed")
  async redeem(@StoreAccess() a: StoreAccessContext, @Body() body: unknown): Promise<void> {
    await this.billing.redeem(a, body);
  }
}
