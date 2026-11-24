/**
 * Public API of the orders module (phase 3.4): the only file other modules may import (docs/architecture/modules.md). Free of NestJS;
 * app.module.ts imports orders.module.ts directly.
 */
export { OrdersService } from "./application/orders.service.js";
export type { OrderView } from "./domain/orders.js";
export { createOrdersService } from "./infrastructure/compose.js";
// Phase 3.5: online payment (the reconciliation job, scripts/reconcile-payments.ts).
export { PaymentsService } from "./application/payments.service.js";
export { createPaymentsService } from "./infrastructure/compose.js";
