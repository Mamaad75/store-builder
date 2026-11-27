import { Body, Controller, Get, HttpCode, Inject, Post, UseGuards } from "@nestjs/common";
import { SessionGuard } from "../../../auth/session.guard.js";
import { Audit, RequirePermission, StoreAccess, StoreAccessGuard, type StoreAccessContext } from "../../access/access.api.js";
import { StoreBillingService } from "../application/billing.service.js";
import { entryDto, planDto, purchaseDto, referralDto, subscriptionDto } from "./dto.js";

/**
 * The owner's finance pages (`billing.manage`: the owner only, like payout and secrets): subscription, wallet, referral. Reads work while the
 * store is suspended; entering a referral code is a write and is refused then.
 */
@Controller("stores/:storeId")
@UseGuards(SessionGuard, StoreAccessGuard)
export class StoreBillingController {
  constructor(@Inject(StoreBillingService) private readonly billing: StoreBillingService) {}

  @Get("billing")
  @RequirePermission("billing.manage")
  async overview(@StoreAccess() a: StoreAccessContext) {
    const o = await this.billing.overview(a);
    return { subscription: subscriptionDto(o.subscription), state: o.state, plans: o.plans.map(planDto), purchases: o.purchases.map(purchaseDto), referralDiscountPercent: o.referralDiscountPercent };
  }

  @Get("wallet")
  @RequirePermission("billing.manage")
  async wallet(@StoreAccess() a: StoreAccessContext) {
    const w = await this.billing.wallet(a);
    return { balanceToman: w.balanceToman, entries: w.entries.map(entryDto) };
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
