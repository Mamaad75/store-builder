/** Public API of the insights module (docs/architecture/modules.md). Free of NestJS; app.module.ts imports insights.module.ts directly. */
export { InsightsService } from "./application/insights.service.js";
export { createInsightsService } from "./infrastructure/compose.js";
