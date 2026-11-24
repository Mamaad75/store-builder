import { Global, Module } from "@nestjs/common";
import type { ApiConfig } from "../../config/env.js";
import { CONFIG } from "../../config/tokens.js";
import { SecretService } from "./application/secret.service.js";
import { createSecretService } from "./infrastructure/compose.js";
import { SecretsController } from "./interface/secrets.controller.js";

/** Global (phase 3.5): the orders module reads a store's payment merchant id through secrets.api.ts (SecretService.reveal). */
@Global()
@Module({
  controllers: [SecretsController],
  providers: [{ provide: SecretService, useFactory: (config: ApiConfig) => createSecretService(config.secrets), inject: [CONFIG] }],
  exports: [SecretService],
})
export class SecretsModule {}
