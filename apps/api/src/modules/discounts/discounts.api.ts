/** Public API of the discounts module (phase 5.1): the only file other modules may import. */
export { DiscountsService, type Evaluation } from "./application/discounts.service.js";
export { createDiscountsService } from "./infrastructure/compose.js";
export { redeemDiscountInTx, releaseDiscountInTx } from "./infrastructure/prisma-discounts.repository.js";
