import { Module } from "@nestjs/common";
import { CategoryService } from "./application/category.service.js";
import { createCategoryService } from "./infrastructure/category.adapters.js";
import { CategoriesController } from "./interface/categories.controller.js";

@Module({
  controllers: [CategoriesController],
  providers: [{ provide: CategoryService, useFactory: createCategoryService }],
  exports: [CategoryService],
})
export class CategoriesModule {}
