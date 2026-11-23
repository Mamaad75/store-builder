import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma, resetDb } from "../../test/db-helpers.js";
import { revision, twoTenants, validProduct } from "../../test/catalog-helpers.js";
import { NotFoundError, ValidationError } from "@store-builder/shared/modules/stores/errors";
import { makeStorefront, PRODUCT_A } from "@store-builder/shared/testing/storefront-fixtures";
import { createProduct, deleteProduct, updateProduct } from "../products/service.js";
import { createInventoryService } from "../inventory/inventory.api.js";
import { clearLivePriceCache, livePricesOf, withLivePrices } from "../publishing/public-read.js";
import { PricingService } from "./application/pricing.service.js";
import { RatesService } from "./application/rates.service.js";
import { PrismaLinkReader, PrismaLinkUnitOfWork, PrismaRateStore, PrismaRepricer } from "./infrastructure/prisma-pricing.repository.js";
import { PLATFORM_SETTING_DEFAULTS } from "@store-builder/shared/modules/platform/settings";

const NOW = new Date("2026-11-24T10:00:00Z");
const rateStore = new PrismaRateStore();
const pricing = new PricingService(new PrismaLinkReader(), new PrismaLinkUnitOfWork(), rateStore, () => NOW);
const rates = new RatesService(rateStore, { settings: async () => ({ ...PLATFORM_SETTING_DEFAULTS.rates, provider: "manual" }), source: async () => null }, new PrismaRepricer(), () => NOW);
const inventory = createInventoryService();

beforeEach(async () => {
  await resetDb();
  await prisma.$executeRawUnsafe(`TRUNCATE "ExchangeRate"`);
  clearLivePriceCache();
});
afterAll(() => prisma.$disconnect());

let admin = "";
async function setup() {
  const t = await twoTenants();
  admin = t.b.id; // any existing user id works for decidedById / audit actor in these tests
  await rates.enterManual(admin, { code: "USD", rateToman: 100_000 });
  await rates.enterManual(admin, { code: "GOLD18", rateToman: 8_000_000 });
  return t;
}
const priceOf = async (id: string) => (await prisma.product.findUniqueOrThrow({ where: { id } })).price;
const live = async (storeId: string) => Object.fromEntries((await prisma.livePrice.findMany({ where: { storeId } })).map((r) => [`${r.productId}|${r.target}`, r.priceToman]));

describe("linked prices (DB)", () => {
  it("a dollar-linked product gets its price at once, follows a new rate, and its price cannot be edited by hand", async () => {
    const { a, a1 } = await setup();
    const p = await createProduct(a.id, a1, validProduct({ price: 1 }));
    const r0 = await revision(a1);
    const view = await pricing.setLink({ storeId: a1, ownerId: a.id }, p.id, { link: { kind: "USD", fromToman: 5_000_000 } });
    expect(view).toMatchObject({ usdCents: 5_000, lastPriceToman: 5_000_000, status: "OK" });
    expect(await priceOf(p.id)).toBe(5_000_000);
    expect(await revision(a1)).toBe(r0 + 1); // the merchant's link is a draft edit
    expect(await live(a1)).toEqual({ [`${p.id}|-`]: 5_000_000 });
    await expect(updateProduct(a.id, a1, p.id, { price: 7 })).rejects.toBeInstanceOf(ValidationError);
    await expect(updateProduct(a.id, a1, p.id, { name: "نام دیگر" })).resolves.toMatchObject({ name: "نام دیگر" });

    const r1 = await revision(a1);
    await rates.enterManual(admin, { code: "USD", rateToman: 102_345 });
    expect(await priceOf(p.id)).toBe(5_117_000);
    expect(await live(a1)).toEqual({ [`${p.id}|-`]: 5_117_000 });
    expect(await revision(a1)).toBe(r1); // repricing never takes the store lock or bumps the draft revision
  });

  it("variants: the jewellery formula per variant; the product shows the lowest; replacing variants keeps linked prices", async () => {
    const { a, a1 } = await setup();
    const p = await createProduct(a.id, a1, validProduct());
    const set = (rows: [string, number, number][]) => ({ variants: rows.map(([value, price, stockQuantity]) => ({ options: [{ name: "سایز", value }], price, stockQuantity })) });
    const [s16, s18] = await inventory.replaceVariants({ storeId: a1, ownerId: a.id }, p.id, set([["16", 50_000_000, 1], ["18", 60_000_000, 1]]));
    await expect(pricing.setLink({ storeId: a1, ownerId: a.id }, p.id, { link: { kind: "GOLD", weightMg: 3_000 } })).rejects.toBeInstanceOf(ValidationError); // per variant
    await pricing.setLink({ storeId: a1, ownerId: a.id }, p.id, { variantId: s16!.id, link: { kind: "GOLD", weightMg: 3_000, wageBp: 1_500, profitBp: 700, taxBp: 900, roundingToman: 1 } });
    // 3 g x 8,000,000 = 24,000,000; labour 3,600,000; profit 7% of 27,600,000 = 1,932,000; tax 9% of 5,532,000 = 497,880
    const expected = 24_000_000 + 3_600_000 + 1_932_000 + 497_880;
    expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: s16!.id } })).price).toBe(expected);
    expect(await priceOf(p.id)).toBe(expected); // lower than the 60,000,000 of size 18
    // live: one row per link only; the storefront derives the lowest price from the PUBLISHED variants
    expect(await live(a1)).toEqual({ [`${p.id}|${s16!.id}`]: expected });

    // the merchant edits stock and sends a price for the linked variant: the link keeps its price
    await inventory.replaceVariants({ storeId: a1, ownerId: a.id }, p.id, set([["16", 1, 9], ["18", 60_000_000, 2]]));
    expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: s16!.id } }))).toMatchObject({ price: expected, stockQuantity: 9 });
    expect(await priceOf(p.id)).toBe(expected);

    // unlink: the live rows go; the price stays at its last value
    await pricing.removeLink({ storeId: a1, ownerId: a.id }, p.id, { variantId: s16!.id });
    expect(await live(a1)).toEqual({});
    expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: s16!.id } })).price).toBe(expected);
    void s18;
  });

  it("regression (security review 3.2b): removing a linked variant removes its live price at once; the hourly run removes any leftover", async () => {
    const { a, a1 } = await setup();
    const p = await createProduct(a.id, a1, validProduct());
    const set = (rows: string[]) => ({ variants: rows.map((value) => ({ options: [{ name: "سایز", value }], price: 1_000_000, stockQuantity: 1 })) });
    const [s16] = await inventory.replaceVariants({ storeId: a1, ownerId: a.id }, p.id, set(["16", "18"]));
    await pricing.setLink({ storeId: a1, ownerId: a.id }, p.id, { variantId: s16!.id, link: { kind: "GOLD", weightMg: 1_000 } });
    expect(Object.keys(await live(a1))).toEqual([`${p.id}|${s16!.id}`]);
    await inventory.replaceVariants({ storeId: a1, ownerId: a.id }, p.id, { variants: [] });
    expect(await live(a1)).toEqual({});
    // a leftover written behind the application's back is cleaned by the next run
    await prisma.livePrice.create({ data: { storeId: a1, productId: p.id, target: "ghost", priceToman: 1, updatedAt: NOW } });
    await rates.reprice();
    expect(await live(a1)).toEqual({});
  });

  it("a product-level link excludes variants until it is removed", async () => {
    const { a, a1 } = await setup();
    const p = await createProduct(a.id, a1, validProduct());
    await pricing.setLink({ storeId: a1, ownerId: a.id }, p.id, { link: { kind: "USD", usdCents: 1_000 } });
    await expect(inventory.replaceVariants({ storeId: a1, ownerId: a.id }, p.id, { variants: [{ options: [{ name: "a", value: "b" }], price: 1, stockQuantity: 1 }] })).rejects.toBeInstanceOf(ValidationError);
  });

  it("tenant isolation: another store cannot see or link this store's product; another owner cannot use this store", async () => {
    const { a, b, a1, b1 } = await setup();
    const p = await createProduct(a.id, a1, validProduct());
    await expect(pricing.setLink({ storeId: b1, ownerId: b.id }, p.id, { link: { kind: "USD", fromToman: 1_000_000 } })).rejects.toBeInstanceOf(NotFoundError);
    await expect(pricing.setLink({ storeId: a1, ownerId: b.id }, p.id, { link: { kind: "USD", fromToman: 1_000_000 } })).rejects.toBeInstanceOf(NotFoundError);
    await expect(pricing.links({ storeId: b1, ownerId: b.id }, p.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(await prisma.priceLink.count()).toBe(0);
  });

  it("an out-of-range result keeps the last price and marks the link", async () => {
    const { a, a1 } = await setup();
    const p = await createProduct(a.id, a1, validProduct());
    await pricing.setLink({ storeId: a1, ownerId: a.id }, p.id, { link: { kind: "USD", usdCents: 900_000 } }); // $9,000 -> 900,000,000
    await rates.enterManual(admin, { code: "USD", rateToman: 200_000 }); // -> 1.8e9, above the cap
    expect(await priceOf(p.id)).toBe(900_000_000);
    expect((await prisma.priceLink.findFirstOrThrow({ where: { productId: p.id } })).status).toBe("OUT_OF_RANGE");
  });

  it("deleting the product removes its links and live rows", async () => {
    const { a, a1 } = await setup();
    const p = await createProduct(a.id, a1, validProduct());
    await pricing.setLink({ storeId: a1, ownerId: a.id }, p.id, { link: { kind: "USD", fromToman: 1_000_000 } });
    await deleteProduct(a.id, a1, p.id);
    expect(await prisma.priceLink.count()).toBe(0);
    expect(await prisma.livePrice.count()).toBe(0);
  });
});

describe("rates (DB)", () => {
  it("a held reading is superseded by a newer one; confirm applies once and is audited; a decided row cannot be decided again", async () => {
    await setup();
    const p1 = await rateStore.record({ code: "USD", rateToman: 130_000, source: "navasan", observedAt: NOW, status: "PENDING", decidedById: null, now: NOW }, null);
    const p2 = await rateStore.record({ code: "USD", rateToman: 131_000, source: "navasan", observedAt: NOW, status: "PENDING", decidedById: null, now: NOW }, null);
    expect((await prisma.exchangeRate.findUniqueOrThrow({ where: { id: p1.id } })).status).toBe("REJECTED");
    await rates.decide(admin, p2.id, "APPLIED");
    expect((await rateStore.current()).USD?.rateToman).toBe(131_000);
    await expect(rates.decide(admin, p2.id, "REJECTED")).rejects.toThrow();
    expect(await prisma.auditEvent.count({ where: { action: "platform.rate_confirmed", targetId: p2.id, storeId: null } })).toBe(1);
    expect(await prisma.auditEvent.count({ where: { action: "platform.rate_entered" } })).toBe(2);
  });
  it("the database refuses impossible links and rates", async () => {
    const { a, a1 } = await setup();
    const p = await createProduct(a.id, a1, validProduct());
    await expect(prisma.priceLink.create({ data: { storeId: a1, productId: p.id, target: "-", kind: "USD", weightMg: 5 } })).rejects.toThrow();
    await expect(prisma.priceLink.create({ data: { storeId: a1, productId: p.id, target: "x", kind: "USD", usdCents: 5 } })).rejects.toThrow(); // target must match variantId
    await expect(prisma.priceLink.create({ data: { storeId: a1, productId: p.id, target: "-", kind: "USD", usdCents: 5, roundingToman: 7 } })).rejects.toThrow();
    await expect(prisma.exchangeRate.create({ data: { code: "USD", rateToman: 0, source: "manual", observedAt: NOW, status: "APPLIED" } })).rejects.toThrow();
  });
});

describe("public storefront overlay (DB)", () => {
  it("regression (security review 3.2b): a product with variants shows the lowest PUBLISHED variant price; draft-only variants never count", async () => {
    const prices = new Map([["px|v1", 700], ["px|v-draft-only", 5], ["px|-", 1]]);
    const variants = [
      { id: "v1", options: [{ name: "a", value: "1" }], price: 1_000, stockQuantity: 1 },
      { id: "v2", options: [{ name: "a", value: "2" }], price: 900, stockQuantity: 1 },
    ];
    const data = makeStorefront({ products: [{ ...PRODUCT_A, id: "px", price: 900, variants }] });
    const out = withLivePrices(data, prices);
    expect(out.products[0]!.variants.map((v) => v.price)).toEqual([700, 900]);
    expect(out.products[0]!.price).toBe(700); // not 5 (draft-only variant), not 1 (a stray product row)
  });

  it("published products show their live price; the cached snapshot is not modified; unpublished links reveal nothing", async () => {
    const { a, a1 } = await setup();
    const p = await createProduct(a.id, a1, validProduct());
    await pricing.setLink({ storeId: a1, ownerId: a.id }, p.id, { link: { kind: "USD", fromToman: 3_000_000 } });
    const snapshot = makeStorefront({ products: [{ ...PRODUCT_A, id: p.id, price: 1 }] });
    const frozen = JSON.stringify(snapshot);
    const out = withLivePrices(snapshot, await livePricesOf(a1));
    expect(out.products[0]!.price).toBe(3_000_000);
    expect(JSON.stringify(snapshot)).toBe(frozen);
    // a linked product that is not in the published version adds nothing
    const empty = makeStorefront({ products: [] });
    expect(withLivePrices(empty, await livePricesOf(a1))).toBe(empty);
  });
});
