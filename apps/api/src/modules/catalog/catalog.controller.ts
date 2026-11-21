import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { SessionGuard } from "../../auth/session.guard.js";
import { changeProductStatus, createProduct, deleteProduct, getProduct, listProducts, updateProduct } from "../products/service.js";
import { parseProductListParams } from "@store-builder/shared/modules/products/schemas";
import { Audit, RequirePermission, StoreAccess, StoreAccessGuard, type StoreAccessContext } from "../access/access.api.js";

/** Products of one store (owner-scoped in the services). Categories: modules/categories/interface/categories.controller.ts. */
@Controller("stores/:storeId")
@UseGuards(SessionGuard, StoreAccessGuard)
export class CatalogController {
  @Get("products")
  @RequirePermission("store.view")
  products(@StoreAccess() a: StoreAccessContext, @Param("storeId") storeId: string, @Query() query: Record<string, string | string[] | undefined>) {
    return listProducts(a.ownerId, storeId, parseProductListParams(query));
  }

  @Post("products")
  @HttpCode(201)
  @RequirePermission("catalog.write")
  @Audit("product.created")
  addProduct(@StoreAccess() a: StoreAccessContext, @Param("storeId") storeId: string, @Body() body: unknown) {
    return createProduct(a.ownerId, storeId, body);
  }

  @Get("products/:productId")
  @RequirePermission("store.view")
  product(@StoreAccess() a: StoreAccessContext, @Param("storeId") storeId: string, @Param("productId") id: string) {
    return getProduct(a.ownerId, storeId, id);
  }

  @Patch("products/:productId")
  @RequirePermission("catalog.write")
  @Audit("product.updated", { type: "product", param: "productId" })
  editProduct(@StoreAccess() a: StoreAccessContext, @Param("storeId") storeId: string, @Param("productId") id: string, @Body() body: unknown) {
    return updateProduct(a.ownerId, storeId, id, body);
  }

  @Post("products/:productId/status")
  @HttpCode(200)
  @RequirePermission("catalog.write")
  @Audit("product.status_changed", { type: "product", param: "productId" })
  status(@StoreAccess() a: StoreAccessContext, @Param("storeId") storeId: string, @Param("productId") id: string, @Body() body: { status?: unknown } | undefined) {
    return changeProductStatus(a.ownerId, storeId, id, body?.status);
  }

  @Post("products/:productId/delete")
  @HttpCode(204)
  @RequirePermission("catalog.write")
  @Audit("product.deleted", { type: "product", param: "productId" })
  async removeProduct(@StoreAccess() a: StoreAccessContext, @Param("storeId") storeId: string, @Param("productId") id: string): Promise<void> {
    await deleteProduct(a.ownerId, storeId, id);
  }
}
