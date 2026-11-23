import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma, resetDb } from "../../test/db-helpers.js";
import { revision, twoTenants, validProduct } from "../../test/catalog-helpers.js";
import { OutOfStockError, ReservationLostError } from "@store-builder/shared/modules/inventory/errors";
import { NotFoundError, ValidationError } from "@store-builder/shared/modules/stores/errors";
import { changeProductStatus, createProduct, updateProduct } from "../products/service.js";
import { InventoryService } from "./application/inventory.service.js";
import { PrismaStockLedger, PrismaVariantReader, PrismaVariantUnitOfWork } from "./infrastructure/prisma-inventory.repository.js";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

let now = new Date("2026-11-23T10:00:00Z");
const svc = new InventoryService(new PrismaVariantReader(), new PrismaVariantUnitOfWork(), new PrismaStockLedger(), () => now);
const colours = (...rows: [string, number, number][]) => ({ variants: rows.map(([value, price, stockQuantity]) => ({ options: [{ name: "رنگ", value }], price, stockQuantity })) });

async function activeProduct(ownerId: string, storeId: string, stockQuantity = 5) {
  const p = await createProduct(ownerId, storeId, validProduct({ stockQuantity }));
  await changeProductStatus(ownerId, storeId, p.id, "ACTIVE");
  return p.id;
}
const stockOf = async (productId: string) => (await prisma.product.findUniqueOrThrow({ where: { id: productId } })).stockQuantity;
const variantStock = async (id: string) => (await prisma.productVariant.findUniqueOrThrow({ where: { id } })).stockQuantity;

describe("variants (DB)", () => {
  it("replace writes the set, bumps the draft revision once and puts min price / summed stock on the product", async () => {
    const { a, a1 } = await twoTenants();
    const pid = await activeProduct(a.id, a1);
    const r0 = await revision(a1);
    const set = await svc.replaceVariants({ storeId: a1, ownerId: a.id }, pid, colours(["قرمز", 300, 2], ["آبی", 200, 4]));
    expect(set.map((v) => [v.optionsKey, v.position])).toEqual([[JSON.stringify([["رنگ", "قرمز"]]), 0], [JSON.stringify([["رنگ", "آبی"]]), 1]]);
    expect(await prisma.product.findUniqueOrThrow({ where: { id: pid } })).toMatchObject({ price: 200, stockQuantity: 6 });
    expect(await revision(a1)).toBe(r0 + 1);
    // price and stock of a product with variants are edited per variant
    await expect(updateProduct(a.id, a1, pid, { price: 5 })).rejects.toBeInstanceOf(ValidationError);
    await expect(updateProduct(a.id, a1, pid, { stockQuantity: 9 })).rejects.toBeInstanceOf(ValidationError);
    await expect(updateProduct(a.id, a1, pid, { name: "نام تازه" })).resolves.toMatchObject({ name: "نام تازه" });
  });

  it("another store's product is not found for reads and writes (tenant isolation)", async () => {
    const { a, b, a1, b1 } = await twoTenants();
    const pid = await activeProduct(a.id, a1);
    await expect(svc.replaceVariants({ storeId: b1, ownerId: b.id }, pid, colours(["قرمز", 1, 1]))).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc.listVariants({ storeId: b1, ownerId: b.id }, pid)).rejects.toBeInstanceOf(NotFoundError);
    // the wrong owner for the right store: the store mutation refuses it
    await expect(svc.replaceVariants({ storeId: a1, ownerId: b.id }, pid, colours(["قرمز", 1, 1]))).rejects.toBeInstanceOf(NotFoundError);
    expect(await prisma.productVariant.count()).toBe(0);
  });

  it("the database refuses negative stock and malformed options even without the application", async () => {
    const { a, a1 } = await twoTenants();
    const pid = await activeProduct(a.id, a1);
    const base = { storeId: a1, productId: pid, price: 1, position: 0 };
    await expect(prisma.productVariant.create({ data: { ...base, options: [{ name: "a", value: "b" }], optionsKey: "a=b", stockQuantity: -1 } })).rejects.toThrow();
    await expect(prisma.productVariant.create({ data: { ...base, options: [], optionsKey: "x", stockQuantity: 1 } })).rejects.toThrow();
    await expect(prisma.productVariant.create({ data: { ...base, options: {}, optionsKey: "y", stockQuantity: 1 } })).rejects.toThrow();
  });
});

describe("stock reservations (DB)", () => {
  it("30 buyers race for 5 units: exactly 5 succeed, stock ends at 0, never below", async () => {
    const { a, a1 } = await twoTenants();
    const pid = await activeProduct(a.id, a1, 5);
    const rs = await Promise.allSettled(Array.from({ length: 30 }, (_, i) => svc.reserve(a1, `cart${i}`, [{ productId: pid, quantity: 1 }])));
    expect(rs.filter((r) => r.status === "fulfilled")).toHaveLength(5);
    expect(rs.filter((r) => r.status === "rejected").every((r) => (r as PromiseRejectedResult).reason instanceof OutOfStockError)).toBe(true);
    expect(await stockOf(pid)).toBe(0);
    expect(await prisma.stockReservation.count({ where: { productId: pid, status: "ACTIVE" } })).toBe(5);
  });

  it("variant stock: product and variant go down together; all-or-nothing across lines", async () => {
    const { a, a1 } = await twoTenants();
    const pid = await activeProduct(a.id, a1);
    const [red, blue] = await svc.replaceVariants({ storeId: a1, ownerId: a.id }, pid, colours(["قرمز", 300, 2], ["آبی", 200, 1]));
    const other = await activeProduct(a.id, a1, 10);

    await svc.reserve(a1, "c1", [{ productId: pid, variantId: red!.id, quantity: 2 }]);
    expect([await variantStock(red!.id), await stockOf(pid)]).toEqual([0, 1]);

    // the second line is short, so the first one must not be taken either
    const err = await svc.reserve(a1, "c2", [{ productId: other, quantity: 3 }, { productId: pid, variantId: blue!.id, quantity: 2 }]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OutOfStockError);
    expect((err as OutOfStockError).items).toEqual([{ productId: pid, variantId: blue!.id, available: 1 }]);
    expect(await stockOf(other)).toBe(10);
    expect(await prisma.stockReservation.count({ where: { ref: "c2" } })).toBe(0);

    // a product with variants cannot be bought without choosing one; a variant of another product is unknown
    await expect(svc.reserve(a1, "c3", [{ productId: pid, quantity: 1 }])).rejects.toBeInstanceOf(OutOfStockError);
    await expect(svc.reserve(a1, "c4", [{ productId: other, variantId: blue!.id, quantity: 1 }])).rejects.toBeInstanceOf(OutOfStockError);
  });

  it("release gives stock back once; consume keeps it out; expired ones are released by the sweep", async () => {
    const { a, a1 } = await twoTenants();
    const pid = await activeProduct(a.id, a1, 5);
    await svc.reserve(a1, "keep", [{ productId: pid, quantity: 1 }]);
    await svc.reserve(a1, "drop", [{ productId: pid, quantity: 2 }]);
    await svc.reserve(a1, "late", [{ productId: pid, quantity: 2 }], 60);
    expect(await stockOf(pid)).toBe(0);

    expect(await svc.release(a1, "drop")).toBe(1);
    expect(await svc.release(a1, "drop")).toBe(0); // idempotent
    expect(await stockOf(pid)).toBe(2);

    await svc.consume(a1, "keep", 1);
    expect(await svc.release(a1, "keep")).toBe(0); // consumed stock never comes back
    expect(await stockOf(pid)).toBe(2);

    now = new Date(now.getTime() + 61_000);
    try {
      await expect(svc.consume(a1, "late", 1)).rejects.toBeInstanceOf(ReservationLostError); // an expired hold cannot become an order
      expect(await svc.releaseExpired()).toBe(1);
      expect(await svc.releaseExpired()).toBe(0);
      expect(await stockOf(pid)).toBe(4);
    } finally {
      now = new Date("2026-11-23T10:00:00Z");
    }
  });

  it("a store cannot touch another store's stock or reservations", async () => {
    const { a, b, a1, b1 } = await twoTenants();
    const pid = await activeProduct(a.id, a1, 5);
    await expect(svc.reserve(b1, "x", [{ productId: pid, quantity: 1 }])).rejects.toBeInstanceOf(OutOfStockError);
    await svc.reserve(a1, "mine", [{ productId: pid, quantity: 2 }]);
    expect(await svc.release(b1, "mine")).toBe(0);
    await expect(svc.consume(b1, "mine", 1)).rejects.toBeInstanceOf(ReservationLostError);
    expect(await stockOf(pid)).toBe(3);
    void b;
  });

  it("removing a variant drops its holds; adding variants drops product-level holds (the product total stays the variant sum)", async () => {
    const { a, a1 } = await twoTenants();
    const pid = await activeProduct(a.id, a1, 5);
    await svc.reserve(a1, "plain", [{ productId: pid, quantity: 2 }]);
    const [red] = await svc.replaceVariants({ storeId: a1, ownerId: a.id }, pid, colours(["قرمز", 300, 2], ["آبی", 200, 3]));
    expect(await prisma.stockReservation.findFirstOrThrow({ where: { ref: "plain" } })).toMatchObject({ status: "RELEASED" });
    await svc.reserve(a1, "red", [{ productId: pid, variantId: red!.id, quantity: 1 }]);
    await svc.replaceVariants({ storeId: a1, ownerId: a.id }, pid, colours(["آبی", 200, 3]));
    expect(await prisma.stockReservation.findFirstOrThrow({ where: { ref: "red" } })).toMatchObject({ status: "RELEASED" });
    expect(await svc.release(a1, "red")).toBe(0);
    expect(await stockOf(pid)).toBe(3);
  });

  it("regression (security review 3.2): consume is all or nothing when a variant change dropped part of the hold", async () => {
    const { a, a1 } = await twoTenants();
    const pid = await activeProduct(a.id, a1);
    const [red, blue] = await svc.replaceVariants({ storeId: a1, ownerId: a.id }, pid, colours(["قرمز", 300, 2], ["آبی", 200, 2]));
    const held = await svc.reserve(a1, "cart", [{ productId: pid, variantId: red!.id, quantity: 1 }, { productId: pid, variantId: blue!.id, quantity: 1 }]);
    expect(held.lines).toBe(2);
    await svc.replaceVariants({ storeId: a1, ownerId: a.id }, pid, colours(["قرمز", 300, 1])); // blue is gone, its hold dropped
    await expect(svc.consume(a1, "cart", held.lines)).rejects.toBeInstanceOf(ReservationLostError);
    expect(await prisma.stockReservation.count({ where: { ref: "cart", status: "CONSUMED" } })).toBe(0);
  });

  it("regression (security review 3.2): a give-back past the stock bound is clamped, and one bad row never stops the sweep", async () => {
    const { a, b, a1, b1 } = await twoTenants();
    const full = await activeProduct(a.id, a1, 10);
    const other = await activeProduct(b.id, b1, 10);
    await svc.reserve(a1, "x", [{ productId: full, quantity: 5 }], 60);
    await svc.reserve(b1, "y", [{ productId: other, quantity: 5 }], 60);
    await updateProduct(a.id, a1, full, { stockQuantity: 1_000_000 }); // the merchant raised stock to the maximum meanwhile
    now = new Date(now.getTime() + 61_000);
    try {
      expect(await svc.releaseExpired()).toBe(2);
      expect(await stockOf(full)).toBe(1_000_000);
      expect(await stockOf(other)).toBe(10);
    } finally {
      now = new Date("2026-11-23T10:00:00Z");
    }
  });

  it("regression (security review 3.2): variant stock summing past the bound is a validation error, not a server error", async () => {
    const { a, a1 } = await twoTenants();
    const pid = await activeProduct(a.id, a1);
    await expect(svc.replaceVariants({ storeId: a1, ownerId: a.id }, pid, colours(["قرمز", 1, 600_000], ["آبی", 1, 600_000]))).rejects.toBeInstanceOf(ValidationError);
  });

  it("a draft product cannot be reserved", async () => {
    const { a, a1 } = await twoTenants();
    const p = await createProduct(a.id, a1, validProduct({ stockQuantity: 5 }));
    await expect(svc.reserve(a1, "d", [{ productId: p.id, quantity: 1 }])).rejects.toBeInstanceOf(OutOfStockError);
  });
});
