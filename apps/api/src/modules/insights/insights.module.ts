import { Module } from "@nestjs/common";
import { InsightsService } from "./application/insights.service.js";
import { createInsightsService } from "./infrastructure/compose.js";
import { InsightsController } from "./interface/insights.controller.js";

/** Read-only dashboard, accounts, store detail and activity log for the platform's super admins. */
@Module({ controllers: [InsightsController], providers: [{ provide: InsightsService, useFactory: createInsightsService }] })
export class InsightsModule {}
