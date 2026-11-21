import { Global, Module } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { AccessService } from "./application/access.service.js";
import { createAccessService } from "./infrastructure/compose.js";
import { AuditController, MyAccessController, TeamController } from "./interface/access.controllers.js";
import { AuditInterceptor, StoreAccessGuard } from "./interface/store-access.js";

/**
 * Store access (phase 2.3). Global: every store controller (layered or legacy) uses StoreAccessGuard, and the audit interceptor
 * applies to every route (it acts only on handlers marked @Audit).
 */
@Global()
@Module({
  controllers: [TeamController, AuditController, MyAccessController],
  providers: [{ provide: AccessService, useFactory: createAccessService }, StoreAccessGuard, { provide: APP_INTERCEPTOR, useClass: AuditInterceptor }],
  exports: [AccessService, StoreAccessGuard],
})
export class AccessModule {}
