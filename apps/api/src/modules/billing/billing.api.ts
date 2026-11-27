/** Public API of the billing module (docs/architecture/modules.md). Free of NestJS; app.module.ts imports billing.module.ts directly. */
export { StaffBillingService, StoreBillingService } from "./application/billing.service.js";
export { createStaffBillingService, createStoreBillingService } from "./infrastructure/compose.js";
export { storeLimits, storeLimitsNow, type StoreLimits } from "./infrastructure/limits.js";
