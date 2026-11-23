import {
  ORDER_HOLD_SECONDS,
  ORDER_PHONE_RULE,
  ORDER_STORE_RULE,
  ORDER_PLACE_RULE,
  canTransition,
  orderListQuerySchema,
  orderTransitionSchema,
  placeOrderSchema,
  type OrderStatus,
} from "@store-builder/shared/modules/orders/orders";
import { OrderNotReadyError, OrderRateLimitedError, OrderTransitionError } from "@store-builder/shared/modules/orders/errors";
import { ReservationLostError } from "@store-builder/shared/modules/inventory/errors";
import { NotFoundError, ValidationError } from "@store-builder/shared/modules/stores/errors";
import type { z } from "zod";
import { draftOrder, type OrderView } from "../domain/orders.js";
import type { CheckoutPort, Limiter, OrderListPage, OrderStore, OrderTokens, Shopper, StockHold } from "./ports.js";

const ID_RE = /^[a-z0-9]{1,64}$/;

function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const r = schema.safeParse(input);
  if (!r.success) {
    const flat = r.error.flatten() as { fieldErrors: Record<string, string[]>; formErrors: string[] };
    throw new ValidationError(Object.keys(flat.fieldErrors).length ? flat.fieldErrors : { _: flat.formErrors.length ? flat.formErrors : ["درخواست نامعتبر است"] });
  }
  return r.data;
}

/** What a shopper sees: the order, whether they may still cancel it, and (once, to a guest) the token to follow it. */
export interface ShopperOrder {
  order: OrderView;
  canCancel: boolean;
}

/**
 * Orders (phase 3.4, D34-1). Shoppers place orders from their cart and follow them (signed in: by id; guests: by the access token);
 * merchants list, read and move them through PLACED -> CONFIRMED -> SHIPPED -> DELIVERED or CANCELLED.
 */
export class OrdersService {
  constructor(
    private readonly orders: OrderStore,
    private readonly checkout: CheckoutPort,
    private readonly stock: StockHold,
    private readonly tokens: OrderTokens,
    private readonly limiter: Limiter,
    /** Order ids: random, lowercase alphanumeric (also the stock-hold reference). */
    private readonly newId: () => string,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /** The store id of a live store (same 404 for missing and unpublished). */
  liveStoreId(label: string): Promise<string> {
    return this.checkout.liveStoreId(label);
  }

  private shopperView(order: OrderView): ShopperOrder {
    return { order, canCancel: canTransition("CUSTOMER", order.status, "CANCELLED") };
  }

  private async limit(key: string, rule: { limit: number; windowSeconds: number }) {
    const r = await this.limiter.consume(key, rule);
    if (!r.allowed) throw new OrderRateLimitedError(r.retryAfterSeconds);
  }

  /**
   * Places the order. The same `requestKey` returns the same order (and token) instead of a second one. Prices, shipping and totals are
   * recomputed here exactly like the checkout summary; stock is held first and consumed in the order's own transaction, so an order exists
   * if and only if its stock left the shelf and its cart was emptied.
   */
  async place(label: string, s: Shopper, body: unknown): Promise<ShopperOrder & { accessToken: string }> {
    const q = parse(placeOrderSchema, body);
    const storeId = await this.checkout.liveStoreId(label);
    // Only the same shopper (customer, else the same cart cookie) can get an order back by its requestKey.
    const owner = s.customerId ? `customer:${s.customerId}` : s.cartToken ? `cart:${s.cartToken}` : null;
    if (!owner) throw new OrderNotReadyError(["empty_cart"]);
    const requestKey = this.tokens.requestKeyFor(q.requestKey, owner);
    const existing = await this.orders.findByRequestKey(storeId, requestKey);
    if (existing) return { ...this.shopperView(existing), accessToken: this.tokens.tokenFor(existing.id) };

    const prep = await this.checkout.prepareOrder(label, s, { address: q.address, addressId: q.addressId, shippingMethodId: q.shippingMethodId, cashOnDelivery: q.paymentMethod === "COD" });
    if (!prep.summary.ready || !prep.address) throw new OrderNotReadyError(prep.summary.blockers.length ? prep.summary.blockers : ["no_address"]);
    await this.limit(`order-place:${storeId}:ip:${s.ipKey}`, ORDER_PLACE_RULE);
    await this.limit(`order-place:${storeId}:phone:${prep.address.phone}`, ORDER_PHONE_RULE);
    await this.limit(`order-place:${storeId}:all`, ORDER_STORE_RULE);

    const id = this.newId();
    const token = this.tokens.tokenFor(id);
    const order = draftOrder({
      id, storeId, customerId: s.customerId, requestKey, accessTokenHash: this.tokens.hash(token)!,
      summary: prep.summary, address: prep.address, weights: prep.weights, paymentMethod: q.paymentMethod, note: q.note,
    });
    const lines = order.items.map((i) => ({ productId: i.productId, variantId: i.variantId, quantity: i.quantity }));
    try {
      await this.stock.reserve(storeId, id, lines, ORDER_HOLD_SECONDS); // OutOfStockError: nothing held, nothing ordered
    } catch (e) {
      // review 3.4: the same checkout sent twice at once; the first one took the stock and placed the order
      const winner = await this.orders.findByRequestKey(storeId, requestKey);
      if (winner) return { ...this.shopperView(winner), accessToken: this.tokens.tokenFor(winner.id) };
      throw e;
    }

    let created: OrderView | "hold_lost" | "duplicate";
    try {
      created = await this.orders.create(order, new Set(lines.map((l) => `${l.productId}|${l.variantId ?? "-"}`)).size, prep.cartId, this.clock());
    } catch (e) {
      await this.stock.release(storeId, id).catch(() => 0);
      throw e;
    }
    if (created === "hold_lost" || created === "duplicate") {
      await this.stock.release(storeId, id).catch(() => 0);
      if (created === "hold_lost") throw new ReservationLostError();
      const winner = await this.orders.findByRequestKey(storeId, requestKey); // the same checkout, sent twice at once
      if (!winner) throw new ReservationLostError();
      return { ...this.shopperView(winner), accessToken: this.tokens.tokenFor(winner.id) };
    }
    return { ...this.shopperView(created), accessToken: token };
  }

  // ---------- shoppers ----------

  private async byToken(label: string, token: string): Promise<{ storeId: string; order: OrderView }> {
    const storeId = await this.checkout.liveStoreId(label);
    const hash = typeof token === "string" ? this.tokens.hash(token) : null;
    const order = hash ? await this.orders.getByTokenHash(storeId, hash) : null;
    if (!order) throw new NotFoundError();
    return { storeId, order };
  }

  async getByToken(label: string, token: string): Promise<ShopperOrder> {
    return this.shopperView((await this.byToken(label, token)).order);
  }

  async cancelByToken(label: string, token: string, s: Shopper): Promise<ShopperOrder> {
    const { storeId, order } = await this.byToken(label, token);
    return this.shopperView(await this.cancelAsCustomer(storeId, order.id, s.customerId));
  }

  /**
   * The signed-in customer's orders. Orders attached to their phone from guest checkouts are included only when the phone is verified by
   * an SMS code (phase 3.3b): a password account alone never proves the phone.
   */
  async listMine(storeId: string, customerId: string, verified = false): Promise<ShopperOrder[]> {
    return (await this.orders.listForCustomer(storeId, customerId, 50, verified)).map((o) => this.shopperView(o));
  }

  async getMine(storeId: string, customerId: string, id: string, verified = false): Promise<ShopperOrder> {
    const o = ID_RE.test(id) ? await this.orders.getForCustomer(storeId, customerId, id, verified) : null;
    if (!o) throw new NotFoundError();
    return this.shopperView(o);
  }

  async cancelMine(storeId: string, customerId: string, id: string, verified = false): Promise<ShopperOrder> {
    await this.getMine(storeId, customerId, id, verified); // scoped to this customer: anyone else's order is the same 404
    return this.shopperView(await this.cancelAsCustomer(storeId, id, customerId));
  }

  private async cancelAsCustomer(storeId: string, id: string, customerId: string | null): Promise<OrderView> {
    const r = await this.orders.transition(storeId, id, "CANCELLED", (from) => {
      if (!canTransition("CUSTOMER", from, "CANCELLED")) throw new OrderTransitionError(from, "CANCELLED");
    }, { actor: "CUSTOMER", actorId: customerId, note: "" });
    if (!r) throw new NotFoundError();
    return r;
  }

  // ---------- merchants (store access already checked by the guard) ----------

  list(a: { storeId: string }, query: unknown): Promise<OrderListPage> {
    const q = parse(orderListQuerySchema, query ?? {});
    return this.orders.list(a.storeId, q);
  }

  /** Phase 3.3b: order count, amount spent (not cancelled) and last order per customer, for the merchant's customer list (at most 100 ids). */
  customerStats(a: { storeId: string }, ids: unknown) {
    const list = typeof ids === "string" ? ids.split(",").filter((x) => ID_RE.test(x)).slice(0, 100) : [];
    return list.length ? this.orders.customerStats(a.storeId, [...new Set(list)]) : Promise.resolve([]);
  }

  async get(a: { storeId: string }, id: string): Promise<OrderView> {
    const o = ID_RE.test(id) ? await this.orders.getById(a.storeId, id) : null;
    if (!o) throw new NotFoundError();
    return o;
  }

  async transition(a: { storeId: string; actorId: string }, id: string, body: unknown): Promise<OrderView> {
    if (!ID_RE.test(id)) throw new NotFoundError();
    const q = parse(orderTransitionSchema, body);
    const to: OrderStatus = q.to;
    const r = await this.orders.transition(a.storeId, id, to, (from) => {
      if (!canTransition("MERCHANT", from, to)) throw new OrderTransitionError(from, to);
    }, { actor: "MERCHANT", actorId: a.actorId, note: q.note });
    if (!r) throw new NotFoundError();
    return r;
  }
}
