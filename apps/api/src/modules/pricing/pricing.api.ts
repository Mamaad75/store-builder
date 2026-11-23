/**
 * Public API of the pricing module (phase 3.2b): the only file other modules may import (docs/architecture/modules.md). Free of NestJS so the
 * hourly job script can load it; app.module.ts imports pricing.module.ts directly.
 */
export { PricingService } from "./application/pricing.service.js";
export { RatesService, type RefreshReport } from "./application/rates.service.js";
export { createPricingService, createRatesService } from "./infrastructure/compose.js";
/** Inside the caller's store mutation: the products module refuses direct price edits of a linked product. */
export { productPriceLinkedInTx, linkedVariantIdsInTx, syncLiveInTx } from "./infrastructure/prisma-pricing.repository.js";
