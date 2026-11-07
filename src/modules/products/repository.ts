import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { escapeLike } from "@/lib/text";
import type { MutationContext } from "@/modules/stores/mutation";
import type { ProductStatus } from "./status";

export const productSelect = {
  id: true,
  name: true,
  slug: true,
  description: true,
  price: true,
  stockQuantity: true,
  status: true,
  categoryId: true,
  category: { select: { id: true, name: true } },
  image: { select: { id: true, key: true, width: true, height: true } },
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ProductSelect;

export type ProductView = Prisma.ProductGetPayload<{ select: typeof productSelect }>;

export interface ProductFilters {
  q?: string; // already normalised with normalizeSearchQuery
  categoryId?: string | "none";
  status?: ProductStatus;
  page: number;
  pageSize: number;
}

export class ProductRepository {
  constructor(private readonly ownerId: string) {
    if (!ownerId) throw new Error("ProductRepository requires an ownerId");
  }

  private where(storeId: string, f: Pick<ProductFilters, "q" | "categoryId" | "status">): Prisma.ProductWhereInput {
    const and: Prisma.ProductWhereInput[] = [];
    if (f.q) {
      // Prisma's `contains` does NOT escape LIKE wildcards, so escape them here. searchKey and slug are
      // already normalised/lowercase, and q went through the same normalisation.
      const like = escapeLike(f.q);
      and.push({ OR: [{ searchKey: { contains: like } }, { slug: { contains: like.replace(/\s+/g, "-") } }] });
    }
    if (f.categoryId === "none") and.push({ categoryId: null });
    else if (f.categoryId) and.push({ categoryId: f.categoryId });
    if (f.status) and.push({ status: f.status });
    return { storeId, store: { ownerId: this.ownerId }, AND: and };
  }

  async list(storeId: string, f: ProductFilters) {
    const where = this.where(storeId, f);
    const total = await db.product.count({ where });
    const totalPages = Math.max(1, Math.ceil(total / f.pageSize));
    const page = Math.min(f.page, totalPages);
    const items = await db.product.findMany({
      where,
      select: productSelect,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * f.pageSize,
      take: f.pageSize,
    });
    return { items, total, page, pageSize: f.pageSize, totalPages };
  }

  find(storeId: string, id: string): Promise<ProductView | null> {
    return db.product.findFirst({
      where: { id, storeId, store: { ownerId: this.ownerId } },
      select: productSelect,
    });
  }
}

// ---- writes: require a MutationContext ----

const scope = (ctx: MutationContext, id?: string) => ({
  ...(id ? { id } : {}),
  storeId: ctx.storeId,
  store: { ownerId: ctx.ownerId },
});

export const countInTx = (ctx: MutationContext) => ctx.tx.product.count({ where: scope(ctx) });

export const findInTx = (ctx: MutationContext, id: string) =>
  ctx.tx.product.findFirst({ where: scope(ctx, id), select: productSelect });

export async function slugsStartingWith(ctx: MutationContext, base: string): Promise<Set<string>> {
  const rows = await ctx.tx.product.findMany({
    where: { ...scope(ctx), slug: { startsWith: base } },
    select: { slug: true },
  });
  return new Set(rows.map((r) => r.slug));
}

export interface NewProductRow {
  name: string;
  slug: string;
  description: string;
  price: number;
  stockQuantity: number;
  categoryId: string | null;
  searchKey: string;
}

export async function insertProduct(ctx: MutationContext, data: NewProductRow) {
  return ctx.tx.product.create({
    data: { ...data, storeId: ctx.storeId, status: "DRAFT" },
    select: productSelect,
  });
}

export type ProductPatchRow = Partial<Omit<NewProductRow, never>>;

export async function updateProductRow(ctx: MutationContext, id: string, data: ProductPatchRow): Promise<boolean> {
  const res = await ctx.tx.product.updateMany({ where: scope(ctx, id), data });
  return res.count === 1;
}

/** Conditional on the status that was read, as a second line of defence behind the store lock. */
export async function setStatusRow(
  ctx: MutationContext,
  id: string,
  from: ProductStatus,
  to: ProductStatus,
): Promise<boolean> {
  const res = await ctx.tx.product.updateMany({ where: { ...scope(ctx, id), status: from }, data: { status: to } });
  return res.count === 1;
}

export async function deleteProductRow(ctx: MutationContext, id: string): Promise<boolean> {
  const res = await ctx.tx.product.deleteMany({ where: scope(ctx, id) });
  return res.count === 1;
}

// ---- product image reference (written only here, through a MutationContext) ----

export const findProductImageInTx = (ctx: MutationContext, id: string) =>
  ctx.tx.product.findFirst({ where: scope(ctx, id), select: { id: true, imageId: true } });

export async function setProductImageRow(ctx: MutationContext, id: string, imageId: string | null): Promise<boolean> {
  const res = await ctx.tx.product.updateMany({ where: scope(ctx, id), data: { imageId } });
  return res.count === 1;
}
