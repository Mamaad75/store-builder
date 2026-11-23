import type { Prisma } from "@prisma/client";
import type { PriceLink, RateCode } from "@store-builder/shared/modules/pricing/pricing";
import { db } from "../../../lib/db.js";
import { log } from "../../../logging/json-logger.js";
import { withStoreMutation, type MutationContext } from "../../stores/stores.api.js";
import { PRODUCT_TARGET, repriceLinks, targetOf, type CurrentRates, type StoredLink } from "../domain/pricing.js";
import type { LinkReader, LinkUnitOfWork, LinkView, LinkWrites, RateRow, RateStore, Repricer } from "../application/ports.js";

// The only files of the pricing module that reach the database. Every store-side query is bound to the store id.
// Lock order (same as the stock ledger): Product rows by id -> ProductVariant rows -> PriceLink / LivePrice rows.
// THE price writer (D32b-1): besides the catalog repositories, the only code that writes Product.price (raw SQL, price column only; guarded
// in domain.architecture.test.ts). Linked prices are not draft edits by the merchant: the hourly run never takes the store lock.

type Tx = Prisma.TransactionClient;
const TX = { timeout: 30_000, maxWait: 10_000 } as const;

const rateSelect = { id: true, code: true, rateToman: true, source: true, observedAt: true, status: true, decidedById: true, decidedAt: true, createdAt: true } as const;

/** The latest APPLIED rate per code, read through `client` (a transaction when the caller needs it consistent with its writes). */
async function currentRates(client: Tx | typeof db): Promise<CurrentRates> {
  const out: CurrentRates = {};
  for (const code of ["USD", "GOLD18"] as const) {
    const r = await client.exchangeRate.findFirst({ where: { code, status: "APPLIED" }, orderBy: [{ decidedAt: "desc" }, { createdAt: "desc" }], select: { rateToman: true, decidedAt: true, createdAt: true } });
    if (r) out[code] = { rateToman: r.rateToman, appliedAt: r.decidedAt ?? r.createdAt };
  }
  return out;
}

export class PrismaRateStore implements RateStore {
  current(): Promise<CurrentRates> {
    return currentRates(db);
  }

  async humanReference(code: RateCode): Promise<number | null> {
    const r = await db.exchangeRate.findFirst({ where: { code, status: "APPLIED", decidedById: { not: null } }, orderBy: { decidedAt: "desc" }, select: { rateToman: true } });
    return r?.rateToman ?? null;
  }

  async dayReference(code: RateCode, now: Date): Promise<number | null> {
    const r = await db.exchangeRate.findFirst({
      where: { code, status: "APPLIED", decidedAt: { lte: new Date(now.getTime() - 24 * 3_600_000) } },
      orderBy: { decidedAt: "desc" },
      select: { rateToman: true },
    });
    return r?.rateToman ?? null;
  }

  pending(): Promise<RateRow[]> {
    return db.exchangeRate.findMany({ where: { status: "PENDING" }, orderBy: { createdAt: "desc" }, take: 20, select: rateSelect });
  }

  history(limit: number): Promise<RateRow[]> {
    return db.exchangeRate.findMany({ orderBy: { createdAt: "desc" }, take: limit, select: rateSelect });
  }

  record(r: Parameters<RateStore["record"]>[0], audit: { actorId: string; action: string } | null): Promise<RateRow> {
    return db.$transaction(async (tx) => {
      // A newer reading supersedes an unconfirmed one of the same code (it would otherwise pile up every hour).
      if (r.status !== "REJECTED") await tx.exchangeRate.updateMany({ where: { code: r.code, status: "PENDING" }, data: { status: "REJECTED", decidedAt: r.now } });
      const row = await tx.exchangeRate.create({
        data: { code: r.code, rateToman: r.rateToman, source: r.source, observedAt: r.observedAt, status: r.status, decidedById: r.decidedById, decidedAt: r.status === "PENDING" ? null : r.now },
        select: rateSelect,
      });
      if (audit) await tx.auditEvent.create({ data: { storeId: null, actorId: audit.actorId, action: audit.action, targetType: "exchange_rate", targetId: row.id } });
      return row;
    });
  }

  decide(id: string, to: "APPLIED" | "REJECTED", actorId: string, now: Date): Promise<"ok" | "missing" | "not_pending"> {
    return db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ code: RateCode; status: string }[]>`SELECT code::text AS code, status::text AS status FROM "ExchangeRate" WHERE id = ${id} FOR UPDATE`;
      const row = rows[0];
      if (!row) return "missing" as const;
      if (row.status !== "PENDING") return "not_pending" as const;
      await tx.exchangeRate.update({ where: { id }, data: { status: to, decidedById: actorId, decidedAt: now } });
      await tx.auditEvent.create({ data: { storeId: null, actorId, action: to === "APPLIED" ? "platform.rate_confirmed" : "platform.rate_rejected", targetType: "exchange_rate", targetId: id } });
      return "ok" as const;
    });
  }
}

const linkSelect = {
  productId: true, variantId: true, kind: true, usdCents: true, weightMg: true, wageBp: true, profitBp: true, taxBp: true, stoneToman: true,
  roundingToman: true, status: true, lastPriceToman: true, lastRateAt: true,
} as const;
type LinkRow = LinkView;

function toPriceLink(r: LinkRow): PriceLink {
  return r.kind === "USD"
    ? { kind: "USD", usdCents: r.usdCents!, roundingToman: r.roundingToman }
    : { kind: "GOLD", weightMg: r.weightMg!, wageBp: r.wageBp, profitBp: r.profitBp, taxBp: r.taxBp, stoneToman: r.stoneToman, roundingToman: r.roundingToman };
}

async function lockProducts(tx: Tx, storeId: string, productIds: string[]) {
  const ids = [...new Set(productIds)].sort();
  return tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Product" WHERE "storeId" = ${storeId} AND id = ANY(${ids}) ORDER BY id FOR UPDATE`;
}

async function setTargetPrice(tx: Tx, storeId: string, productId: string, variantId: string | null, priceToman: number) {
  if (variantId) await tx.$executeRaw`UPDATE "ProductVariant" SET "price" = ${priceToman}, "updatedAt" = now() WHERE id = ${variantId} AND "storeId" = ${storeId} AND "productId" = ${productId}`;
  else await tx.$executeRaw`UPDATE "Product" SET "price" = ${priceToman}, "updatedAt" = now() WHERE id = ${productId} AND "storeId" = ${storeId}`;
}

/**
 * Brings the derived rows of these products in line with their links (caller holds the product locks):
 *  - DRAFT: a product whose variants are linked gets the lowest of its (draft) variant prices (D32-1) on its own price column;
 *  - LIVE: LivePrice holds exactly one row per link (its last computed price) and nothing else. In particular no lowest-variant summary:
 *    the storefront derives that from the PUBLISHED variants (security review 3.2b: a draft-only variant must never reach the live price).
 */
async function syncDerived(tx: Tx, storeId: string, productIds: string[], now: Date) {
  if (!productIds.length) return;
  const links = await tx.priceLink.findMany({ where: { storeId, productId: { in: productIds } }, select: { productId: true, target: true, variantId: true, lastPriceToman: true } });
  const desired = new Map<string, { productId: string; target: string; priceToman: number }>();
  for (const l of links) if (l.lastPriceToman !== null) desired.set(`${l.productId}|${l.target}`, { productId: l.productId, target: l.target, priceToman: l.lastPriceToman });
  const withVariantLinks = [...new Set(links.filter((l) => l.variantId !== null).map((l) => l.productId))];
  if (withVariantLinks.length) {
    const mins = await tx.productVariant.groupBy({ by: ["productId"], where: { storeId, productId: { in: withVariantLinks } }, _min: { price: true } });
    for (const m of mins) {
      const min = m._min.price;
      if (min !== null) await tx.$executeRaw`UPDATE "Product" SET "price" = ${min}, "updatedAt" = now() WHERE id = ${m.productId} AND "storeId" = ${storeId}`;
    }
  }
  const existing = await tx.livePrice.findMany({ where: { storeId, productId: { in: productIds } }, select: { productId: true, target: true, priceToman: true } });
  const stale = existing.filter((e) => !desired.has(`${e.productId}|${e.target}`));
  if (stale.length) await tx.livePrice.deleteMany({ where: { storeId, OR: stale.map((e) => ({ productId: e.productId, target: e.target })) } });
  for (const d of desired.values()) {
    const cur = existing.find((e) => e.productId === d.productId && e.target === d.target);
    if (cur?.priceToman === d.priceToman) continue;
    await tx.livePrice.upsert({
      where: { productId_target: { productId: d.productId, target: d.target } },
      create: { storeId, productId: d.productId, target: d.target, priceToman: d.priceToman, updatedAt: now },
      update: { priceToman: d.priceToman, updatedAt: now },
    });
  }
}

export class PrismaLinkReader implements LinkReader {
  async list(storeId: string, productId: string): Promise<LinkView[] | null> {
    if (!(await db.product.findFirst({ where: { id: productId, storeId }, select: { id: true } }))) return null;
    return db.priceLink.findMany({ where: { storeId, productId }, select: linkSelect, orderBy: { target: "asc" } });
  }
}

function writesFor(ctx: MutationContext): LinkWrites {
  const { tx, storeId } = ctx;
  return {
    async lockProduct(productId) {
      if ((await lockProducts(tx, storeId, [productId])).length !== 1) return null;
      const variants = await tx.productVariant.findMany({ where: { storeId, productId }, select: { id: true } });
      return { variantIds: variants.map((v) => v.id) };
    },
    async upsert(productId, variantId, link, priceToman, rateAt) {
      const fields = {
        kind: link.kind,
        usdCents: link.kind === "USD" ? link.usdCents : null,
        weightMg: link.kind === "GOLD" ? link.weightMg : null,
        wageBp: link.kind === "GOLD" ? link.wageBp : 0,
        profitBp: link.kind === "GOLD" ? link.profitBp : 0,
        taxBp: link.kind === "GOLD" ? link.taxBp : 0,
        stoneToman: link.kind === "GOLD" ? link.stoneToman : 0,
        roundingToman: link.roundingToman,
        status: "OK" as const,
        lastPriceToman: priceToman,
        lastRateAt: rateAt,
      };
      const target = targetOf(variantId);
      return tx.priceLink.upsert({
        where: { productId_target: { productId, target } },
        create: { storeId, productId, variantId, target, ...fields },
        update: fields,
        select: linkSelect,
      });
    },
    async remove(productId, variantId) {
      const r = await tx.priceLink.deleteMany({ where: { storeId, productId, target: targetOf(variantId) } });
      return r.count === 1;
    },
    async applyPrice(productId, variantId, priceToman, now) {
      await setTargetPrice(tx, storeId, productId, variantId, priceToman);
      await syncDerived(tx, storeId, [productId], now);
    },
    async dropLive(productId, _variantId, now) {
      await syncDerived(tx, storeId, [productId], now);
    },
  };
}

/** Merchant link changes are ordinary draft edits: the store mutation (ownership, store lock, draft revision). */
export class PrismaLinkUnitOfWork implements LinkUnitOfWork {
  run<T>(ownerId: string, storeId: string, work: (w: LinkWrites) => Promise<T>): Promise<T> {
    return withStoreMutation(ownerId, storeId, (ctx) => work(writesFor(ctx)));
  }
}

export class PrismaRepricer implements Repricer {
  async repriceAll(now: Date) {
    const totals = { stores: 0, priced: 0, outOfRange: 0, failedStores: 0 };
    // Live rows whose link is gone (a variant or link removed in a way that did not sync): never shown again. Best effort: a lock
    // conflict with a merchant's own sync is logged and the next run retries; it never stops repricing.
    try {
      await db.$executeRaw`DELETE FROM "LivePrice" lp WHERE NOT EXISTS (SELECT 1 FROM "PriceLink" pl WHERE pl."productId" = lp."productId" AND pl."target" = lp."target")`;
    } catch (e) {
      log.error("pricing.live_cleanup_failed", { error: e instanceof Error ? e.name : "unknown" });
    }
    const stores = await db.priceLink.groupBy({ by: ["storeId"], orderBy: { storeId: "asc" } });
    for (const { storeId } of stores) {
      try {
        // One transaction per store; a failing store is logged and skipped (the next run retries it), never stops the others.
        const r = await db.$transaction(async (tx) => {
          const rows = await tx.priceLink.findMany({ where: { storeId }, select: linkSelect, orderBy: [{ productId: "asc" }, { target: "asc" }] });
          const productIds = [...new Set(rows.map((x) => x.productId))];
          await lockProducts(tx, storeId, productIds);
          // The rates are read after the locks: a rate applied while this run was on other stores is the one used here.
          const rates = await currentRates(tx);
          const byTarget = new Map(rows.map((x) => [`${x.productId}|${targetOf(x.variantId)}`, x]));
          const stored: StoredLink[] = rows.map((x) => ({ productId: x.productId, variantId: x.variantId, link: toPriceLink(x) }));
          let priced = 0;
          let outOfRange = 0;
          for (const o of repriceLinks(stored, rates)) {
            const target = targetOf(o.variantId);
            const cur = byTarget.get(`${o.productId}|${target}`)!;
            const where = { productId_target: { productId: o.productId, target } };
            if (o.result === "priced") {
              priced++;
              if (cur.lastPriceToman === o.priceToman && cur.status === "OK") continue; // unchanged: nothing to write
              await setTargetPrice(tx, storeId, o.productId, o.variantId, o.priceToman);
              await tx.priceLink.update({ where, data: { status: "OK", lastPriceToman: o.priceToman, lastRateAt: o.rateAt } });
            } else if (o.result === "out_of_range") {
              outOfRange++;
              if (cur.status !== "OUT_OF_RANGE") await tx.priceLink.update({ where, data: { status: "OUT_OF_RANGE" } });
            }
          }
          await syncDerived(tx, storeId, productIds, now);
          return { priced, outOfRange };
        }, TX);
        totals.priced += r.priced;
        totals.outOfRange += r.outOfRange;
      } catch (e) {
        totals.failedStores++;
        log.error("pricing.reprice_store_failed", { storeId, error: e instanceof Error ? e.name : "unknown" });
      }
      totals.stores++;
    }
    return totals;
  }
}

/** For the inventory module, inside ITS store mutation: after variants were replaced, the live rows of removed variants go at once. */
export async function syncLiveInTx(ctx: MutationContext, productId: string): Promise<void> {
  await syncDerived(ctx.tx, ctx.storeId, [productId], new Date());
}

/** For the products module, inside ITS store mutation: a product whose own price follows a link cannot have its price edited. */
export async function productPriceLinkedInTx(ctx: MutationContext, productId: string): Promise<boolean> {
  return (await ctx.tx.priceLink.count({ where: { storeId: ctx.storeId, productId, target: PRODUCT_TARGET } })) > 0;
}

/** For the inventory module, inside ITS store mutation: which variants of a product follow a link (their price is kept on replace). */
export async function linkedVariantIdsInTx(ctx: MutationContext, productId: string): Promise<{ productLinked: boolean; variantIds: string[] }> {
  const rows = await ctx.tx.priceLink.findMany({ where: { storeId: ctx.storeId, productId }, select: { variantId: true } });
  return { productLinked: rows.some((r) => r.variantId === null), variantIds: rows.flatMap((r) => (r.variantId ? [r.variantId] : [])) };
}
