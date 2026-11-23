import { describe, expect, it } from "vitest";
import { OutOfStockError, ReservationLostError, VariantLimitError } from "@store-builder/shared/modules/inventory/errors";
import { MAX_VARIANTS_PER_STORE } from "@store-builder/shared/modules/inventory/variants";
import { NotFoundError, ValidationError } from "@store-builder/shared/modules/stores/errors";
import type { ReservationLine, StockFacts } from "../domain/inventory.js";
import { InventoryService } from "./inventory.service.js";
import type { StockLedger, VariantData, VariantReader, VariantUnitOfWork, VariantView, VariantWrites } from "./ports.js";

/** In-memory ports with the adapters' contract: work on a copy, commit only when `work` succeeds. */
class Memory implements VariantReader, VariantUnitOfWork, StockLedger {
  products = new Map<string, { storeId: string; price: number; stockQuantity: number }>();
  variants: (VariantView & { productId: string; storeId: string })[] = [];
  dropped: { productId: string; variantIds: string[]; productLevel: boolean }[] = [];
  otherStoreVariants = 0;
  linked = new Map<string, { productLinked: boolean; variantIds: string[] }>();
  synced: string[] = [];
  reserveCalls: { lines: ReservationLine[]; expiresAt: Date }[] = [];
  facts: StockFacts[] = [];
  private seq = 0;

  async list(storeId: string, productId: string) {
    if (this.products.get(productId)?.storeId !== storeId) return null;
    return this.variants
      .filter((v) => v.productId === productId)
      .sort((a, b) => a.position - b.position)
      .map((v) => ({ id: v.id, options: v.options, optionsKey: v.optionsKey, sku: v.sku, price: v.price, stockQuantity: v.stockQuantity, position: v.position }));
  }

  async run<T>(_ownerId: string, storeId: string, work: (w: VariantWrites) => Promise<T>): Promise<T> {
    const snapshot = { products: structuredClone([...this.products]), variants: structuredClone(this.variants) };
    try {
      return await work(this.writes(storeId));
    } catch (e) {
      this.products = new Map(snapshot.products);
      this.variants = snapshot.variants;
      throw e;
    }
  }

  private writes(storeId: string): VariantWrites {
    const self = this; // eslint-disable-line @typescript-eslint/no-this-alias -- the fake ports close over the store being mutated
    return {
      lockProduct: async (id) => self.products.get(id)?.storeId === storeId,
      list: async (id) => (await self.list(storeId, id)) ?? [],
      linkedPrices: async (productId) => self.linked.get(productId) ?? { productLinked: false, variantIds: [] },
      syncLivePrices: async (productId) => void self.synced.push(productId),
      countInStore: async () => self.variants.filter((v) => v.storeId === storeId).length + self.otherStoreVariants,
      update: async (id, d: VariantData) => {
        const row = self.variants.find((v) => v.id === id)!;
        Object.assign(row, d);
      },
      insert: async (productId, d) => {
        self.variants.push({ id: `v${++self.seq}`, productId, storeId, ...d });
      },
      dropReservations: async (productId, variantIds, productLevel) => {
        self.dropped.push({ productId, variantIds, productLevel });
        return 0;
      },
      delete: async (ids) => {
        self.variants = self.variants.filter((v) => !ids.includes(v.id));
      },
      setProductSummary: async (id, s) => {
        Object.assign(self.products.get(id)!, s);
      },
    };
  }

  async reserve(_s: string, _r: string, lines: ReservationLine[], expiresAt: Date, decide: (f: StockFacts[]) => { line: ReservationLine; available: number }[]) {
    this.reserveCalls.push({ lines, expiresAt });
    const short = decide(this.facts);
    return short.length ? { reserved: false as const, short } : { reserved: true as const };
  }
  release = async () => 0;
  consumeResult = true;
  consume = async () => this.consumeResult;
  releaseExpired = async () => 0;
}

const NOW = new Date("2026-11-23T10:00:00Z");
const a = { storeId: "s1", ownerId: "o1" };
const body = (...colours: [string, number, number][]) => ({ variants: colours.map(([value, price, stockQuantity]) => ({ options: [{ name: "رنگ", value }], price, stockQuantity })) });

function setup() {
  const m = new Memory();
  m.products.set("p1", { storeId: "s1", price: 999, stockQuantity: 5 });
  m.products.set("px", { storeId: "s2", price: 1, stockQuantity: 1 });
  return { m, svc: new InventoryService(m, m, m, () => NOW) };
}

describe("InventoryService variants", () => {
  it("replaces the set, keeps ids of unchanged combinations and puts the summary on the product", async () => {
    const { m, svc } = setup();
    const first = await svc.replaceVariants(a, "p1", body(["قرمز", 300, 2], ["آبی", 200, 0]));
    expect(first.map((v) => v.optionsKey)).toEqual([JSON.stringify([["رنگ", "قرمز"]]), JSON.stringify([["رنگ", "آبی"]])]);
    expect(m.products.get("p1")).toMatchObject({ price: 200, stockQuantity: 2 });
    expect(m.dropped).toEqual([{ productId: "p1", variantIds: [], productLevel: true }]); // product-level holds end once variants exist

    const redId = first[0]!.id;
    const second = await svc.replaceVariants(a, "p1", body(["سبز", 500, 4], ["قرمز", 350, 1]));
    expect(second.find((v) => v.optionsKey === JSON.stringify([["رنگ", "قرمز"]]))?.id).toBe(redId);
    expect(m.dropped.at(-1)).toEqual({ productId: "p1", variantIds: [first[1]!.id], productLevel: false });
    expect(m.products.get("p1")).toMatchObject({ price: 350, stockQuantity: 5 });

    expect(await svc.replaceVariants(a, "p1", { variants: [] })).toEqual([]);
    expect(m.products.get("p1")).toMatchObject({ price: 350, stockQuantity: 5 }); // left as it was: editable again
  });

  it("refuses set-level problems before opening a mutation, and a product of another store as not found", async () => {
    const { m, svc } = setup();
    await expect(svc.replaceVariants(a, "p1", body(["قرمز", 1, 1], ["قرمز", 2, 2]))).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.replaceVariants(a, "p1", { variants: [{ options: [], price: 1, stockQuantity: 1 }] })).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.replaceVariants(a, "px", body(["قرمز", 1, 1]))).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc.replaceVariants(a, "../p1", body(["قرمز", 1, 1]))).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc.listVariants(a, "px")).rejects.toBeInstanceOf(NotFoundError);
    expect(m.variants).toEqual([]);
  });

  it("phase 3.2b: a linked variant keeps its computed price on replace; a product-level link excludes variants", async () => {
    const { m, svc } = setup();
    const [red] = await svc.replaceVariants(a, "p1", body(["قرمز", 300, 2], ["آبی", 200, 1]));
    m.linked.set("p1", { productLinked: false, variantIds: [red!.id] });
    const after = await svc.replaceVariants(a, "p1", body(["قرمز", 1, 5], ["آبی", 250, 1]));
    expect(after.find((v) => v.id === red!.id)).toMatchObject({ price: 300, stockQuantity: 5 }); // the sent price 1 is ignored
    expect(m.products.get("p1")).toMatchObject({ price: 250, stockQuantity: 6 });
    // re-review 3.2b: removing a linked variant needs publish (an operator cannot; the owner can, and its live row is synced)
    await expect(svc.replaceVariants({ ...a, role: "OPERATOR" }, "p1", body(["آبی", 250, 1]))).rejects.toBeInstanceOf(ValidationError);
    await svc.replaceVariants({ ...a, role: "OWNER" }, "p1", body(["آبی", 250, 1]));
    expect(m.synced).toEqual(["p1"]);
    m.linked.set("p1", { productLinked: true, variantIds: [] });
    await expect(svc.replaceVariants(a, "p1", body(["سبز", 1, 1]))).rejects.toBeInstanceOf(ValidationError);
  });

  it("enforces the per-store cap and rolls the whole change back", async () => {
    const { m, svc } = setup();
    m.otherStoreVariants = MAX_VARIANTS_PER_STORE;
    await expect(svc.replaceVariants(a, "p1", body(["قرمز", 1, 1]))).rejects.toBeInstanceOf(VariantLimitError);
    expect(m.variants).toEqual([]);
    expect(m.products.get("p1")).toMatchObject({ price: 999, stockQuantity: 5 });
  });
});

describe("InventoryService reservations", () => {
  it("passes merged, ordered lines and the expiry to the ledger", async () => {
    const { m, svc } = setup();
    m.facts = [{ productActive: true, hasVariants: false, available: 5 }];
    expect(await svc.reserve("s1", "cart1", [{ productId: "p1", quantity: 2 }, { productId: "p1", quantity: 1 }], 600)).toEqual({ expiresAt: new Date(NOW.getTime() + 600_000), lines: 1 });
    expect(m.reserveCalls[0]!.lines).toEqual([{ productId: "p1", variantId: null, quantity: 3 }]);
  });
  it("reports every short line with what is left", async () => {
    const { m, svc } = setup();
    m.facts = [
      { productActive: true, hasVariants: true, available: 1 },
      { productActive: false, hasVariants: false, available: 9 },
    ];
    const err = await svc.reserve("s1", "cart1", [{ productId: "pa", variantId: "v1", quantity: 2 }, { productId: "pb", quantity: 1 }]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OutOfStockError);
    expect((err as OutOfStockError).items).toEqual([
      { productId: "pa", variantId: "v1", available: 1 },
      { productId: "pb", variantId: null, available: 0 },
    ]);
  });
  it("consume: an incomplete hold is never turned into an order (regression, security review 3.2)", async () => {
    const { m, svc } = setup();
    await expect(svc.consume("s1", "cart1", 2)).resolves.toBeUndefined();
    for (const bad of [0, -1, 1.5, Number.NaN]) await expect(svc.consume("s1", "cart1", bad)).rejects.toBeInstanceOf(ReservationLostError);
    m.consumeResult = false;
    await expect(svc.consume("s1", "cart1", 2)).rejects.toBeInstanceOf(ReservationLostError);
  });
  it("refuses a malformed request without touching the ledger", async () => {
    const { m, svc } = setup();
    await expect(svc.reserve("s1", "cart 1", [{ productId: "p1", quantity: 1 }])).rejects.toBeInstanceOf(ValidationError);
    expect(m.reserveCalls).toEqual([]);
  });
});
