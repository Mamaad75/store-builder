import { Controller, Get, Inject, UseGuards } from "@nestjs/common";
import { SessionGuard } from "../../../auth/session.guard.js";
import { RequirePermission, StoreAccess, StoreAccessGuard, type StoreAccessContext } from "../../access/access.api.js";
import { PlatformService } from "../application/platform.service.js";

/** ADR 0003 (G2): the store's own staff see whether the platform suspended their store, with the public message only (never the notes). */
@Controller("stores/:storeId/suspension")
@UseGuards(SessionGuard, StoreAccessGuard)
export class StoreSuspensionController {
  constructor(@Inject(PlatformService) private readonly platform: PlatformService) {}

  @Get()
  @RequirePermission("store.view")
  get(@StoreAccess() a: StoreAccessContext) {
    return this.platform.merchantSuspension(a);
  }
}
