import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, UseGuards } from "@nestjs/common";
import type { SafeUser } from "../../../auth/ports.js";
import { SessionGuard } from "../../../auth/session.guard.js";
import { CurrentUser } from "../../../http/current-user.js";
import { CategoryService } from "../application/category.service.js";

/** Categories of one store. The owner is the session user; the service validates every other argument. */
@Controller("stores/:storeId/categories")
@UseGuards(SessionGuard)
export class CategoriesController {
  constructor(@Inject(CategoryService) private readonly categories: CategoryService) {}

  @Get()
  list(@CurrentUser() user: SafeUser, @Param("storeId") storeId: string) {
    return this.categories.list(user.id, storeId);
  }

  @Post()
  @HttpCode(201)
  create(@CurrentUser() user: SafeUser, @Param("storeId") storeId: string, @Body() body: unknown) {
    return this.categories.create(user.id, storeId, body);
  }

  @Patch(":categoryId")
  rename(@CurrentUser() user: SafeUser, @Param("storeId") storeId: string, @Param("categoryId") id: string, @Body() body: unknown) {
    return this.categories.update(user.id, storeId, id, body);
  }

  @Post(":categoryId/delete")
  @HttpCode(200)
  remove(@CurrentUser() user: SafeUser, @Param("storeId") storeId: string, @Param("categoryId") id: string, @Body() body: unknown) {
    return this.categories.delete(user.id, storeId, id, body ?? { moveProducts: false });
  }
}
