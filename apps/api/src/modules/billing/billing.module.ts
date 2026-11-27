import { Module } from "@nestjs/common";
import { StaffBillingService, StoreBillingService } from "./application/billing.service.js";
import { createStaffBillingService, createStoreBillingService } from "./infrastructure/compose.js";
import { PlatformBillingController } from "./interface/platform-billing.controller.js";
import { StoreBillingController } from "./interface/billing.controllers.js";

/** Subscriptions, the store wallet and referrals. Money is recorded by platform staff (no payment gateway yet). */
@Module({
  controllers: [StoreBillingController, PlatformBillingController],
  providers: [
    { provide: StoreBillingService, useFactory: createStoreBillingService },
    { provide: StaffBillingService, useFactory: createStaffBillingService },
  ],
})
export class BillingModule {}
