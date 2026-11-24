import { Body, Controller, Get, Inject, Put, UseGuards } from "@nestjs/common";
import { SessionGuard } from "../../../auth/session.guard.js";
import { Audit, RequirePermission, StoreAccess, StoreAccessGuard, type StoreAccessContext } from "../../access/access.api.js";
import { OrderSmsService } from "../application/order-sms.service.js";

/** Phase 3.6: the store's order-SMS choice (on/off, the merchant's mobile) and this month's usage against the platform's cap. */
@Controller("stores/:storeId/sms-settings")
@UseGuards(SessionGuard, StoreAccessGuard)
export class StoreSmsSettingsController {
  constructor(@Inject(OrderSmsService) private readonly sms: OrderSmsService) {}

  @Get()
  @RequirePermission("store.settings")
  view(@StoreAccess() a: StoreAccessContext) {
    return this.sms.view(a);
  }

  @Put()
  @RequirePermission("store.settings")
  @Audit("store.sms_settings_updated")
  save(@StoreAccess() a: StoreAccessContext, @Body() body: unknown) {
    return this.sms.save(a, body);
  }
}
