/**
 * Public API of the products module for other modules (docs/architecture/modules.md). The products module is still in the legacy flat
 * layout; layered modules may use it only through this file.
 */
/** Inside the caller's store mutation: the inventory module writes a product's variant summary (lowest price, summed stock, D32-1). */
export { updateProductRow } from "./repository.js";
