import { replaceShippingMethodsSchema, type ShippingMethod } from "@store-builder/shared/modules/checkout/checkout";
import { ValidationError } from "@store-builder/shared/modules/stores/errors";
import type { ShippingStore } from "./ports.js";

/** `a` is the resolved store access (the guard checked membership and permission); request data never names the store. */
interface StoreScope {
  storeId: string;
}

/**
 * The merchant's shipping methods (phase 3.3, D33-1). An operational setting, not draft content: a change applies to checkout at once
 * (no publish, no draft revision), like stock.
 */
export class ShippingService {
  constructor(private readonly store: ShippingStore) {}

  list(a: StoreScope): Promise<ShippingMethod[]> {
    return this.store.list(a.storeId);
  }

  /** Replaces the whole list (`{ methods: [] }` removes them all: checkout then reports "no shipping"). Order = the list order. */
  async replace(a: StoreScope, body: unknown): Promise<ShippingMethod[]> {
    const r = replaceShippingMethodsSchema.safeParse(body);
    if (!r.success) throw new ValidationError(r.error.flatten().fieldErrors as Record<string, string[]>);
    return this.store.replace(a.storeId, r.data.methods);
  }
}
