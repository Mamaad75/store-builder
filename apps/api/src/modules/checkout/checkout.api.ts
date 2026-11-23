/**
 * Public API of the checkout module (phase 3.3): the only file other modules may import (docs/architecture/modules.md). Free of NestJS so
 * scripts (db-cleanup) can load it; app.module.ts imports checkout.module.ts directly.
 */
export { CheckoutService } from "./application/checkout.service.js";
export { ShippingService } from "./application/shipping.service.js";
export { createCheckoutService, createShippingService } from "./infrastructure/compose.js";
export { purgeExpiredCarts } from "./infrastructure/prisma-checkout.repository.js";
