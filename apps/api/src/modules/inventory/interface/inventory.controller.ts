import { Body, Controller, Get, Inject, Param, Put, UseGuards } from "@nestjs/common";
import { SessionGuard } from "../../../auth/session.guard.js";
import { InventoryService } from "../application/inventory.service.js";
import { Audit, RequirePermission, StoreAccess, StoreAccessGuard, type StoreAccessContext } from "../../access/access.api.js";

/** Variants of one product (phase 3.2). The store and owner come from the resolved access context, never from request data. */
@Controller("stores/:storeId/products/:productId/variants")
@UseGuards(SessionGuard, StoreAccessGuard)
export class VariantsController {
  constructor(@Inject(InventoryService) private readonly inventory: InventoryService) {}

  @Get()
  @RequirePermission("store.view")
  list(@StoreAccess() a: StoreAccessContext, @Param("productId") productId: string) {
    return this.inventory.listVariants(a, productId);
  }

  /** Replaces the whole set (`{ variants: [] }` removes them all). */
  @Put()
  @RequirePermission("catalog.write")
  @Audit("product.variants_replaced", { type: "product", param: "productId" })
  replace(@StoreAccess() a: StoreAccessContext, @Param("productId") productId: string, @Body() body: unknown) {
    return this.inventory.replaceVariants(a, productId, body);
  }
}
