import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, UseGuards } from "@nestjs/common";
import { SessionGuard } from "../../../auth/session.guard.js";
import type { SafeUser } from "../../../auth/ports.js";
import { CurrentUser } from "../../../http/current-user.js";
import { PlatformAdminGuard } from "../../platform/platform.api.js";
import { StaffBillingService } from "../application/billing.service.js";
import { entryDto, planDto, purchaseDto, referralDto, subscriptionDto } from "./dto.js";

/** `/api/platform/plans` and the per-store finance actions: platform staff only. Every change is audited. */
@Controller("platform")
@UseGuards(SessionGuard, PlatformAdminGuard)
export class PlatformBillingController {
  constructor(@Inject(StaffBillingService) private readonly staff: StaffBillingService) {}

  @Get("plans")
  async plans() {
    return (await this.staff.plans()).map(planDto);
  }

  @Post("plans")
  async createPlan(@CurrentUser() user: SafeUser, @Body() body: unknown) {
    return planDto(await this.staff.createPlan(user.id, body));
  }

  @Put("plans/:planId")
  async updatePlan(@CurrentUser() user: SafeUser, @Param("planId") id: string, @Body() body: unknown) {
    return planDto(await this.staff.updatePlan(user.id, id, body));
  }

  @Get("stores/:id/billing")
  async storeView(@Param("id") storeId: string) {
    const v = await this.staff.storeView(storeId);
    return {
      storeId: v.storeId,
      storeName: v.storeName,
      subscription: subscriptionDto(v.subscription),
      state: v.state,
      purchases: v.purchases.map(purchaseDto),
      wallet: { balanceToman: v.wallet.balanceToman, entries: v.wallet.entries.map(entryDto) },
      code: v.code,
      referrals: v.referrals.map(referralDto),
      referredBy: v.referredBy ? referralDto(v.referredBy) : null,
      plans: v.plans.map(planDto),
    };
  }

  @Post("stores/:id/purchases")
  async recordPurchase(@CurrentUser() user: SafeUser, @Param("id") storeId: string, @Body() body: unknown) {
    const r = await this.staff.recordPurchase(user.id, storeId, body);
    return { purchase: purchaseDto(r.purchase), quote: r.quote, subscription: subscriptionDto(r.subscription)! };
  }

  @Post("stores/:id/wallet-adjust")
  @HttpCode(200)
  async adjustWallet(@CurrentUser() user: SafeUser, @Param("id") storeId: string, @Body() body: unknown) {
    return this.staff.adjustWallet(user.id, storeId, body);
  }
}
