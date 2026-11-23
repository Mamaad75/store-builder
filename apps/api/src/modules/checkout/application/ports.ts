import type { AddressInput, ShippingMethod, ShippingMethodInput } from "@store-builder/shared/modules/checkout/checkout";
import type { StorefrontProduct } from "@store-builder/shared/templates/storefront-data";
import type { CartLine, StockFact } from "../domain/quote.js";

export interface CartRow {
  id: string;
  customerId: string | null;
  lines: CartLine[];
}

/** Carts of one store. Every query is bound to the store id. */
export interface CartStore {
  findByTokenHash(storeId: string, tokenHash: string): Promise<CartRow | null>;
  findByCustomer(storeId: string, customerId: string): Promise<CartRow | null>;
  create(storeId: string, tokenHash: string, customerId: string | null): Promise<CartRow>;
  /**
   * One transaction with the cart row locked: `change` gets the current lines and returns the new ones (it may throw, e.g. a limit, and
   * then nothing changes). null = the cart is gone. A line pointing at a product or variant that no longer exists is NotFoundError.
   */
  update(storeId: string, cartId: string, change: (lines: CartLine[]) => CartLine[]): Promise<CartLine[] | null>;
  /** The guest cart becomes the customer's (it had no customer). */
  attachCustomer(storeId: string, cartId: string, customerId: string): Promise<void>;
  /** One transaction, both carts locked in id order: the customer's cart gets `merge(itsLines, guestLines)`, the guest cart is deleted. */
  mergeInto(storeId: string, guestCartId: string, customerCartId: string, merge: (into: CartLine[], from: CartLine[]) => CartLine[]): Promise<void>;
  /** Carts untouched since `before`, any store, at most `limit`. */
  purgeExpired(before: Date, limit: number): Promise<number>;
}

/** What the public checkout may read: the published store (with live prices), the stock rows and the shipping methods. */
export interface CheckoutReads {
  liveStore(label: string): Promise<{ storeId: string; versionId: string } | null>;
  /** Published products with current linked prices; null = the published data is unreadable. */
  publishedProducts(storeId: string, versionId: string): Promise<StorefrontProduct[] | null>;
  /** Product status and sellable quantity per line, keyed by stockKey(productId, variantId); missing = the row is gone. */
  stock(storeId: string, lines: readonly { productId: string; variantId: string | null }[]): Promise<Map<string, StockFact>>;
  enabledShippingMethods(storeId: string): Promise<ShippingMethod[]>;
}

export interface SavedAddress extends AddressInput {
  id: string;
}

/** A customer's saved addresses; every query is bound to the store AND the customer. */
export interface AddressStore {
  list(storeId: string, customerId: string): Promise<SavedAddress[]>;
  get(storeId: string, customerId: string, id: string): Promise<SavedAddress | null>;
  /** Refuses (AddressLimitError) at `max`, counted under a lock on the customer row. */
  create(storeId: string, customerId: string, a: AddressInput, max: number): Promise<SavedAddress>;
  update(storeId: string, customerId: string, id: string, a: AddressInput): Promise<SavedAddress | null>;
  delete(storeId: string, customerId: string, id: string): Promise<boolean>;
}

/** The merchant's shipping methods (store access already checked by the guard). */
export interface ShippingStore {
  list(storeId: string): Promise<ShippingMethod[]>;
  /** Replaces the whole list in one transaction (serialised per store). */
  replace(storeId: string, methods: readonly ShippingMethodInput[]): Promise<ShippingMethod[]>;
}

/** Cart tokens: random, sent only to the shopper's cookie; the database keeps a SHA-256. */
export interface CartTokens {
  create(): { token: string; hash: string };
  /** null = not a token this system could have issued (never looked up). */
  hash(token: string): string | null;
}

export interface Limiter {
  consume(key: string, rule: { limit: number; windowSeconds: number }): Promise<{ allowed: boolean; retryAfterSeconds: number }>;
}
