import type { AddressInput, ShippingKind } from "@store-builder/shared/modules/checkout/checkout";
import type { Gateway, OrderActor, OrderStatus, PaymentMethod } from "@store-builder/shared/modules/orders/orders";

/** Phase 3.4 (D34-1). Pure: no I/O. */

/** The part of a checkout summary (phase 3.3) an order is drafted from (structurally the checkout module's CheckoutSummary). */
export interface ReadySummary {
  ready: boolean;
  lines: { productId: string; variantId: string | null; name: string; variantLabel: string; unitPrice: number; quantity: number; lineTotal: number }[];
  shippingOptions: { methodId: string; name: string; kind: ShippingKind }[];
  shippingMethodId: string | null;
  shippingCost: number;
  codFee: number;
  subtotal: number;
  total: number;
  blockers: string[];
  /** Phase 5.1: the applied discount code (id for the redemption). */
  discount?: { id: string; code: string; amount: number } | null;
  /** Phase 5.1: why the code given does not apply. */
  discountError?: { reason: string; minOrder?: number } | null;
}

export interface NewOrderItem {
  productId: string;
  variantId: string | null;
  name: string;
  variantLabel: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
  weightGrams: number | null;
  position: number;
}

export interface NewOrder {
  id: string;
  storeId: string;
  customerId: string | null;
  requestKey: string;
  accessTokenHash: string;
  address: AddressInput;
  shipping: { methodId: string; name: string; kind: ShippingKind; cost: number };
  paymentMethod: PaymentMethod;
  /** D35c-1: the gateway of an ONLINE order, else null. */
  paymentGateway: Gateway | null;
  /** Phase 3.5: online orders only; the order waits for its payment until then. */
  paymentDeadline: Date | null;
  codFee: number;
  subtotal: number;
  total: number;
  itemCount: number;
  note: string;
  items: NewOrderItem[];
  /** Phase 5.1: the discount code, redeemed in the order's own transaction (re-checked there on `discountCart`). */
  discount: { id: string; code: string; amount: number } | null;
}

/**
 * The order snapshot from a READY checkout summary: only buyable lines (a ready summary has no others), the chosen shipping option,
 * the amounts exactly as the summary computed them. Throws if the summary is not ready (callers check first).
 */
export function draftOrder(o: {
  id: string;
  storeId: string;
  customerId: string | null;
  requestKey: string;
  accessTokenHash: string;
  summary: ReadySummary;
  address: AddressInput;
  weights: ReadonlyMap<string, number | null>;
  paymentMethod: PaymentMethod;
  paymentGateway?: Gateway | null;
  paymentDeadline?: Date | null;
  note: string;
}): NewOrder {
  const s = o.summary;
  const shipping = s.shippingOptions.find((x) => x.methodId === s.shippingMethodId);
  if (!s.ready || !shipping) throw new Error("draftOrder needs a ready summary with a chosen shipping method");
  const items = s.lines.map((l, position) => ({
    productId: l.productId,
    variantId: l.variantId,
    name: l.name,
    variantLabel: l.variantLabel,
    unitPrice: l.unitPrice,
    quantity: l.quantity,
    lineTotal: l.lineTotal,
    weightGrams: o.weights.get(l.productId) ?? null,
    position,
  }));
  return {
    id: o.id,
    storeId: o.storeId,
    customerId: o.customerId,
    requestKey: o.requestKey,
    accessTokenHash: o.accessTokenHash,
    address: o.address,
    shipping: { methodId: shipping.methodId, name: shipping.name, kind: shipping.kind, cost: s.shippingCost },
    paymentMethod: o.paymentMethod,
    paymentGateway: o.paymentMethod === "ONLINE" ? (o.paymentGateway ?? "ZARINPAL") : null,
    paymentDeadline: o.paymentMethod === "COD" ? null : (o.paymentDeadline ?? null),
    codFee: s.codFee,
    subtotal: s.subtotal,
    total: s.total,
    discount: s.discount ? { id: s.discount.id, code: s.discount.code, amount: s.discount.amount } : null,
    itemCount: items.reduce((n, i) => n + i.quantity, 0),
    note: o.note,
    items,
  };
}

export interface OrderView {
  id: string;
  number: number;
  status: OrderStatus;
  createdAt: string;
  customerId: string | null;
  address: AddressInput;
  shipping: { name: string; kind: ShippingKind; cost: number };
  paymentMethod: PaymentMethod;
  paymentGateway: Gateway | null;
  /** Phase 3.5: until when an unpaid online order can be paid (ISO), null otherwise. */
  paymentDeadline: string | null;
  /** Phase 5.1: the discount code used and the whole discount (items + shipping); `total` already reflects it. */
  discountCode: string | null;
  discountAmount: number;
  /** Phase 3.5: the online payment once verified (reference number and masked card), null otherwise. */
  payment: { refId: string; cardPan: string | null; paidAt: string } | null;
  subtotal: number;
  codFee: number;
  total: number;
  itemCount: number;
  note: string;
  /** The carrier's tracking code (shipped orders), shown to the shopper too. */
  trackingCode: string | null;
  items: Omit<NewOrderItem, "position">[];
  history: { from: OrderStatus | null; to: OrderStatus; actor: OrderActor; note: string; at: string }[];
}

/** Phase 3.5: the text shown on the Zarinpal page and in the merchant's Zarinpal panel (at most 500 characters). */
export function paymentDescription(storeName: string, orderNumber: number): string {
  return `سفارش ${orderNumber} از ${storeName}`.slice(0, 500);
}
