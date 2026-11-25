import { createHash, randomBytes } from "node:crypto";
import { Global, Module } from "@nestjs/common";
import type { ApiConfig } from "../../config/env.js";
import { CONFIG, RATE_LIMITER } from "../../config/tokens.js";
import type { RateLimiter } from "../../auth/ports.js";
import { hashPassword, verifyPassword } from "../../auth/password.js";
import { rateLimitKey } from "../../lib/rate-limit.js";
import { PilotAccessService } from "./application/pilot.service.js";
import { PrismaPilotRepository } from "./infrastructure/prisma-pilot.repository.js";
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
    // MVP item 2: invitations and admin-assisted recovery. Password re-entry: at most 5 attempts per admin per 15 minutes.
    {
      provide: PilotAccessService,
      useFactory: (config: ApiConfig, limiter: RateLimiter) =>
        new PilotAccessService(new PrismaPilotRepository(), {
          hashPassword,
          verifyPassword,
          limit: (key) => limiter.consume(rateLimitKey("platform", key), { limit: 5, windowSeconds: 15 * 60 }),
          platformOrigin: `${config.protocol}://${config.rootDomain}`,
          random: (bytes) => randomBytes(bytes).toString("base64url"),
          sha256: (v) => createHash("sha256").update(v, "utf8").digest("hex"),
        }),
      inject: [CONFIG, RATE_LIMITER],
    },
    PlatformAdminGuard,
  ],
  exports: [PlatformService, PlatformSettingsService],
})
export class PlatformModule {}
