/** Public API of the reviews module (docs/architecture/modules.md). Free of NestJS; app.module.ts imports reviews.module.ts directly. */
export { PublicReviewsService, StoreReviewsService } from "./application/reviews.service.js";
export { createPublicReviewsService, createStoreReviewsService } from "./infrastructure/compose.js";
