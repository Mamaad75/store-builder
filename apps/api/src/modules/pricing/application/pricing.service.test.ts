import { describe, expect, it } from "vitest";
import { NotFoundError, ValidationError } from "@store-builder/shared/modules/stores/errors";
import type { PriceLink } from "@store-builder/shared/modules/pricing/pricing";
import type { CurrentRates } from "../domain/pricing.js";
import { PricingService } from "./pricing.service.js";
import type { LinkReader, LinkUnitOfWork, LinkView, LinkWrites, RateStore } from "./ports.js";

const at = new Date("2026-11-24T08:00:00Z");
const a = { storeId: "s1", ownerId: "o1" };

function setup(rates: CurrentRates, products: Record<string, string[]>) {
  const applied: { productId: string; variantId: string | null; price: number }[] = [];
  const links = new Map<string, LinkView>();
  const writes: LinkWrites = {
    lockProduct: async (id) => (products[id] ? { variantIds: products[id]! } : null),
    upsert: async (productId, variantId, link: PriceLink, priceToman) => {
      const v = { productId, variantId, kind: link.kind, usdCents: link.kind === "USD" ? link.usdCents : null, weightMg: link.kind === "GOLD" ? link.weightMg : null, wageBp: 0, profitBp: 0, taxBp: 0, stoneToman: 0, roundingToman: link.roundingToman, status: "OK" as const, lastPriceToman: priceToman, lastRateAt: at };
      links.set(`${productId}|${variantId ?? "-"}`, v);
      return v;
    },
    remove: async (productId, variantId) => links.delete(`${productId}|${variantId ?? "-"}`),
    applyPrice: async (productId, variantId, price) => void applied.push({ productId, variantId, price }),
    dropLive: async () => undefined,
  };
  const uow: LinkUnitOfWork = { run: (_o, storeId, work) => (storeId === "s1" ? work(writes) : Promise.reject(new NotFoundError())) };
  const reader: LinkReader = { list: async (_s, p) => (products[p] ? [...links.values()].filter((l) => l.productId === p) : null) };
  const store = { current: async () => rates } as unknown as RateStore;
  return { svc: new PricingService(reader, uow, store, () => at), applied, links };
}

describe("PricingService.setLink", () => {
  const rates: CurrentRates = { USD: { rateToman: 100_000, appliedAt: at }, GOLD18: { rateToman: 8_000_000, appliedAt: at } };

  it("links a product without variants and writes the computed price at once", async () => {
    const { svc, applied } = setup(rates, { p1: [] });
    const v = await svc.setLink(a, "p1", { link: { kind: "USD", fromToman: 5_000_000 } });
    expect(v).toMatchObject({ kind: "USD", usdCents: 5_000, lastPriceToman: 5_000_000 });
    expect(applied).toEqual([{ productId: "p1", variantId: null, price: 5_000_000 }]);
  });

  it("variants are linked one by one; a variant must belong to the product", async () => {
    const { svc, applied } = setup(rates, { p1: ["v1", "v2"] });
    await expect(svc.setLink(a, "p1", { link: { kind: "GOLD", weightMg: 2_000 } })).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.setLink(a, "p1", { variantId: "v9", link: { kind: "GOLD", weightMg: 2_000 } })).rejects.toBeInstanceOf(ValidationError);
    await svc.setLink(a, "p1", { variantId: "v2", link: { kind: "GOLD", weightMg: 2_000, roundingToman: 1 } });
    expect(applied).toEqual([{ productId: "p1", variantId: "v2", price: 16_000_000 + 1_440_000 * 0 }]);
  });

  it("refuses a variant for a product without variants, a missing rate, an out-of-range price, and junk", async () => {
    const { svc, applied } = setup(rates, { p1: [] });
    await expect(svc.setLink(a, "p1", { variantId: "v1", link: { kind: "USD", fromToman: 1_000_000 } })).rejects.toBeInstanceOf(ValidationError);
    await expect(setup({}, { p1: [] }).svc.setLink(a, "p1", { link: { kind: "USD", fromToman: 1_000_000 } })).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.setLink(a, "p1", { link: { kind: "USD", usdCents: 100_000_000 } })).rejects.toBeInstanceOf(ValidationError); // 1e6 USD
    await expect(svc.setLink(a, "p1", { link: { kind: "USD", fromToman: 1_000 }, extra: true })).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.setLink(a, "p1", { variantId: "../x", link: { kind: "USD", fromToman: 1_000 } })).rejects.toBeInstanceOf(ValidationError);
    expect(applied).toEqual([]);
  });

  it("a product of another store, or a malformed id, is not found", async () => {
    const { svc } = setup(rates, { p1: [] });
    await expect(svc.setLink({ storeId: "s2", ownerId: "o2" }, "p1", { link: { kind: "USD", fromToman: 1_000_000 } })).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc.setLink(a, "nope", { link: { kind: "USD", fromToman: 1_000_000 } })).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc.links(a, "P-1")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("removeLink: unknown link is not found; current rates expose both codes", async () => {
    const { svc } = setup(rates, { p1: [] });
    await expect(svc.removeLink(a, "p1", {})).rejects.toBeInstanceOf(NotFoundError);
    await svc.setLink(a, "p1", { link: { kind: "USD", fromToman: 1_000_000 } });
    await expect(svc.removeLink(a, "p1", {})).resolves.toBeUndefined();
    expect(Object.keys(await svc.currentRates())).toEqual(["USD", "GOLD18"]);
  });
});
