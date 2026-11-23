import { InventoryService } from "../application/inventory.service.js";
import { PrismaStockLedger, PrismaVariantReader, PrismaVariantUnitOfWork } from "./prisma-inventory.repository.js";

/** Composition: the one place where the PostgreSQL implementations are handed to the use cases. */
export function createInventoryService(): InventoryService {
  return new InventoryService(new PrismaVariantReader(), new PrismaVariantUnitOfWork(), new PrismaStockLedger());
}
