import type { AddressInput, ShippingKind } from "@store-builder/shared/modules/checkout/checkout";
import type { OrderActor, OrderStatus, PaymentMethod } from "@store-builder/shared/modules/orders/orders";

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
  /** Phase 3.5: online orders only; the order waits for its payment until then. */
  paymentDeadline: Date | null;
  codFee: number;
  subtotal: number;
  total: number;
  itemCount: number;
  note: string;
  items: NewOrderItem[];
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
    paymentDeadline: o.paymentMethod === "ONLINE" ? (o.paymentDeadline ?? null) : null,
    codFee: s.codFee,
    subtotal: s.subtotal,
    total: s.total,
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
  /** Phase 3.5: until when an unpaid online order can be paid (ISO), null otherwise. */
  paymentDeadline: string | null;
  /** Phase 3.5: the online payment once verified (reference number and masked card), null otherwise. */
  payment: { refId: string; cardPan: string | null; paidAt: string } | null;
  subtotal: number;
  codFee: number;
  total: number;
  itemCount: number;
  note: string;
  items: Omit<NewOrderItem, "position">[];
  history: { from: OrderStatus | null; to: OrderStatus; actor: OrderActor; note: string; at: string }[];
}

/** Phase 3.5: the text shown on the Zarinpal page and in the merchant's Zarinpal panel (at most 500 characters). */
export function paymentDescription(storeName: string, orderNumber: number): string {
  return `سفارش ${orderNumber} از ${storeName}`.slice(0, 500);
}
