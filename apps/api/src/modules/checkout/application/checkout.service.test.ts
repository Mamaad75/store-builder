import { describe, expect, it } from "vitest";
import { MAX_CART_LINES, shippingMethodInputSchema, type AddressInput, type ShippingMethod, type ShippingMethodInput } from "@store-builder/shared/modules/checkout/checkout";
import { CartLimitError, CartRateLimitedError } from "@store-builder/shared/modules/checkout/errors";
import { NotFoundError, ValidationError } from "@store-builder/shared/modules/stores/errors";
import type { StorefrontProduct } from "@store-builder/shared/templates/storefront-data";
import { stockKey, type CartLine, type StockFact } from "../domain/quote.js";
import { CheckoutService, type Shopper } from "./checkout.service.js";
import type { AddressStore, CartRow, CartStore, CartTokens, CheckoutReads, SavedAddress, ShippingStore } from "./ports.js";
import { ShippingService } from "./shipping.service.js";

const product = (over: Partial<StorefrontProduct>): StorefrontProduct => ({
  id: "p1", name: "چای", slug: "chai", description: "", price: 100_000, stockQuantity: 10, categoryId: null, image: null, specs: [], variants: [], weightGrams: 500,
  ...over,
});

class MemoryCarts implements CartStore {
  carts: { id: string; storeId: string; tokenHash: string; customerId: string | null; lines: CartLine[] }[] = [];
  private n = 0;
  private find(f: (c: MemoryCarts["carts"][number]) => boolean): CartRow | null {
    const c = this.carts.find(f);
    return c ? { id: c.id, customerId: c.customerId, lines: c.lines.map((l) => ({ ...l })) } : null;
  }
  async findByTokenHash(storeId: string, h: string) { return this.find((c) => c.storeId === storeId && c.tokenHash === h); }
  async findByCustomer(storeId: string, id: string) { return this.find((c) => c.storeId === storeId && c.customerId === id); }
  async create(storeId: string, tokenHash: string, customerId: string | null) {
    const c = { id: `c${++this.n}`, storeId, tokenHash, customerId, lines: [] };
    this.carts.push(c);
    return { id: c.id, customerId, lines: [] };
  }
  async update(storeId: string, id: string, change: (l: CartLine[]) => CartLine[]) {
    const c = this.carts.find((x) => x.id === id && x.storeId === storeId);
    if (!c) return null;
    c.lines = change(c.lines.map((l) => ({ ...l })));
    return c.lines;
  }
  async attachCustomer(storeId: string, id: string, customerId: string) {
    const c = this.carts.find((x) => x.id === id && x.storeId === storeId && x.customerId === null);
    if (c) c.customerId = customerId;
  }
  async mergeInto(storeId: string, guestId: string, intoId: string, merge: (a: CartLine[], b: CartLine[]) => CartLine[]) {
    const g = this.carts.find((x) => x.id === guestId)!;
    const into = this.carts.find((x) => x.id === intoId)!;
    into.lines = merge(into.lines, g.lines);
    this.carts = this.carts.filter((x) => x.id !== guestId);
  }
  async purgeExpired() { return 0; }
}

const tokens: CartTokens = {
  create: (() => {
    let i = 0;
    return () => { i += 1; const token = `tok${i}`; return { token, hash: `h:${token}` }; };
  })(),
  hash: (t) => (t.startsWith("tok") ? `h:${t}` : null),
};

function setup(o: { allowCreate?: boolean; products?: StorefrontProduct[]; stock?: Map<string, StockFact>; methods?: ShippingMethod[] } = {}) {
  const carts = new MemoryCarts();
  const products = o.products ?? [
    product({}),
    product({ id: "p2", variants: [{ id: "v1", options: [{ name: "سایز", value: "M" }], price: 150_000, stockQuantity: 2 }] }),
  ];
  const stock = o.stock ?? new Map<string, StockFact>([[stockKey("p1", null), { productActive: true, available: 10 }], [stockKey("p2", "v1"), { productActive: true, available: 2 }]]);
  const reads: CheckoutReads = {
    liveStore: async (label) => (label === "shop" ? { storeId: "s1", versionId: "ver1" } : null),
    publishedProducts: async () => products,
    stock: async () => stock,
    enabledShippingMethods: async () => o.methods ?? [],
  };
  const saved: (SavedAddress & { customerId: string })[] = [];
  const addresses: AddressStore = {
    list: async (_s, c) => saved.filter((a) => a.customerId === c),
    get: async (_s, c, id) => saved.find((a) => a.customerId === c && a.id === id) ?? null,
    create: async (_s, c, a: AddressInput) => { const x = { ...a, id: `a${saved.length + 1}`, customerId: c }; saved.push(x); return x; },
    update: async () => null,
    delete: async () => false,
  };
  const svc = new CheckoutService(carts, reads, addresses, tokens, { consume: async () => ({ allowed: o.allowCreate ?? true, retryAfterSeconds: 60 }) });
  return { svc, carts, addresses };
}

const guest = (cartToken: string | null = null): Shopper => ({ cartToken, customerId: null, ipKey: "1.2.3.4" });

describe("cart", () => {
  it("the first add creates the cart and hands out its token; later adds with the token add up", async () => {
    const { svc } = setup();
    const first = await svc.setLine("shop", guest(), { productId: "p1", quantity: 2 }, "add");
    expect(first.newCartToken).toMatch(/^tok/);
    const second = await svc.setLine("shop", guest(first.newCartToken), { productId: "p1", quantity: 3 }, "add");
    expect(second.newCartToken).toBeNull();
    expect(second.result).toMatchObject({ subtotal: 500_000, count: 5 });
    expect((await svc.getCart("shop", guest(first.newCartToken))).lines).toHaveLength(1);
  });

  it("only published products and variants can be added; a product with variants needs one", async () => {
    const { svc } = setup();
    await expect(svc.setLine("shop", guest(), { productId: "nope", quantity: 1 }, "add")).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc.setLine("shop", guest(), { productId: "p2", quantity: 1 }, "add")).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.setLine("shop", guest(), { productId: "p2", variantId: "v9", quantity: 1 }, "add")).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc.setLine("shop", guest(), { productId: "p1", quantity: 1, price: 1 }, "add")).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.setLine("other", guest(), { productId: "p1", quantity: 1 }, "add")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("set changes the quantity and 0 removes the line; removing from no cart creates nothing", async () => {
    const { svc, carts } = setup();
    expect((await svc.setLine("shop", guest(), { productId: "p1", quantity: 0 }, "set")).newCartToken).toBeNull();
    expect(carts.carts).toHaveLength(0);
    const t = (await svc.setLine("shop", guest(), { productId: "p1", quantity: 2 }, "add")).newCartToken;
    expect((await svc.setLine("shop", guest(t), { productId: "p1", quantity: 7 }, "set")).result.count).toBe(7);
    expect((await svc.setLine("shop", guest(t), { productId: "p1", quantity: 0 }, "set")).result.lines).toEqual([]);
  });

  it("adding caps a line at the maximum and refuses a line beyond the cart limit", async () => {
    const products = Array.from({ length: MAX_CART_LINES + 1 }, (_, i) => product({ id: `p${i}`, slug: `s${i}` }));
    const { svc, carts } = setup({ products, stock: new Map() });
    const t = (await svc.setLine("shop", guest(), { productId: "p0", quantity: 999 }, "add")).newCartToken;
    await svc.setLine("shop", guest(t), { productId: "p0", quantity: 5 }, "add");
    expect(carts.carts[0]!.lines[0]!.quantity).toBe(1000);
    for (let i = 1; i < MAX_CART_LINES; i++) await svc.setLine("shop", guest(t), { productId: `p${i}`, quantity: 1 }, "add");
    await expect(svc.setLine("shop", guest(t), { productId: `p${MAX_CART_LINES}`, quantity: 1 }, "add")).rejects.toBeInstanceOf(CartLimitError);
  });

  it("new carts are rate limited per network (adding to an existing cart is not)", async () => {
    const { svc } = setup({ allowCreate: false });
    await expect(svc.setLine("shop", guest(), { productId: "p1", quantity: 1 }, "add")).rejects.toBeInstanceOf(CartRateLimitedError);
  });

  it("a forged or unknown token is just no cart", async () => {
    const { svc } = setup();
    expect((await svc.getCart("shop", guest("garbage"))).lines).toEqual([]);
    expect((await svc.getCart("shop", guest("tok999"))).lines).toEqual([]);
  });

  it("signing in folds this device's guest cart into the customer's; after signing out the device no longer shows it", async () => {
    const { svc, carts } = setup();
    const mine = { cartToken: null, customerId: "cust1", ipKey: "x" };
    await svc.setLine("shop", mine, { productId: "p1", quantity: 1 }, "add"); // the customer's cart (another device)
    const t = (await svc.setLine("shop", guest(), { productId: "p1", quantity: 2 }, "add")).newCartToken;
    await svc.setLine("shop", guest(t), { productId: "p2", variantId: "v1", quantity: 1 }, "add");
    const merged = await svc.getCart("shop", { ...mine, cartToken: t });
    expect(merged.lines.map((l) => [l.productId, l.quantity])).toEqual([["p1", 3], ["p2", 1]]);
    expect(carts.carts).toHaveLength(1);
    // signed out on this device: the token now points at nothing visible
    expect((await svc.getCart("shop", guest(t))).lines).toEqual([]);
  });

  it("signing in with only a guest cart makes it the customer's; a signed-out device never sees a customer's cart", async () => {
    const { svc, carts } = setup();
    const t = (await svc.setLine("shop", guest(), { productId: "p1", quantity: 1 }, "add")).newCartToken!;
    expect((await svc.getCart("shop", { cartToken: t, customerId: "cust1", ipKey: "x" })).count).toBe(1);
    expect(carts.carts[0]!.customerId).toBe("cust1");
    expect((await svc.getCart("shop", guest(t))).count).toBe(0);
  });
});

describe("checkout quote", () => {
  const address = { recipientName: "علی رضایی", phone: "09123456789", province: "tehran", city: "تهران", line: "خیابان آزادی، پلاک ۱۲", postalCode: "1384567891" };
  const methods = [{ ...shippingMethodInputSchema.parse({ name: "پست", kind: "FLAT", price: 30_000 }), id: "m1" }];

  it("a typed address gives the province; the address is validated field by field", async () => {
    const { svc } = setup({ methods });
    const t = (await svc.setLine("shop", guest(), { productId: "p1", quantity: 1 }, "add")).newCartToken;
    expect(await svc.quote("shop", guest(t), { address, shippingMethodId: "m1" })).toMatchObject({ total: 130_000, ready: true });
    await expect(svc.quote("shop", guest(t), { address: { ...address, postalCode: "12" } })).rejects.toMatchObject({ fieldErrors: { postalCode: expect.any(Array) } });
  });

  it("a saved address needs the signed-in customer who owns it; both kinds at once are refused", async () => {
    const { svc, addresses } = setup({ methods });
    const saved = await addresses.create("s1", "cust1", { ...address, phone: "+989123456789" }, 10);
    await expect(svc.quote("shop", guest(), { addressId: saved.id })).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc.quote("shop", { cartToken: null, customerId: "cust2", ipKey: "x" }, { addressId: saved.id })).rejects.toBeInstanceOf(NotFoundError);
    expect((await svc.quote("shop", { cartToken: null, customerId: "cust1", ipKey: "x" }, { addressId: saved.id })).blockers).toEqual(["empty_cart", "choose_shipping"]);
    await expect(svc.quote("shop", guest(), { address, addressId: saved.id })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("shipping methods (merchant)", () => {
  it("validates the whole list before anything is stored", async () => {
    let stored: readonly ShippingMethodInput[] = [];
    const store: ShippingStore = { list: async () => [], replace: async (_s, m) => { stored = m; return m.map((x, i) => ({ ...x, id: `m${i}` })); } };
    const svc = new ShippingService(store);
    await expect(svc.replace({ storeId: "s1" }, { methods: [{ name: "حضوری", kind: "PICKUP", price: 5 }] })).rejects.toBeInstanceOf(ValidationError);
    expect(stored).toEqual([]);
    const out = await svc.replace({ storeId: "s1" }, { methods: [{ name: " پست ", kind: "FLAT", price: 30_000 }] });
    expect(out[0]).toMatchObject({ id: "m0", name: "پست", enabled: true, provinces: [], cashOnDelivery: { enabled: false } });
  });
});
