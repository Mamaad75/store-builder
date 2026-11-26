import { Module } from "@nestjs/common";
import type { RateLimiter } from "../../auth/ports.js";
import { RATE_LIMITER } from "../../config/tokens.js";
import { CheckoutService, createCheckoutService } from "../checkout/checkout.api.js";
import { PublicReviewsService, StoreReviewsService } from "./application/reviews.service.js";
import { createPublicReviewsService, createStoreReviewsService } from "./infrastructure/compose.js";
import { PublicReviewsController, StoreReviewsController } from "./interface/reviews.controllers.js";

/** Product reviews (customers write, merchants moderate). CustomerAuthService comes from the global customers module. */
@Module({
  controllers: [PublicReviewsController, StoreReviewsController],
  providers: [
    // only for `liveStoreId` (an unpublished or suspended store is a 404): the same composition the analytics beacon uses
    { provide: CheckoutService, useFactory: (limiter: RateLimiter) => createCheckoutService({ limiter }), inject: [RATE_LIMITER] },
    { provide: PublicReviewsService, useFactory: createPublicReviewsService },
    { provide: StoreReviewsService, useFactory: createStoreReviewsService },
  ],
})
export class ReviewsModule {}
