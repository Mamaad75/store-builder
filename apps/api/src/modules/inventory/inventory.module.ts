import { Module } from "@nestjs/common";
import { InventoryService } from "./application/inventory.service.js";
import { createInventoryService } from "./infrastructure/compose.js";
import { VariantsController } from "./interface/inventory.controller.js";

@Module({
  controllers: [VariantsController],
  providers: [{ provide: InventoryService, useFactory: createInventoryService }],
  exports: [InventoryService],
})
export class InventoryModule {}
