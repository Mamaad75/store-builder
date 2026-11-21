import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { SessionGuard } from "../../../auth/session.guard.js";
import { CategoryService } from "../application/category.service.js";
import { Audit, RequirePermission, StoreAccess, StoreAccessGuard, type StoreAccessContext } from "../../access/access.api.js";

/** Categories of one store. The owner is the session user; the service validates every other argument. */
@Controller("stores/:storeId/categories")
@UseGuards(SessionGuard, StoreAccessGuard)
export class CategoriesController {
  constructor(@Inject(CategoryService) private readonly categories: CategoryService) {}

  @Get()
  @RequirePermission("store.view")
  list(@StoreAccess() a: StoreAccessContext, @Param("storeId") storeId: string) {
    return this.categories.list(a.ownerId, storeId);
  }

  @Post()
  @HttpCode(201)
  @RequirePermission("catalog.write")
  @Audit("category.created")
  create(@StoreAccess() a: StoreAccessContext, @Param("storeId") storeId: string, @Body() body: unknown) {
    return this.categories.create(a.ownerId, storeId, body);
  }

  @Patch(":categoryId")
  @RequirePermission("catalog.write")
  @Audit("category.renamed", { type: "category", param: "categoryId" })
  rename(@StoreAccess() a: StoreAccessContext, @Param("storeId") storeId: string, @Param("categoryId") id: string, @Body() body: unknown) {
    return this.categories.update(a.ownerId, storeId, id, body);
  }

  @Post(":categoryId/delete")
  @HttpCode(200)
  @RequirePermission("catalog.write")
  @Audit("category.deleted", { type: "category", param: "categoryId" })
  remove(@StoreAccess() a: StoreAccessContext, @Param("storeId") storeId: string, @Param("categoryId") id: string, @Body() body: unknown) {
    return this.categories.delete(a.ownerId, storeId, id, body ?? { moveProducts: false });
  }
}
