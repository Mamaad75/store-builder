import {
  MAX_ADDRESSES_PER_CUSTOMER,
  MAX_CART_LINES,
  MAX_CART_LINE_QUANTITY,
  addressInputSchema,
  cartLineInputSchema,
  checkoutQuoteSchema,
  type AddressInput,
} from "@store-builder/shared/modules/checkout/checkout";
import { CartLimitError, CartRateLimitedError } from "@store-builder/shared/modules/checkout/errors";
import { NotFoundError, ValidationError } from "@store-builder/shared/modules/stores/errors";
import type { StorefrontProduct } from "@store-builder/shared/templates/storefront-data";
import type { z } from "zod";
import { mergeLines, priceLines, stockKey, summarize, withDiscount, type CartLine, type CheckoutSummary, type PricedLine } from "../domain/quote.js";
import { DISCOUNT_REASON_MESSAGES, DISCOUNT_TRY_RULE, DISCOUNT_TRY_STORE_RULE, type DiscountCart } from "@store-builder/shared/modules/discounts/discounts";
import type { AddressStore, CartRow, CartStore, CartTokens, CheckoutReads, DiscountPort, Limiter, SavedAddress } from "./ports.js";

const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const ID_RE = /^[a-z0-9]{1,64}$/;

/**
 * New GUEST carts per client network per hour (adding to an existing cart is not limited; a customer has at most one cart). Per store, and
 * generous, because many shoppers share one IPv4 address behind mobile carrier NAT (review 3.3); plus a platform-wide ceiling per network.
 */
export const CART_CREATE_RULE = { limit: 120, windowSeconds: 3600 } as const;
export const CART_CREATE_PLATFORM_RULE = { limit: 1000, windowSeconds: 3600 } as const;

/** Who is shopping: the cart cookie (if any) and the signed-in customer of THIS store (resolved by the caller from the customer cookie). */
export interface Shopper {
  cartToken: string | null;
  customerId: string | null;
  /** Phase 3.3b: the signed-in customer's phone is proven by an SMS code (orders attached to the phone from guest checkouts are theirs). */
  customerVerified?: boolean;
  /** Rate-limit key of the client network (ipLimitKey). */
  ipKey: string;
}

export interface CartView {
  lines: PricedLine[];
  subtotal: number;
  /** Units in the cart (for the header badge). */
  count: number;
}

/** A result plus, when a new cart was created, the token the caller must put in the shopper's cookie. */
export interface WithToken<T> {
  result: T;
  newCartToken: string | null;
}

function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const r = schema.safeParse(input);
  if (!r.success) {
    const flat = r.error.flatten() as { fieldErrors: Record<string, string[]>; formErrors: string[] };
    throw new ValidationError(Object.keys(flat.fieldErrors).length ? flat.fieldErrors : { _: flat.formErrors.length ? flat.formErrors : ["درخواست نامعتبر است"] });
  }
  return r.data;
}

/**
 * The shopper's side of checkout (phase 3.3, D33-1): the cart, saved addresses, and the summary (prices, shipping, cash on delivery, total).
 * Store resolution is by the public label and only for a LIVE store; every unavailable case is the same NotFoundError.
 */
export class CheckoutService {
  constructor(
    private readonly carts: CartStore,
    private readonly reads: CheckoutReads,
    private readonly addresses: AddressStore,
    private readonly tokens: CartTokens,
    private readonly limiter: Limiter,
    /** Phase 5.1: discount codes (null = codes are not accepted). */
    private readonly discounts: DiscountPort | null = null,
  ) {}

  private async live(label: string): Promise<{ storeId: string; products: StorefrontProduct[] }> {
    if (typeof label !== "string" || !LABEL_RE.test(label)) throw new NotFoundError();
    const live = await this.reads.liveStore(label);
    if (!live) throw new NotFoundError();
    const products = await this.reads.publishedProducts(live.storeId, live.versionId);
    if (!products) throw new NotFoundError();
    return { storeId: live.storeId, products };
  }

  /** The store id of a live store (for callers that only need to know the store exists, e.g. address routes). */
  async liveStoreId(label: string): Promise<string> {
    if (typeof label !== "string" || !LABEL_RE.test(label)) throw new NotFoundError();
    const live = await this.reads.liveStore(label);
    if (!live) throw new NotFoundError();
    return live.storeId;
  }

  /**
   * The shopper's cart, or null. Without a session only a GUEST cart is visible (after signing out, the customer's cart is not shown to the
   * next person on the same device). Signed in: the guest cart of this device is folded into the customer's cart.
   */
  private async findCart(storeId: string, s: Shopper): Promise<CartRow | null> {
    const hash = s.cartToken ? this.tokens.hash(s.cartToken) : null;
    const device = hash ? await this.carts.findByTokenHash(storeId, hash) : null;
    if (!s.customerId) return device && device.customerId === null ? device : null;
    const mine = await this.carts.findByCustomer(storeId, s.customerId);
    if (device && device.customerId === null) {
      if (!mine) {
        if (await this.carts.attachCustomer(storeId, device.id, s.customerId)) return { ...device, customerId: s.customerId };
        // Another request gave the customer a cart meanwhile (one cart per customer, unique index): fold into that one.
        const theirs = await this.carts.findByCustomer(storeId, s.customerId);
        return theirs ? this.merge(storeId, device.id, theirs.id, s.customerId) : null;
      }
      return this.merge(storeId, device.id, mine.id, s.customerId);
    }
    return mine;
  }

  private async merge(storeId: string, guestId: string, customerCartId: string, customerId: string): Promise<CartRow | null> {
    await this.carts.mergeInto(storeId, guestId, customerCartId, (into, from) => mergeLines(into, from, MAX_CART_LINES, MAX_CART_LINE_QUANTITY));
    return this.carts.findByCustomer(storeId, customerId);
  }

  private async price(storeId: string, products: StorefrontProduct[], lines: CartLine[]): Promise<PricedLine[]> {
    if (lines.length === 0) return [];
    return priceLines(lines, products, await this.reads.stock(storeId, lines));
  }

  private view(lines: PricedLine[]): CartView {
    return {
      lines,
      subtotal: lines.reduce((s, l) => s + l.lineTotal, 0),
      count: lines.reduce((s, l) => s + l.quantity, 0),
    };
  }

  async getCart(label: string, s: Shopper): Promise<CartView> {
    const { storeId, products } = await this.live(label);
    const cart = await this.findCart(storeId, s);
    return this.view(await this.price(storeId, products, cart?.lines ?? []));
  }

  /**
   * `add`: adds `quantity` (>= 1) to the line (capped at the line maximum). `set`: sets it; 0 removes the line. Only products and variants
   * that are in the PUBLISHED store can be added; a product with variants needs one. A removal is always allowed (even of a line that is
   * no longer sold). Stock is not held here: the order step (3.4) reserves it, and the cart view shows shortages meanwhile.
   */
  async setLine(label: string, s: Shopper, body: unknown, mode: "add" | "set"): Promise<WithToken<CartView>> {
    const { storeId, products } = await this.live(label);
    const line = parse(cartLineInputSchema, body);
    if (mode === "add" && line.quantity < 1) throw new ValidationError({ quantity: ["تعداد باید دست‌کم ۱ باشد"] });
    if (line.quantity > 0) {
      const p = products.find((x) => x.id === line.productId);
      if (!p) throw new NotFoundError();
      if (p.variants.length > 0 && line.variantId === null) throw new ValidationError({ variantId: ["نوع کالا را انتخاب کنید"] });
      if (line.variantId !== null && !p.variants.some((v) => v.id === line.variantId)) throw new NotFoundError();
    }

    let cart = await this.findCart(storeId, s);
    let newCartToken: string | null = null;
    if (!cart) {
      if (line.quantity === 0) return { result: this.view([]), newCartToken: null };
      if (!s.customerId) {
        for (const [key, rule] of [[`cart-create:${storeId}:ip:${s.ipKey}`, CART_CREATE_RULE], [`cart-create:all:ip:${s.ipKey}`, CART_CREATE_PLATFORM_RULE]] as const) {
          const rl = await this.limiter.consume(key, rule);
          if (!rl.allowed) throw new CartRateLimitedError(rl.retryAfterSeconds);
        }
      }
      const t = this.tokens.create();
      cart = await this.carts.create(storeId, t.hash, s.customerId);
      newCartToken = t.token;
    }

    const key = stockKey(line.productId, line.variantId);
    const after = await this.carts.update(storeId, cart.id, (lines) => {
      const i = lines.findIndex((l) => stockKey(l.productId, l.variantId) === key);
      const current = i >= 0 ? lines[i]!.quantity : 0;
      const quantity = mode === "add" ? Math.min(MAX_CART_LINE_QUANTITY, current + line.quantity) : line.quantity;
      if (quantity === 0) return lines.filter((_, j) => j !== i);
      if (i >= 0) return lines.map((l, j) => (j === i ? { ...l, quantity } : l));
      if (lines.length >= MAX_CART_LINES) throw new CartLimitError(MAX_CART_LINES);
      return [...lines, { productId: line.productId, variantId: line.variantId, quantity }];
    });
    if (after === null) throw new NotFoundError();
    return { result: this.view(await this.price(storeId, products, after)), newCartToken };
  }

  async clearCart(label: string, s: Shopper): Promise<void> {
    const storeId = await this.liveStoreId(label);
    const cart = await this.findCart(storeId, s);
    if (cart) await this.carts.update(storeId, cart.id, () => []);
  }

  /**
   * The checkout summary for an address (typed, or a saved one of the signed-in customer), a chosen shipping method and cash on delivery.
   * Read-only: nothing is held or ordered. `ready` says whether an order could be placed now (phase 3.4).
   */
  async quote(label: string, s: Shopper, body: unknown): Promise<CheckoutSummary> {
    const summary = (await this.resolve(label, s, parse(checkoutQuoteSchema, body ?? {}))).summary;
    // The discount's internal id is for the order's redemption only; the shopper sees the code and the amounts.
    if (!summary.discount) return summary;
    const { id: _id, ...discount } = summary.discount;
    void _id;
    return { ...summary, discount: discount as CheckoutSummary["discount"] };
  }

  /**
   * Phase 3.4: everything the orders module needs to place an order, computed exactly like the summary (same prices, same rules): the
   * store, the summary, the FULL delivery address, the cart and the published weight per product (for the item snapshot).
   */
  async prepareOrder(
    label: string,
    s: Shopper,
    q: { address?: unknown; addressId?: string; shippingMethodId: string; cashOnDelivery: boolean; discountCode?: string },
  ): Promise<{ storeId: string; summary: CheckoutSummary; address: AddressInput | null; cartId: string | null; weights: Map<string, number | null>; discountCart: DiscountCart }> {
    const r = await this.resolve(label, s, q);
    return { storeId: r.storeId, summary: r.summary, address: r.address, cartId: r.cartId, weights: new Map(r.products.map((p) => [p.id, p.weightGrams])), discountCart: r.discountCart };
  }

  private async resolve(label: string, s: Shopper, q: { address?: unknown; addressId?: string; shippingMethodId?: string; cashOnDelivery: boolean; discountCode?: string }) {
    const { storeId, products } = await this.live(label);
    if (q.address !== undefined && q.addressId !== undefined) throw new ValidationError({ address: ["یا نشانی را وارد کنید یا یکی از نشانی‌های ذخیره‌شده را انتخاب کنید"] });
    let address: AddressInput | null = null;
    if (q.addressId !== undefined) {
      if (!s.customerId) throw new NotFoundError();
      const a = await this.addresses.get(storeId, s.customerId, q.addressId);
      if (!a) throw new NotFoundError();
      address = { recipientName: a.recipientName, phone: a.phone, province: a.province, city: a.city, line: a.line, postalCode: a.postalCode };
    } else if (q.address !== undefined) {
      address = parse(addressInputSchema, q.address) as AddressInput;
    }
    const cart = await this.findCart(storeId, s);
    const lines = await this.price(storeId, products, cart?.lines ?? []);
    const methods = await this.reads.enabledShippingMethods(storeId);
    let summary = summarize({ lines, published: products, methods, province: address?.province ?? null, shippingMethodId: q.shippingMethodId ?? null, cashOnDelivery: q.cashOnDelivery });
    // Phase 5.1: the discount is computed on the buyable lines (with their published category) and the chosen shipping cost.
    const categoryOf = new Map(products.map((p) => [p.id, p.categoryId ?? null]));
    const discountCart: DiscountCart = {
      lines: lines.filter((l) => !l.problem).map((l) => ({ productId: l.productId, categoryId: categoryOf.get(l.productId) ?? null, lineTotal: l.lineTotal })),
      subtotal: summary.subtotal,
      shippingCost: summary.shippingCost,
    };
    const code = q.discountCode?.trim();
    if (code && this.discounts) {
      // Codes must not be guessable by trying (review 5.1): every DIFFERENT code a network tries is counted BEFORE the lookup, so a blocked
      // network gets 429 for existing and missing codes alike; quoting again with the same code is free. A store-wide count of new codes
      // limits guessing spread over many addresses.
      const first = await this.limiter.consume(`discount-seen:${storeId}:ip:${s.ipKey}:${code.toUpperCase().slice(0, 64)}`, { limit: 1, windowSeconds: DISCOUNT_TRY_RULE.windowSeconds });
      if (first.allowed) {
        for (const [key, rule] of [[`discount-try:${storeId}:ip:${s.ipKey}`, DISCOUNT_TRY_RULE], [`discount-try:${storeId}:all`, DISCOUNT_TRY_STORE_RULE]] as const) {
          const r = await this.limiter.consume(key, rule);
          if (!r.allowed) throw new CartRateLimitedError(r.retryAfterSeconds);
        }
      }
      // Per-customer and first-order limits are checked here only for a signed-in customer's own account: a typed phone must not reveal
      // whether that number has ordered (review 5.1). The order checks every limit with the order's phone under the discount's lock.
      const ev = await this.discounts.evaluate(storeId, code, discountCart, { phone: null, customerId: s.customerId });
      summary = ev.rule && ev.result.ok
        ? withDiscount(summary, { applied: { id: ev.rule.id, code: ev.rule.code, amount: ev.result.amount, itemsDiscount: ev.result.itemsDiscount, shippingDiscount: ev.result.shippingDiscount } })
        : withDiscount(summary, {
            error: {
              code: code.toUpperCase().slice(0, 32),
              reason: ev.result.ok ? "not_found" : ev.result.reason,
              message: DISCOUNT_REASON_MESSAGES[ev.result.ok ? "not_found" : ev.result.reason],
              ...(!ev.result.ok && ev.result.minOrder !== undefined ? { minOrder: ev.result.minOrder } : {}),
            },
          });
    }
    return { storeId, products, summary, address, cartId: cart?.id ?? null, discountCart };
  }

  // ---------- saved addresses (signed-in customers of this store) ----------

  listAddresses(storeId: string, customerId: string): Promise<SavedAddress[]> {
    return this.addresses.list(storeId, customerId);
  }

  async createAddress(storeId: string, customerId: string, body: unknown): Promise<SavedAddress> {
    return this.addresses.create(storeId, customerId, parse(addressInputSchema, body) as AddressInput, MAX_ADDRESSES_PER_CUSTOMER);
  }

  async updateAddress(storeId: string, customerId: string, id: string, body: unknown): Promise<SavedAddress> {
    if (!ID_RE.test(id)) throw new NotFoundError();
    const a = await this.addresses.update(storeId, customerId, id, parse(addressInputSchema, body) as AddressInput);
    if (!a) throw new NotFoundError();
    return a;
  }

  async deleteAddress(storeId: string, customerId: string, id: string): Promise<void> {
    if (!ID_RE.test(id) || !(await this.addresses.delete(storeId, customerId, id))) throw new NotFoundError();
  }
}
