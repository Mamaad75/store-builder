import { Global, Module } from "@nestjs/common";
import type { ApiConfig } from "../../config/env.js";
import { CONFIG } from "../../config/tokens.js";
import { PlatformSettingsService } from "./application/settings.service.js";
import { createPlatformSettingsService } from "./infrastructure/compose.js";
import { PlatformService } from "./application/platform.service.js";
import { PrismaPlatformRepository } from "./infrastructure/prisma-platform.repository.js";
import { PlatformAdminGuard, PlatformController } from "./interface/platform.controllers.js";
import { StoreSuspensionController } from "./interface/store-suspension.controller.js";

/** Global: other modules inject PlatformSettingsService (e.g. the SMS sender for customer sign-in) through platform.api.ts only. */
@Global()
@Module({
  controllers: [PlatformController, StoreSuspensionController],
  providers: [
    { provide: PlatformService, useFactory: () => new PlatformService(new PrismaPlatformRepository()) },
    { provide: PlatformSettingsService, useFactory: (config: ApiConfig) => createPlatformSettingsService(config.secrets, config.appEnv), inject: [CONFIG] },
    PlatformAdminGuard,
  ],
  exports: [PlatformService, PlatformSettingsService],
})
export class PlatformModule {}
