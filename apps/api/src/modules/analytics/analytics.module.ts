import { Module } from "@nestjs/common";
import type { RateLimiter } from "../../auth/ports.js";
import { CONFIG, RATE_LIMITER } from "../../config/tokens.js";
import type { ApiConfig } from "../../config/env.js";
import { AnalyticsService } from "./application/analytics.service.js";
import { VisitService } from "./application/visit.service.js";
import { createAnalyticsService, createVisitService } from "./infrastructure/compose.js";
import { PublicVisitController, StoreAnalyticsController } from "./interface/analytics.controllers.js";

@Module({
  controllers: [PublicVisitController, StoreAnalyticsController],
  providers: [
    { provide: VisitService, useFactory: (limiter: RateLimiter, config: ApiConfig) => createVisitService({ limiter, secret: config.authSecret }), inject: [RATE_LIMITER, CONFIG] },
    { provide: AnalyticsService, useFactory: createAnalyticsService },
  ],
})
export class AnalyticsModule {}
