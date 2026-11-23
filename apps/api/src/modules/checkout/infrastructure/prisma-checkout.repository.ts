import type { Prisma } from "@prisma/client";
import { shippingMethodInputSchema, type AddressInput, type ShippingMethod, type ShippingMethodInput } from "@store-builder/shared/modules/checkout/checkout";
import { AddressLimitError } from "@store-builder/shared/modules/checkout/errors";
import { NotFoundError } from "@store-builder/shared/modules/stores/errors";
import type { StorefrontProduct } from "@store-builder/shared/templates/storefront-data";
import { db } from "../../../lib/db.js";
import { log } from "../../../logging/json-logger.js";
import { livePricesOf, loadPublishedSnapshot, resolveLiveStore, withLivePrices } from "../../publishing/publishing.api.js";
import type { AddressStore, CartRow, CartStore, CheckoutReads, SavedAddress, ShippingStore } from "../application/ports.js";
import { stockKey, type CartLine, type StockFact } from "../domain/quote.js";

// The only file of the checkout module that reaches the database. Every query is bound to the store id (and, for addresses, the customer).
// Product and ProductVariant rows are READ here for two columns only, status and stockQuantity (the same facts the stock ledger reads);
// prices and everything else shown to the shopper come from the published snapshot. Guarded in domain.architecture.test.ts.

const TX = { timeout: 10_000, maxWait: 5_000 } as const;
const prismaCode = (e: unknown) => (typeof e === "object" && e !== null ? (e as { code?: unknown }).code : undefined);
const isFkViolation = (e: unknown) => prismaCode(e) === "P2003";
/** The partial unique index "one cart per customer" (raw SQL in the migration; Prisma reports it as P2002, or as a raw 23505). */
const isUniqueViolation = (e: unknown) => prismaCode(e) === "P2002" || (e as { meta?: { code?: unknown } } | null)?.meta?.code === "23505";

type Tx = Prisma.TransactionClient;
type ItemRow = { id: string; lineKey: string; productId: string; variantId: string | null; quantity: number };
const itemSelect = { id: true, lineKey: true, productId: true, variantId: true, quantity: true } as const;
const lineOf = (r: ItemRow): CartLine => ({ productId: r.productId, variantId: r.variantId, quantity: r.quantity });
const itemOrder = [{ createdAt: "asc" as const }, { id: "asc" as const }];

async function itemsOf(tx: Tx | typeof db, storeId: string, cartId: string): Promise<ItemRow[]> {
  return tx.cartItem.findMany({ where: { storeId, cartId }, select: itemSelect, orderBy: itemOrder });
}

/** Writes the difference between `items` (current rows) and `after` (wanted lines) and touches the cart (its age counts from here). */
async function applyLines(tx: Tx, storeId: string, cartId: string, items: ItemRow[], after: CartLine[]): Promise<void> {
  const wanted = new Map(after.map((l) => [stockKey(l.productId, l.variantId), l]));
  const gone = items.filter((i) => !wanted.has(i.lineKey)).map((i) => i.id);
  if (gone.length) await tx.cartItem.deleteMany({ where: { storeId, cartId, id: { in: gone } } });
  const current = new Map(items.map((i) => [i.lineKey, i]));
  for (const l of after) {
    const lineKey = stockKey(l.productId, l.variantId);
    const cur = current.get(lineKey);
    if (!cur) await tx.cartItem.create({ data: { storeId, cartId, productId: l.productId, variantId: l.variantId, lineKey, quantity: l.quantity } });
    else if (cur.quantity !== l.quantity) await tx.cartItem.updateMany({ where: { id: cur.id, storeId, cartId }, data: { quantity: l.quantity } });
  }
  await tx.cart.updateMany({ where: { id: cartId, storeId }, data: { updatedAt: new Date() } });
}

export class PrismaCartStore implements CartStore {
  private async load(where: Prisma.CartWhereInput): Promise<CartRow | null> {
    const cart = await db.cart.findFirst({ where, select: { id: true, storeId: true, customerId: true }, orderBy: { updatedAt: "desc" } });
    if (!cart) return null;
    return { id: cart.id, customerId: cart.customerId, lines: (await itemsOf(db, cart.storeId, cart.id)).map(lineOf) };
  }

  findByTokenHash(storeId: string, tokenHash: string) {
    return this.load({ storeId, tokenHash });
  }

  findByCustomer(storeId: string, customerId: string) {
    return this.load({ storeId, customerId });
  }

  async create(storeId: string, tokenHash: string, customerId: string | null): Promise<CartRow> {
    try {
      const c = await db.cart.create({ data: { storeId, tokenHash, customerId }, select: { id: true, customerId: true } });
      return { id: c.id, customerId: c.customerId, lines: [] };
    } catch (e) {
      if (customerId && isUniqueViolation(e)) {
        const theirs = await this.findByCustomer(storeId, customerId);
        if (theirs) return theirs;
      }
      throw e;
    }
  }

  async update(storeId: string, cartId: string, change: (lines: CartLine[]) => CartLine[]): Promise<CartLine[] | null> {
    try {
      return await db.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Cart" WHERE id = ${cartId} AND "storeId" = ${storeId} FOR UPDATE`;
        if (locked.length !== 1) return null;
        const items = await itemsOf(tx, storeId, cartId);
        const after = change(items.map(lineOf));
        await applyLines(tx, storeId, cartId, items, after);
        return after;
      }, TX);
    } catch (e) {
      // The product or variant was deleted (in the draft) after it was published: it cannot be bought any more.
      if (isFkViolation(e)) throw new NotFoundError();
      throw e;
    }
  }

  async attachCustomer(storeId: string, cartId: string, customerId: string): Promise<boolean> {
    try {
      await db.cart.updateMany({ where: { id: cartId, storeId, customerId: null }, data: { customerId } });
      return true;
    } catch (e) {
      if (isUniqueViolation(e)) return false;
      throw e;
    }
  }

  async mergeInto(storeId: string, guestCartId: string, customerCartId: string, merge: (into: CartLine[], from: CartLine[]) => CartLine[]): Promise<void> {
    await db.$transaction(async (tx) => {
      const ids = [guestCartId, customerCartId].sort();
      const locked = await tx.$queryRaw<{ id: string; customerId: string | null }[]>`
        SELECT id, "customerId" FROM "Cart" WHERE "storeId" = ${storeId} AND id = ANY(${ids}) ORDER BY id FOR UPDATE`;
      const guest = locked.find((c) => c.id === guestCartId);
      if (!guest || guest.customerId !== null || !locked.some((c) => c.id === customerCartId)) return; // already merged or gone
      const from = (await itemsOf(tx, storeId, guestCartId)).map(lineOf);
      const items = await itemsOf(tx, storeId, customerCartId);
      await tx.cart.deleteMany({ where: { id: guestCartId, storeId } });
      await applyLines(tx, storeId, customerCartId, items, merge(items.map(lineOf), from));
    }, TX);
  }

  async purgeExpired(before: Date, limit: number): Promise<number> {
    const due = await db.cart.findMany({ where: { updatedAt: { lt: before } }, select: { id: true }, orderBy: { updatedAt: "asc" }, take: limit });
    if (!due.length) return 0;
    const r = await db.cart.deleteMany({ where: { id: { in: due.map((d) => d.id) }, updatedAt: { lt: before } } });
    return r.count;
  }
}

type MethodRow = Prisma.ShippingMethodGetPayload<{ select: typeof methodSelect }>;
const methodSelect = {
  id: true, name: true, kind: true, enabled: true, description: true, price: true, perKg: true, defaultItemGrams: true, provinces: true,
  provincePrices: true, freeAbove: true, codEnabled: true, codProvinces: true, codFee: true,
} satisfies Prisma.ShippingMethodSelect;

/** Stored rows are validated, never trusted: a row the rules no longer accept is left out of checkout (fail closed) and logged. */
function toMethod(r: MethodRow): ShippingMethod | null {
  const parsed = shippingMethodInputSchema.safeParse({
    name: r.name, kind: r.kind, enabled: r.enabled, description: r.description, price: r.price, perKg: r.perKg, defaultItemGrams: r.defaultItemGrams,
    provinces: r.provinces, provincePrices: r.provincePrices, freeAbove: r.freeAbove,
    cashOnDelivery: { enabled: r.codEnabled, provinces: r.codProvinces, fee: r.codFee },
  });
  if (!parsed.success) {
    log.warn("checkout.shipping_method_invalid", { methodId: r.id });
    return null;
  }
  return { ...parsed.data, id: r.id };
}

const methodData = (m: ShippingMethodInput, position: number) => ({
  name: m.name, kind: m.kind, enabled: m.enabled, description: m.description, price: m.price, perKg: m.perKg, defaultItemGrams: m.defaultItemGrams,
  provinces: m.provinces, provincePrices: m.provincePrices as unknown as Prisma.InputJsonValue, freeAbove: m.freeAbove,
  codEnabled: m.cashOnDelivery.enabled, codProvinces: m.cashOnDelivery.provinces, codFee: m.cashOnDelivery.fee, position,
});

const methodOrder = [{ position: "asc" as const }, { id: "asc" as const }];

export class PrismaShippingStore implements ShippingStore {
  async list(storeId: string): Promise<ShippingMethod[]> {
    const rows = await db.shippingMethod.findMany({ where: { storeId }, select: methodSelect, orderBy: methodOrder });
    return rows.flatMap((r) => toMethod(r) ?? []);
  }

  replace(storeId: string, methods: readonly ShippingMethodInput[]): Promise<ShippingMethod[]> {
    return db.$transaction(async (tx) => {
      // Serialises concurrent replacements of one store's list (otherwise two could both delete, then both insert).
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Store" WHERE id = ${storeId} FOR NO KEY UPDATE`;
      if (locked.length !== 1) throw new NotFoundError();
      await tx.shippingMethod.deleteMany({ where: { storeId } });
      if (methods.length) await tx.shippingMethod.createMany({ data: methods.map((m, i) => ({ storeId, ...methodData(m, i) })) });
      const rows = await tx.shippingMethod.findMany({ where: { storeId }, select: methodSelect, orderBy: methodOrder });
      return rows.flatMap((r) => toMethod(r) ?? []);
    }, TX);
  }
}

export class PrismaCheckoutReads implements CheckoutReads {
  async liveStore(label: string) {
    const live = await resolveLiveStore(label);
    return live ? { storeId: live.storeId, versionId: live.versionId } : null;
  }

  async publishedProducts(storeId: string, versionId: string): Promise<StorefrontProduct[] | null> {
    const data = await loadPublishedSnapshot(versionId);
    if (!data) return null;
    return withLivePrices(data, await livePricesOf(storeId)).products;
  }

  async stock(storeId: string, lines: readonly { productId: string; variantId: string | null }[]): Promise<Map<string, StockFact>> {
    const productIds = [...new Set(lines.map((l) => l.productId))];
    const variantIds = [...new Set(lines.flatMap((l) => (l.variantId ? [l.variantId] : [])))];
    const products = new Map(
      (await db.$queryRaw<{ id: string; status: string; stockQuantity: number }[]>`
        SELECT id, status::text AS status, "stockQuantity" FROM "Product" WHERE "storeId" = ${storeId} AND id = ANY(${productIds})`).map((p) => [p.id, p]),
    );
    const variants = new Map(
      (variantIds.length
        ? await db.$queryRaw<{ id: string; productId: string; stockQuantity: number }[]>`
            SELECT id, "productId", "stockQuantity" FROM "ProductVariant" WHERE "storeId" = ${storeId} AND id = ANY(${variantIds})`
        : []
      ).map((v) => [v.id, v]),
    );
    // A product that has variants now (in the draft) is sold only by variant, as the stock ledger enforces (D32-1).
    const withVariants = new Set(
      (await db.$queryRaw<{ productId: string }[]>`SELECT DISTINCT "productId" FROM "ProductVariant" WHERE "storeId" = ${storeId} AND "productId" = ANY(${productIds})`).map((r) => r.productId),
    );
    const facts = new Map<string, StockFact>();
    for (const l of lines) {
      const p = products.get(l.productId);
      if (!p) continue;
      if (l.variantId === null) {
        facts.set(stockKey(l.productId, null), { productActive: p.status === "ACTIVE" && !withVariants.has(l.productId), available: p.stockQuantity });
        continue;
      }
      const v = variants.get(l.variantId);
      if (v && v.productId === l.productId) facts.set(stockKey(l.productId, l.variantId), { productActive: p.status === "ACTIVE", available: v.stockQuantity });
    }
    return facts;
  }

  async enabledShippingMethods(storeId: string): Promise<ShippingMethod[]> {
    const rows = await db.shippingMethod.findMany({ where: { storeId, enabled: true }, select: methodSelect, orderBy: methodOrder });
    return rows.flatMap((r) => toMethod(r) ?? []);
  }
}

const addressSelect = { id: true, recipientName: true, phone: true, province: true, city: true, line: true, postalCode: true } as const;

export class PrismaAddressStore implements AddressStore {
  list(storeId: string, customerId: string): Promise<SavedAddress[]> {
    return db.customerAddress.findMany({ where: { storeId, customerId }, select: addressSelect, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  }

  get(storeId: string, customerId: string, id: string): Promise<SavedAddress | null> {
    return db.customerAddress.findFirst({ where: { id, storeId, customerId }, select: addressSelect });
  }

  create(storeId: string, customerId: string, a: AddressInput, max: number): Promise<SavedAddress> {
    return db.$transaction(async (tx) => {
      // The customer row lock makes "count, then insert" safe against concurrent creates.
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Customer" WHERE id = ${customerId} AND "storeId" = ${storeId} FOR UPDATE`;
      if (locked.length !== 1) throw new NotFoundError();
      if ((await tx.customerAddress.count({ where: { storeId, customerId } })) >= max) throw new AddressLimitError(max);
      return tx.customerAddress.create({ data: { storeId, customerId, ...a }, select: addressSelect });
    }, TX);
  }

  async update(storeId: string, customerId: string, id: string, a: AddressInput): Promise<SavedAddress | null> {
    const r = await db.customerAddress.updateMany({ where: { id, storeId, customerId }, data: a });
    return r.count === 1 ? this.get(storeId, customerId, id) : null;
  }

  async delete(storeId: string, customerId: string, id: string): Promise<boolean> {
    const r = await db.customerAddress.deleteMany({ where: { id, storeId, customerId } });
    return r.count === 1;
  }
}

/** For db-cleanup (no Nest): carts untouched for `days` are deleted (their lines cascade). */
export async function purgeExpiredCarts(now: Date, days: number, limit = 5_000): Promise<number> {
  return new PrismaCartStore().purgeExpired(new Date(now.getTime() - days * 86_400_000), limit);
}

/** Phase 3.4: the order empties the cart in ITS transaction (an order is placed if and only if its cart is emptied). */
export async function clearCartInTx(scope: { readonly tx: Prisma.TransactionClient }, storeId: string, cartId: string): Promise<void> {
  await scope.tx.cartItem.deleteMany({ where: { storeId, cartId } });
  await scope.tx.cart.updateMany({ where: { id: cartId, storeId }, data: { updatedAt: new Date() } });
}
