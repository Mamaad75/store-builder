/**
 * Public API of the checkout module (phase 3.3): the only file other modules may import (docs/architecture/modules.md). Free of NestJS so
 * scripts (db-cleanup) can load it; app.module.ts imports checkout.module.ts directly.
 */
export { CheckoutService } from "./application/checkout.service.js";
export { ShippingService } from "./application/shipping.service.js";
export { createCheckoutService, createShippingService } from "./infrastructure/compose.js";
export { clearCartInTx, purgeExpiredCarts } from "./infrastructure/prisma-checkout.repository.js";
/** For the orders module (phase 3.4): read the shopper (cart cookie, customer session of this store) the same way checkout does. */
export { cartCookieName, shopperOf } from "./interface/shopper.js";
export type { Shopper } from "./application/checkout.service.js";
export type { CheckoutSummary, PricedLine } from "./domain/quote.js";
