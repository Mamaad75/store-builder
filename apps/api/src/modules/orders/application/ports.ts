import type { OrderActor, OrderStatus } from "@store-builder/shared/modules/orders/orders";
import type { AddressInput } from "@store-builder/shared/modules/checkout/checkout";
import type { NewOrder, OrderView, ReadySummary } from "../domain/orders.js";

/** Who is shopping (the checkout module reads it from the request: cart cookie, customer session of this store, network key). */
export interface Shopper {
  cartToken: string | null;
  customerId: string | null;
  ipKey: string;
}

/** The checkout (phase 3.3): orders are priced exactly like the checkout summary, by the checkout module itself. */
export interface CheckoutPort {
  liveStoreId(label: string): Promise<string>;
  prepareOrder(
    label: string,
    s: Shopper,
    q: { address?: unknown; addressId?: string; shippingMethodId: string; cashOnDelivery: boolean },
  ): Promise<{ storeId: string; summary: ReadySummary; address: AddressInput | null; cartId: string | null; weights: Map<string, number | null> }>;
}

export interface OrderListPage {
  items: OrderView[];
  /** Pass as `before` for the next (older) page; null on the last page. */
  nextCursor: string | null;
}

/** Orders of one store. Every query is bound to the store id (and, for shoppers, to the customer or the access token). */
export interface OrderStore {
  findByRequestKey(storeId: string, requestKey: string): Promise<OrderView | null>;
  /**
   * ONE transaction: the stock hold `order.id` is consumed (all `holdLines` lines, unexpired), the next gap-free number is taken, the order
   * with its items and first history entry is written, the "order.placed" event is recorded and the cart is emptied. "hold_lost" = the
   * hold was incomplete (nothing written). A second order with the same request key fails with "duplicate" (nothing written).
   */
  create(order: NewOrder, holdLines: number, cartId: string | null, now: Date): Promise<OrderView | "hold_lost" | "duplicate">;
  getById(storeId: string, id: string): Promise<OrderView | null>;
  getByTokenHash(storeId: string, tokenHash: string): Promise<OrderView | null>;
  getForCustomer(storeId: string, customerId: string, id: string): Promise<OrderView | null>;
  listForCustomer(storeId: string, customerId: string, limit: number): Promise<OrderView[]>;
  list(storeId: string, q: { status?: OrderStatus; before?: string; limit: number }): Promise<OrderListPage>;
  /**
   * ONE transaction with the order row locked: `check(current)` throws when the move is not allowed (nothing changes); otherwise the
   * status changes, the history gets an entry, a cancellation gives the stock back and "order.status_changed" is recorded. null = no such order.
   */
  transition(
    storeId: string,
    id: string,
    to: OrderStatus,
    check: (current: OrderStatus) => void,
    by: { actor: OrderActor; actorId: string | null; note: string },
  ): Promise<OrderView | null>;
}

/** The stock hold (the 3.2 ledger): taken before the order is written, consumed inside its transaction, released if writing fails. */
export interface StockHold {
  reserve(storeId: string, ref: string, lines: { productId: string; variantId: string | null; quantity: number }[], ttlSeconds: number): Promise<void>;
  release(storeId: string, ref: string): Promise<number>;
}

/** Order access tokens: derived from the order id with a server key (so a retried request can be answered with the same token). */
export interface OrderTokens {
  tokenFor(orderId: string): string;
  /** null = not a token this system could have issued (never looked up). */
  hash(token: string): string | null;
}

export interface Limiter {
  consume(key: string, rule: { limit: number; windowSeconds: number }): Promise<{ allowed: boolean; retryAfterSeconds: number }>;
}
