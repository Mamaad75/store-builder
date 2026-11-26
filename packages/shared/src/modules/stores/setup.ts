/**
 * MVP item 3: the store setup checklist. What a store needs before a shopper can finish an order. Pure: the API gathers the facts, this
 * decides (one definition for the API, its tests and the dashboard labels). Nothing is stored; it is recomputed on every read.
 */
export const SETUP_KEYS = ["product", "shipping", "payment", "subdomain", "publish"] as const;
export type SetupKey = (typeof SETUP_KEYS)[number];

export interface SetupFacts {
  /** Products with status ACTIVE. */
  activeProducts: number;
  /** Shipping methods that are switched on. */
  enabledShipping: number;
  /** Switched-on shipping methods that also allow cash on delivery. */
  codShipping: number;
  /** The store has bank cards for card-to-card payments. */
  hasBankCards: boolean;
  /** Online gateways the store can take payments through right now (platform switch on and a valid credential). */
  onlineGateways: number;
  hasSubdomain: boolean;
  published: boolean;
}

export interface SetupItem {
  key: SetupKey;
  done: boolean;
}
export interface SetupChecklist {
  items: SetupItem[];
  /** Which payment methods are usable now (empty when the payment item is open). */
  paymentMethods: ("cod" | "online" | "cardTransfer")[];
  complete: boolean;
}

export function buildSetupChecklist(f: SetupFacts): SetupChecklist {
  const paymentMethods: SetupChecklist["paymentMethods"] = [];
  // Cash on delivery is a property of a shipping method, so it needs an enabled one.
  if (f.codShipping > 0) paymentMethods.push("cod");
  if (f.onlineGateways > 0) paymentMethods.push("online");
  if (f.hasBankCards) paymentMethods.push("cardTransfer");
  const done: Record<SetupKey, boolean> = {
    product: f.activeProducts > 0,
    shipping: f.enabledShipping > 0,
    payment: paymentMethods.length > 0,
    subdomain: f.hasSubdomain,
    publish: f.published,
  };
  const items = SETUP_KEYS.map((key) => ({ key, done: done[key] }));
  return { items, paymentMethods, complete: items.every((i) => i.done) };
}

/** Persian label and the dashboard page (under /dashboard/stores/:id) where the merchant fixes each item. */
export const SETUP_ITEM_TEXT: Readonly<Record<SetupKey, { label: string; hint: string; path: string }>> = {
  product: { label: "حداقل یک محصول فعال", hint: "محصولی با وضعیت «فعال» اضافه کنید.", path: "/products/new" },
  shipping: { label: "حداقل یک روش ارسال فعال", hint: "بدون روش ارسال، خریدار نمی‌تواند سفارش را کامل کند.", path: "/shipping" },
  payment: { label: "حداقل یک روش پرداخت فعال", hint: "پرداخت در محل (در روش ارسال)، کارت‌به‌کارت یا درگاه اینترنتی.", path: "/payments" },
  subdomain: { label: "آدرس فروشگاه", hint: "نشانی فروشگاه را انتخاب کنید.", path: "/publish" },
  publish: { label: "انتشار فروشگاه", hint: "پس از تکمیل موارد بالا فروشگاه را منتشر کنید.", path: "/publish" },
};
