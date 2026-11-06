import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { MutationContext } from "@/modules/stores/mutation";

export const categorySelect = {
  id: true,
  name: true,
  slug: true,
  createdAt: true,
  _count: { select: { products: true } },
} satisfies Prisma.ProductCategorySelect;

export type CategoryView = Prisma.ProductCategoryGetPayload<{ select: typeof categorySelect }>;

/** Reads are bound to the owner through the store relation, in SQL. */
export class CategoryRepository {
  constructor(private readonly ownerId: string) {
    if (!ownerId) throw new Error("CategoryRepository requires an ownerId");
  }

  list(storeId: string): Promise<CategoryView[]> {
    return db.productCategory.findMany({
      where: { storeId, store: { ownerId: this.ownerId } },
      select: categorySelect,
      orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    });
  }

  find(storeId: string, id: string): Promise<CategoryView | null> {
    return db.productCategory.findFirst({
      where: { id, storeId, store: { ownerId: this.ownerId } },
      select: categorySelect,
    });
  }
}

// ---- writes: require a MutationContext (ownership verified + store locked + revision bumped) ----

const scope = (ctx: MutationContext, id?: string) => ({
  ...(id ? { id } : {}),
  storeId: ctx.storeId,
  store: { ownerId: ctx.ownerId },
});

export const listInTx = (ctx: MutationContext) =>
  ctx.tx.productCategory.findMany({ where: scope(ctx), select: { id: true, name: true, slug: true } });

export const findInTx = (ctx: MutationContext, id: string) =>
  ctx.tx.productCategory.findFirst({ where: scope(ctx, id), select: { id: true, name: true, slug: true } });

export const countInTx = (ctx: MutationContext) => ctx.tx.productCategory.count({ where: scope(ctx) });

export async function insertCategory(ctx: MutationContext, data: { name: string; slug: string }) {
  return ctx.tx.productCategory.create({
    data: { storeId: ctx.storeId, name: data.name, slug: data.slug },
    select: { id: true },
  });
}

export async function renameCategory(ctx: MutationContext, id: string, name: string): Promise<boolean> {
  const res = await ctx.tx.productCategory.updateMany({ where: scope(ctx, id), data: { name } });
  return res.count === 1;
}

/** Locks the category row (store row is already locked: order Store -> category -> product). */
export async function lockCategory(ctx: MutationContext, id: string): Promise<boolean> {
  const rows = await ctx.tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "ProductCategory" WHERE "id" = ${id} AND "storeId" = ${ctx.storeId} FOR UPDATE`;
  return rows.length === 1;
}

export const countProductsInCategory = (ctx: MutationContext, categoryId: string) =>
  ctx.tx.product.count({ where: { storeId: ctx.storeId, categoryId, store: { ownerId: ctx.ownerId } } });

export async function detachProductsFromCategory(ctx: MutationContext, categoryId: string): Promise<number> {
  const res = await ctx.tx.product.updateMany({
    where: { storeId: ctx.storeId, categoryId, store: { ownerId: ctx.ownerId } },
    data: { categoryId: null },
  });
  return res.count;
}

export async function deleteCategoryRow(ctx: MutationContext, id: string): Promise<boolean> {
  const res = await ctx.tx.productCategory.deleteMany({ where: scope(ctx, id) });
  return res.count === 1;
}
