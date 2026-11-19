import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { MutationContext } from "@/modules/stores/mutation";
import type { PageType } from "@/templates/sections";

export const pageSelect = {
  id: true,
  type: true,
  title: true,
  slug: true,
  isVisible: true,
  position: true,
  revision: true,
  sections: true,
  legacySections: true,
} satisfies Prisma.PageSelect;

export type PageRow = Prisma.PageGetPayload<{ select: typeof pageSelect }>;

/** Reads are bound to the owner through the store relation, in SQL. */
export class PageRepository {
  constructor(private readonly ownerId: string) {
    if (!ownerId) throw new Error("PageRepository requires an ownerId");
  }

  list(storeId: string): Promise<PageRow[]> {
    return db.page.findMany({ where: { storeId, store: { ownerId: this.ownerId } }, select: pageSelect, orderBy: [{ position: "asc" }, { id: "asc" }] });
  }

  find(storeId: string, type: PageType): Promise<PageRow | null> {
    return db.page.findFirst({ where: { storeId, type, store: { ownerId: this.ownerId } }, select: pageSelect });
  }

  /** READY media of the store by id (owner-scoped), for displaying section images in the editor. */
  async readyMedia(storeId: string, ids: string[]) {
    if (ids.length === 0) return [];
    return db.media.findMany({
      where: { id: { in: ids.slice(0, 200) }, storeId, status: "READY", store: { ownerId: this.ownerId } },
      select: { id: true, key: true, width: true, height: true },
    });
  }

  /** The store's template version, needed to pick the editor spec. */
  templateOf(storeId: string) {
    return db.store.findFirst({
      where: { id: storeId, ownerId: this.ownerId },
      select: { templateVersion: { select: { version: true, template: { select: { key: true } } } } },
    });
  }
}

// ---- writes: require a MutationContext (ownership verified + store locked + revision bumped) ----

const scope = (ctx: MutationContext, type: PageType) => ({ storeId: ctx.storeId, type, store: { ownerId: ctx.ownerId } });

export const findPageInTx = (ctx: MutationContext, type: PageType): Promise<PageRow | null> =>
  ctx.tx.page.findFirst({ where: scope(ctx, type), select: pageSelect });

export const templateOfInTx = (ctx: MutationContext) =>
  ctx.tx.store.findFirst({
    where: { id: ctx.storeId, ownerId: ctx.ownerId },
    select: { templateVersion: { select: { version: true, template: { select: { key: true } } } } },
  });

/** Conditional on the revision the caller verified; bumps the page revision. */
export async function writePage(
  ctx: MutationContext,
  page: Pick<PageRow, "id" | "revision">,
  data: { sections?: Prisma.InputJsonValue; isVisible?: boolean; legacySections?: Prisma.InputJsonValue },
): Promise<boolean> {
  const res = await ctx.tx.page.updateMany({
    where: { id: page.id, storeId: ctx.storeId, revision: page.revision, store: { ownerId: ctx.ownerId } },
    data: { ...data, revision: { increment: 1 } },
  });
  return res.count === 1;
}
