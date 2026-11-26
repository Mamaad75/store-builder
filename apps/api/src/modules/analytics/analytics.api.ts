/**
 * Public API of the analytics module: the only file other modules may import (docs/architecture/modules.md). Free of NestJS;
 * app.module.ts imports analytics.module.ts directly.
 */
export { AnalyticsService } from "./application/analytics.service.js";
export { VisitService } from "./application/visit.service.js";
export { createAnalyticsService, createVisitService, purgeAnalytics } from "./infrastructure/compose.js";
