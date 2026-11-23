/**
 * Public API of the inventory module (phase 3.2): the only file other modules may import (docs/architecture/modules.md). Free of
 * NestJS so scripts (db-cleanup) and other services can load it; app.module.ts imports inventory.module.ts directly.
 */
export { InventoryService } from "./application/inventory.service.js";
export type { VariantView } from "./application/ports.js";
export { createInventoryService } from "./infrastructure/compose.js";
/** For the products module, inside its own store mutation: a product with variants takes its price and stock from them. */
export { productHasVariantsInTx } from "./infrastructure/prisma-inventory.repository.js";
