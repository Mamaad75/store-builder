/**
 * Public API of the categories module: the only file other modules may import (docs/architecture/modules.md). It stays free of
 * NestJS so plain callers (scripts, tests, other services) can load it; app.module.ts imports categories.module.ts directly.
 */
export { CategoryService } from "./application/category.service.js";
export type { CategoryView } from "./application/ports.js";
export { createCategoryService } from "./infrastructure/category.adapters.js";
/**
 * For another module's write that must check a category inside ITS OWN store mutation (products: assigning a category). The
 * MutationContext proves the store is locked and owned, so the answer cannot change before that transaction commits.
 */
export { findInTx as findCategoryInTx } from "./infrastructure/prisma-category.repository.js";
