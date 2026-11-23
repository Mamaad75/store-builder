/** Public API of the platform module (phase 3.1). */
export { PlatformService } from "./application/platform.service.js";
export { PrismaPlatformRepository } from "./infrastructure/prisma-platform.repository.js";
export { PlatformSettingsService } from "./application/settings.service.js";
export { createPlatformSettingsService, otpSenderSource } from "./infrastructure/compose.js";
/** For other modules' super-admin routes (phase 3.2b: rates). */
export { PlatformAdminGuard } from "./interface/platform.controllers.js";
export { rotatePlatformSecrets } from "./infrastructure/rotation.js";
