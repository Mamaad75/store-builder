/** Public API of the platform module (phase 3.1). */
export { PlatformService } from "./application/platform.service.js";
export { PrismaPlatformRepository } from "./infrastructure/prisma-platform.repository.js";
export { PlatformSettingsService } from "./application/settings.service.js";
export { otpSenderSource } from "./infrastructure/compose.js";
export { rotatePlatformSecrets } from "./infrastructure/rotation.js";
