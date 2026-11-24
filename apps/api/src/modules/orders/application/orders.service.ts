import {
  ORDER_HOLD_SECONDS,
  ORDER_PHONE_RULE,
  ORDER_STORE_RULE,
  ORDER_PLACE_RULE,
  PAYMENT_WINDOW_MINUTES,
  canTransition,
  type Gateway,
  orderListQuerySchema,
  orderTransitionSchema,
  placeOrderSchema,
  type OrderStatus,
} from "@store-builder/shared/modules/orders/orders";
import { OrderNotReadyError, OrderRateLimitedError, OrderTransitionError, PaymentUnavailableError } from "@store-builder/shared/modules/orders/errors";
import { ReservationLostError } from "@store-builder/shared/modules/inventory/errors";
import { NotFoundError, ValidationError } from "@store-builder/shared/modules/stores/errors";
import type { z } from "zod";
import { draftOrder, type OrderView } from "../domain/orders.js";
import { CARD_TRANSFER_WINDOW_HOURS } from "@store-builder/shared/modules/orders/card-transfer";
import { DiscountInvalidError } from "@store-builder/shared/modules/discounts/errors";
import type { DiscountReason } from "@store-builder/shared/modules/discounts/discounts";
import type { CheckoutPort, Limiter, OrderListPage, OrderStore, OrderTokens, Shopper, StockHold, TransferInfo } from "./ports.js";

/** Phase 3.5 / D35b-1: what placing and showing a prepaid order needs from the payment side. */
export interface PrepaidGate {
  /** Throws PaymentUnavailableError when the store cannot take this method (or this amount) now. */
  assertCanPay(storeId: string, totalToman: number, method: "ONLINE" | "CARD_TRANSFER", gateway?: Gateway): Promise<void>;
  /** For card-to-card orders: the cards, the receipts and whether another can be sent; null for other methods. */
  transferInfo(storeId: string, order: OrderView): Promise<TransferInfo | null>;
}

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
  /** Phase 3.5: an unpaid online order still within its payment window. */
  canPay: boolean;
  /** D35b-1: card-to-card details (single-order answers only; null in lists and for other methods). */
  transfer: TransferInfo | null;
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
    /** Phase 3.5 / D35b-1: prepaid methods (null = ONLINE and CARD_TRANSFER orders are refused). */
    private readonly prepaid: PrepaidGate | null = null,
  ) {}

  /** The store id of a live store (same 404 for missing and unpublished). */
  liveStoreId(label: string): Promise<string> {
    return this.checkout.liveStoreId(label);
  }

  private shopperView(order: OrderView): ShopperOrder {
    const canPay = order.paymentMethod === "ONLINE" && order.status === "AWAITING_PAYMENT" && order.paymentDeadline !== null && new Date(order.paymentDeadline) > this.clock();
    const canCancel = canTransition("CUSTOMER", order.status, "CANCELLED") && (order.paymentMethod === "COD" || order.status === "AWAITING_PAYMENT");
    return { order, canCancel, canPay, transfer: null };
  }

  /** A single-order answer: with the card-to-card details; a receipt under review cannot be cancelled by the shopper. */
  private async full(storeId: string, v: ShopperOrder): Promise<ShopperOrder> {
    const transfer = this.prepaid ? await this.prepaid.transferInfo(storeId, v.order) : null;
    const reviewing = transfer?.receipts.some((r) => r.status === "SUBMITTED") ?? false;
    return { ...v, transfer, canCancel: v.canCancel && !reviewing };
  }

  /** Phase 3.5: the order behind a guest's access token (for starting its payment). */
  async orderIdByToken(label: string, token: string): Promise<{ storeId: string; orderId: string }> {
    const { storeId, order } = await this.byToken(label, token);
    return { storeId, orderId: order.id };
  }

  /** Phase 3.5: a signed-in customer's own order (for starting its payment). */
  async ownOrderId(storeId: string, customerId: string, id: string): Promise<string> {
    const own = ID_RE.test(id) ? await this.orders.getForCustomer(storeId, customerId, id, false) : null;
    if (!own) throw new NotFoundError();
    return own.id;
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
    if (existing) return { ...(await this.full(storeId, this.shopperView(existing))), accessToken: this.tokens.tokenFor(existing.id) };

    const prep = await this.checkout.prepareOrder(label, s, { address: q.address, addressId: q.addressId, shippingMethodId: q.shippingMethodId, cashOnDelivery: q.paymentMethod === "COD", discountCode: q.discountCode });
    // Phase 5.1: a code that does not apply is reported with its own reason (expired, exhausted, minimum order, ...).
    if (prep.summary.discountError) throw new DiscountInvalidError(prep.summary.discountError.reason as DiscountReason, prep.summary.discountError.minOrder);
    if (!prep.summary.ready || !prep.address) throw new OrderNotReadyError(prep.summary.blockers.length ? prep.summary.blockers : ["no_address"]);
    if (q.paymentMethod !== "COD") {
      if (!this.prepaid) throw new PaymentUnavailableError(q.paymentMethod === "CARD_TRANSFER" ? "no_cards" : "off");
      await this.prepaid.assertCanPay(storeId, prep.summary.total, q.paymentMethod, q.gateway);
    }
    await this.limit(`order-place:${storeId}:ip:${s.ipKey}`, ORDER_PLACE_RULE);
    await this.limit(`order-place:${storeId}:phone:${prep.address.phone}`, ORDER_PHONE_RULE);
    await this.limit(`order-place:${storeId}:all`, ORDER_STORE_RULE);

    const id = this.newId();
    const token = this.tokens.tokenFor(id);
    const order = draftOrder({
      id, storeId, customerId: s.customerId, requestKey, accessTokenHash: this.tokens.hash(token)!,
      summary: prep.summary, address: prep.address, weights: prep.weights, paymentMethod: q.paymentMethod, paymentGateway: q.gateway ?? null, note: q.note,
      paymentDeadline:
        q.paymentMethod === "ONLINE"
          ? new Date(this.clock().getTime() + PAYMENT_WINDOW_MINUTES * 60_000)
          : q.paymentMethod === "CARD_TRANSFER"
            ? new Date(this.clock().getTime() + CARD_TRANSFER_WINDOW_HOURS * 3600_000)
            : null,
    });
    const lines = order.items.map((i) => ({ productId: i.productId, variantId: i.variantId, quantity: i.quantity }));
    try {
      await this.stock.reserve(storeId, id, lines, ORDER_HOLD_SECONDS); // OutOfStockError: nothing held, nothing ordered
    } catch (e) {
      // review 3.4: the same checkout sent twice at once; the first one took the stock and placed the order
      const winner = await this.orders.findByRequestKey(storeId, requestKey);
      if (winner) return { ...(await this.full(storeId, this.shopperView(winner))), accessToken: this.tokens.tokenFor(winner.id) };
      throw e;
    }

    let created: OrderView | "hold_lost" | "duplicate";
    try {
      created = await this.orders.create(order, new Set(lines.map((l) => `${l.productId}|${l.variantId ?? "-"}`)).size, prep.cartId, this.clock(), prep.discountCart);
    } catch (e) {
      await this.stock.release(storeId, id).catch(() => 0);
      throw e;
    }
    if (created === "hold_lost" || created === "duplicate") {
      await this.stock.release(storeId, id).catch(() => 0);
      if (created === "hold_lost") throw new ReservationLostError();
      const winner = await this.orders.findByRequestKey(storeId, requestKey); // the same checkout, sent twice at once
      if (!winner) throw new ReservationLostError();
      return { ...(await this.full(storeId, this.shopperView(winner))), accessToken: this.tokens.tokenFor(winner.id) };
    }
    return { ...(await this.full(storeId, this.shopperView(created))), accessToken: token };
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
    const { storeId, order } = await this.byToken(label, token);
    return this.full(storeId, this.shopperView(order));
  }

  async cancelByToken(label: string, token: string, s: Shopper): Promise<ShopperOrder> {
    const { storeId, order } = await this.byToken(label, token);
    return this.full(storeId, this.shopperView(await this.cancelAsCustomer(storeId, order.id, s.customerId)));
  }

  /**
   * The signed-in customer's orders. Orders attached to their phone from guest checkouts are included only when the phone is verified by
   * an SMS code (phase 3.3b): a password account alone never proves the phone.
   */
  async listMine(storeId: string, customerId: string, verified = false): Promise<ShopperOrder[]> {
    const all = await this.orders.listForCustomer(storeId, customerId, 50, verified);
    // Orders attached only by phone are shown read-only: the phone on an order may be a gift recipient's (review 3.3b).
    const own = verified ? new Set((await this.orders.listForCustomer(storeId, customerId, 50, false)).map((o) => o.id)) : null;
    // In lists the receipts are not loaded: a card-to-card order is cancelled from its own page (which knows whether one is under review).
    const listed = (o: OrderView): ShopperOrder => {
      const v = this.shopperView(o);
      return o.paymentMethod === "CARD_TRANSFER" ? { ...v, canCancel: false } : v;
    };
    return all.map((o) => (own && !own.has(o.id) ? { order: o, canCancel: false, canPay: false, transfer: null } : listed(o)));
  }

  async getMine(storeId: string, customerId: string, id: string, verified = false): Promise<ShopperOrder> {
    const o = ID_RE.test(id) ? await this.orders.getForCustomer(storeId, customerId, id, verified) : null;
    if (!o) throw new NotFoundError();
    const own = !verified || (await this.orders.getForCustomer(storeId, customerId, id, false)) !== null;
    return own ? this.full(storeId, this.shopperView(o)) : { order: o, canCancel: false, canPay: false, transfer: null };
  }

  /** Only orders placed while signed in to this account (phone-attached ones are cancelled with their order link, by whoever placed them). */
  async cancelMine(storeId: string, customerId: string, id: string): Promise<ShopperOrder> {
    const own = ID_RE.test(id) ? await this.orders.getForCustomer(storeId, customerId, id, false) : null;
    if (!own) throw new NotFoundError();
    return this.full(storeId, this.shopperView(await this.cancelAsCustomer(storeId, id, customerId)));
  }

  private async cancelAsCustomer(storeId: string, id: string, customerId: string | null): Promise<OrderView> {
    const r = await this.orders.transition(storeId, id, "CANCELLED", (from, method) => {
      if (!canTransition("CUSTOMER", from, "CANCELLED")) throw new OrderTransitionError(from, "CANCELLED");
      // Review 3.5 / D35b-1: a PAID prepaid order is cancelled by the store (which returns the money), never by the shopper alone.
      if (method !== "COD" && from !== "AWAITING_PAYMENT") throw new OrderTransitionError(from, "CANCELLED");
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
