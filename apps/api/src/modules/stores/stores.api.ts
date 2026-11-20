/**
 * Public API of the stores module for other modules (ADR 0002 §2.1, docs/architecture/modules.md). The stores module itself is
 * still in the legacy flat layout; layered modules may use it only through this file.
 */
export { withStoreMutation, type MutationContext } from "./mutation.js";
export { getStore } from "./service.js";
