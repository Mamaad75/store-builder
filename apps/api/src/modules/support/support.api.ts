/** Public API of the support module (docs/architecture/modules.md). Free of NestJS; app.module.ts imports support.module.ts directly. */
export { StaffSupportService, SupportService } from "./application/support.service.js";
export { createStaffSupportService, createSupportService } from "./infrastructure/compose.js";
