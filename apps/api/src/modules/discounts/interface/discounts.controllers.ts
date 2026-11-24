import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, UseGuards } from "@nestjs/common";
import { SessionGuard } from "../../../auth/session.guard.js";
import { Audit, RequirePermission, StoreAccess, StoreAccessGuard, type StoreAccessContext } from "../../access/access.api.js";
import { DiscountsService } from "../application/discounts.service.js";

/** Phase 5.1: the store's discount codes (owner and manager: discounts.manage). Changes apply at once, without publishing. */
@Controller("stores/:storeId/discounts")
@UseGuards(SessionGuard, StoreAccessGuard)
export class StoreDiscountsController {
  constructor(@Inject(DiscountsService) private readonly discounts: DiscountsService) {}

  @Get()
  @RequirePermission("discounts.manage")
  list(@StoreAccess() a: StoreAccessContext) {
    return this.discounts.list(a);
  }

  @Post()
  @RequirePermission("discounts.manage")
  @Audit("discount.created")
  create(@StoreAccess() a: StoreAccessContext, @Body() body: unknown) {
    return this.discounts.create(a, body);
  }

  @Put(":discountId")
  @RequirePermission("discounts.manage")
  @Audit("discount.updated", { type: "discount", param: "discountId" })
  update(@StoreAccess() a: StoreAccessContext, @Param("discountId") id: string, @Body() body: unknown) {
    return this.discounts.update(a, id, body);
  }

  @Post(":discountId/delete")
  @HttpCode(204)
  @RequirePermission("discounts.manage")
  @Audit("discount.deleted", { type: "discount", param: "discountId" })
  async remove(@StoreAccess() a: StoreAccessContext, @Param("discountId") id: string) {
    await this.discounts.remove(a, id);
  }
}
