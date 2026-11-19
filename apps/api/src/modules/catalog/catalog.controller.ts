import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { SessionGuard } from "../../auth/session.guard.js";
import type { SafeUser } from "../../auth/ports.js";
import { CurrentUser } from "../../http/current-user.js";
import { createCategory, deleteCategory, listCategories, updateCategory } from "../categories/service.js";
import { changeProductStatus, createProduct, deleteProduct, getProduct, listProducts, updateProduct } from "../products/service.js";
import { parseProductListParams } from "@store-builder/shared/modules/products/schemas";

/** Categories and products of one store (owner-scoped in the services). */
@Controller("stores/:storeId")
@UseGuards(SessionGuard)
export class CatalogController {
  @Get("categories")
  categories(@CurrentUser() user: SafeUser, @Param("storeId") storeId: string) {
    return listCategories(user.id, storeId);
  }

  @Post("categories")
  @HttpCode(201)
  addCategory(@CurrentUser() user: SafeUser, @Param("storeId") storeId: string, @Body() body: unknown) {
    return createCategory(user.id, storeId, body);
  }

  @Patch("categories/:categoryId")
  renameCategory(@CurrentUser() user: SafeUser, @Param("storeId") storeId: string, @Param("categoryId") id: string, @Body() body: unknown) {
    return updateCategory(user.id, storeId, id, body);
  }

  @Post("categories/:categoryId/delete")
  @HttpCode(200)
  removeCategory(@CurrentUser() user: SafeUser, @Param("storeId") storeId: string, @Param("categoryId") id: string, @Body() body: unknown) {
    return deleteCategory(user.id, storeId, id, body ?? { moveProducts: false });
  }

  @Get("products")
  products(@CurrentUser() user: SafeUser, @Param("storeId") storeId: string, @Query() query: Record<string, string | string[] | undefined>) {
    return listProducts(user.id, storeId, parseProductListParams(query));
  }

  @Post("products")
  @HttpCode(201)
  addProduct(@CurrentUser() user: SafeUser, @Param("storeId") storeId: string, @Body() body: unknown) {
    return createProduct(user.id, storeId, body);
  }

  @Get("products/:productId")
  product(@CurrentUser() user: SafeUser, @Param("storeId") storeId: string, @Param("productId") id: string) {
    return getProduct(user.id, storeId, id);
  }

  @Patch("products/:productId")
  editProduct(@CurrentUser() user: SafeUser, @Param("storeId") storeId: string, @Param("productId") id: string, @Body() body: unknown) {
    return updateProduct(user.id, storeId, id, body);
  }

  @Post("products/:productId/status")
  @HttpCode(200)
  status(@CurrentUser() user: SafeUser, @Param("storeId") storeId: string, @Param("productId") id: string, @Body() body: { status?: unknown } | undefined) {
    return changeProductStatus(user.id, storeId, id, body?.status);
  }

  @Post("products/:productId/delete")
  @HttpCode(204)
  async removeProduct(@CurrentUser() user: SafeUser, @Param("storeId") storeId: string, @Param("productId") id: string): Promise<void> {
    await deleteProduct(user.id, storeId, id);
  }
}
