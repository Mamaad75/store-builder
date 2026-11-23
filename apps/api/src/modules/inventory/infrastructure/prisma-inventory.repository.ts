import type { Prisma } from "@prisma/client";
import { db } from "../../../lib/db.js";
import { withStoreMutation, type MutationContext } from "../../stores/stores.api.js";
import { updateProductRow } from "../../products/products.api.js";
import type { ReservationLine, StockFacts } from "../domain/inventory.js";
import type { StockLedger, VariantData, VariantReader, VariantUnitOfWork, VariantView, VariantWrites } from "../application/ports.js";
import { MAX_STOCK, type VariantOption } from "@store-builder/shared/modules/inventory/variants";
import { log } from "../../../logging/json-logger.js";

// The only files of the inventory module that reach the database. Every query is bound to the store id.
// Lock order for every stock writer: Product rows (by id) -> ProductVariant rows (by id) -> StockReservation rows.
// THE stock ledger (D32-1): the only code outside the catalog repositories that writes Product rows (raw stockQuantity moves by checkout,
// which are not draft edits: they lock product rows only and never bump the draft revision). Guarded in domain.architecture.test.ts.

const variantSelect = { id: true, options: true, optionsKey: true, sku: true, price: true, stockQuantity: true, position: true } as const;
type VariantRow = { id: string; options: Prisma.JsonValue; optionsKey: string; sku: string | null; price: number; stockQuantity: number; position: number };
const toView = (r: VariantRow): VariantView => ({ ...r, options: r.options as unknown as VariantOption[] });
const byPosition = [{ position: "asc" as const }, { id: "asc" as const }];

export class PrismaVariantReader implements VariantReader {
  async list(storeId: string, productId: string): Promise<VariantView[] | null> {
    const product = await db.product.findFirst({ where: { id: productId, storeId }, select: { id: true } });
    if (!product) return null;
    const rows = await db.productVariant.findMany({ where: { storeId, productId }, select: variantSelect, orderBy: byPosition });
    return rows.map(toView);
  }
}

function writesFor(ctx: MutationContext): VariantWrites {
  const { tx, storeId } = ctx;
  const data = (d: VariantData) => ({ options: d.options as unknown as Prisma.InputJsonValue, optionsKey: d.optionsKey, sku: d.sku, price: d.price, stockQuantity: d.stockQuantity, position: d.position });
  return {
    async lockProduct(productId) {
      const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Product" WHERE id = ${productId} AND "storeId" = ${storeId} FOR UPDATE`;
      return rows.length === 1;
    },
    async list(productId) {
      const rows = await tx.productVariant.findMany({ where: { storeId, productId }, select: variantSelect, orderBy: byPosition });
      return rows.map(toView);
    },
    countInStore: () => tx.productVariant.count({ where: { storeId } }),
    async update(id, d) {
      const r = await tx.productVariant.updateMany({ where: { id, storeId }, data: data(d) });
      if (r.count !== 1) throw new Error("variant vanished under the product lock");
    },
    async insert(productId, d) {
      await tx.productVariant.create({ data: { storeId, productId, ...data(d) } });
    },
    async dropReservations(productId, variantIds, productLevel) {
      const or: Prisma.StockReservationWhereInput[] = [];
      if (variantIds.length) or.push({ variantId: { in: variantIds } });
      if (productLevel) or.push({ variantId: null });
      if (!or.length) return 0;
      const r = await tx.stockReservation.updateMany({ where: { storeId, productId, status: "ACTIVE", OR: or }, data: { status: "RELEASED" } });
      return r.count;
    },
    async delete(variantIds) {
      await tx.productVariant.deleteMany({ where: { storeId, id: { in: variantIds } } });
    },
    async setProductSummary(productId, s) {
      // Through the catalog repository: a draft write inside this store mutation, like any other product edit.
      if (!(await updateProductRow(ctx, productId, { price: s.price, stockQuantity: s.stockQuantity }))) throw new Error("product vanished under its lock");
    },
  };
}

/** The store mutation (ownership in SQL, store row lock, draftRevision bump, draft lock timeout) as the unit of work. */
export class PrismaVariantUnitOfWork implements VariantUnitOfWork {
  run<T>(ownerId: string, storeId: string, work: (writes: VariantWrites) => Promise<T>): Promise<T> {
    return withStoreMutation(ownerId, storeId, (ctx) => work(writesFor(ctx)));
  }
}

/** Thrown inside a ledger transaction when a guarded update hits 0 rows although the row was read under its lock: never expected. */
class StockInvariantError extends Error {
  constructor(what: string) {
    super(`stock invariant broken: ${what}`);
    this.name = "StockInvariantError";
  }
}

const TX = { timeout: 10_000, maxWait: 5_000 } as const;

async function lockProducts(tx: Prisma.TransactionClient, storeId: string, productIds: string[]) {
  const ids = [...new Set(productIds)].sort();
  return tx.$queryRaw<{ id: string; status: string; stockQuantity: number }[]>`
    SELECT id, status::text AS status, "stockQuantity" FROM "Product" WHERE "storeId" = ${storeId} AND id = ANY(${ids}) ORDER BY id FOR UPDATE`;
}

/**
 * Puts released quantities back. Clamped to the stock bound (MAX_STOCK, a CHECK on both tables): the merchant may have raised the stock to the
 * maximum meanwhile, and a give-back must never fail (a failing one would block the release forever).
 */
async function giveBack(tx: Prisma.TransactionClient, storeId: string, rows: { productId: string; variantId: string | null; quantity: number }[]) {
  for (const r of rows) {
    if (r.variantId) await tx.$executeRaw`UPDATE "ProductVariant" SET "stockQuantity" = LEAST("stockQuantity" + ${r.quantity}, ${MAX_STOCK}), "updatedAt" = now() WHERE id = ${r.variantId} AND "storeId" = ${storeId}`;
    await tx.$executeRaw`UPDATE "Product" SET "stockQuantity" = LEAST("stockQuantity" + ${r.quantity}, ${MAX_STOCK}), "updatedAt" = now() WHERE id = ${r.productId} AND "storeId" = ${storeId}`;
  }
}

export class PrismaStockLedger implements StockLedger {
  reserve(
    storeId: string,
    ref: string,
    lines: ReservationLine[],
    expiresAt: Date,
    decide: (facts: StockFacts[]) => { line: ReservationLine; available: number }[],
  ) {
    return db.$transaction(async (tx) => {
      const products = new Map((await lockProducts(tx, storeId, lines.map((l) => l.productId))).map((p) => [p.id, p]));
      const variantIds = [...new Set(lines.flatMap((l) => (l.variantId ? [l.variantId] : [])))].sort();
      const variants = new Map(
        (variantIds.length
          ? await tx.$queryRaw<{ id: string; productId: string; stockQuantity: number }[]>`
              SELECT id, "productId", "stockQuantity" FROM "ProductVariant" WHERE "storeId" = ${storeId} AND id = ANY(${variantIds}) ORDER BY id FOR UPDATE`
          : []
        ).map((v) => [v.id, v]),
      );
      const productIds = [...products.keys()];
      const withVariants = new Set(
        (await tx.$queryRaw<{ productId: string }[]>`SELECT DISTINCT "productId" FROM "ProductVariant" WHERE "storeId" = ${storeId} AND "productId" = ANY(${productIds})`).map((r) => r.productId),
      );
      const facts: StockFacts[] = lines.map((l) => {
        const p = products.get(l.productId);
        const v = l.variantId ? variants.get(l.variantId) : undefined;
        const available = !p ? null : l.variantId ? (v && v.productId === l.productId ? v.stockQuantity : null) : p.stockQuantity;
        return { productActive: p?.status === "ACTIVE", hasVariants: withVariants.has(l.productId), available };
      });
      const short = decide(facts);
      if (short.length) return { reserved: false as const, short };
      for (const l of lines) {
        if (l.variantId) {
          const n = await tx.$executeRaw`UPDATE "ProductVariant" SET "stockQuantity" = "stockQuantity" - ${l.quantity}, "updatedAt" = now()
            WHERE id = ${l.variantId} AND "storeId" = ${storeId} AND "stockQuantity" >= ${l.quantity}`;
          if (n !== 1) throw new StockInvariantError("variant");
        }
        const n = await tx.$executeRaw`UPDATE "Product" SET "stockQuantity" = "stockQuantity" - ${l.quantity}, "updatedAt" = now()
          WHERE id = ${l.productId} AND "storeId" = ${storeId} AND "stockQuantity" >= ${l.quantity}`;
        if (n !== 1) throw new StockInvariantError("product");
      }
      await tx.stockReservation.createMany({ data: lines.map((l) => ({ storeId, productId: l.productId, variantId: l.variantId, quantity: l.quantity, ref, expiresAt })) });
      return { reserved: true as const };
    }, TX);
  }

  release(storeId: string, ref: string): Promise<number> {
    return db.$transaction(async (tx) => {
      const pending = await tx.stockReservation.findMany({ where: { storeId, ref, status: "ACTIVE" }, select: { productId: true } });
      if (!pending.length) return 0;
      await lockProducts(tx, storeId, pending.map((p) => p.productId)); // lock order: products before reservation rows
      const rows = await tx.$queryRaw<{ productId: string; variantId: string | null; quantity: number }[]>`
        UPDATE "StockReservation" SET status = 'RELEASED', "updatedAt" = now()
        WHERE "storeId" = ${storeId} AND ref = ${ref} AND status = 'ACTIVE' RETURNING "productId", "variantId", quantity`;
      await giveBack(tx, storeId, rows);
      return rows.length;
    }, TX);
  }

  consume(storeId: string, ref: string, now: Date, expectedLines: number): Promise<boolean> {
    return db.$transaction(async (tx) => {
      // Lock the hold first: a release or a variant change cannot take a line away between the count and the update.
      const held = await tx.$queryRaw<{ id: string; expiresAt: Date }[]>`
        SELECT id, "expiresAt" FROM "StockReservation" WHERE "storeId" = ${storeId} AND ref = ${ref} AND status = 'ACTIVE' ORDER BY id FOR UPDATE`;
      if (held.length !== expectedLines || held.some((h) => h.expiresAt <= now)) return false;
      const r = await tx.stockReservation.updateMany({ where: { id: { in: held.map((h) => h.id) } }, data: { status: "CONSUMED" } });
      return r.count === expectedLines;
    }, TX);
  }

  async releaseExpired(now: Date, limit: number): Promise<number> {
    const due = await db.stockReservation.findMany({
      where: { status: "ACTIVE", expiresAt: { lte: now } },
      select: { id: true, storeId: true, productId: true },
      orderBy: { expiresAt: "asc" },
      take: limit,
    });
    let released = 0;
    for (const d of due) {
      // One small transaction per reservation: product lock first, then the reservation row (re-checked: it may have been consumed).
      // A failure is logged and skipped, so one bad row can never stop the sweep for every other store.
      try {
        released += await db.$transaction(async (tx) => {
        await lockProducts(tx, d.storeId, [d.productId]);
        const rows = await tx.$queryRaw<{ productId: string; variantId: string | null; quantity: number }[]>`
          UPDATE "StockReservation" SET status = 'RELEASED', "updatedAt" = now()
          WHERE id = ${d.id} AND status = 'ACTIVE' AND "expiresAt" <= ${now} RETURNING "productId", "variantId", quantity`;
        await giveBack(tx, d.storeId, rows);
        return rows.length;
      }, TX);
      } catch (e) {
        log.error("inventory.release_expired_failed", { reservationId: d.id, error: e instanceof Error ? e.name : "unknown" });
      }
    }
    return released;
  }
}

/** For the products module: inside ITS store mutation, whether the product's price and stock are owned by its variants. */
export async function productHasVariantsInTx(ctx: MutationContext, productId: string): Promise<boolean> {
  return (await ctx.tx.productVariant.count({ where: { storeId: ctx.storeId, productId }, take: 1 })) > 0;
}
