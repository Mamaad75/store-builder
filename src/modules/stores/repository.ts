import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { MutationContext } from "./mutation";

type Client = Prisma.TransactionClient | typeof db;

/** Fields safe to hand to the UI. Never exposes other tenants' data or auth data. */
export const storeSelect = {
  id: true,
  name: true,
  status: true,
  settings: true,
  businessCategory: true,
  draftRevision: true,
  publishedAt: true,
  createdAt: true,
  updatedAt: true,
  logo: { select: { id: true, key: true, width: true, height: true } },
  templateVersion: { select: { version: true, template: { select: { key: true, name: true } } } },
} satisfies Prisma.StoreSelect;

export type StoreView = Prisma.StoreGetPayload<{ select: typeof storeSelect }>;

/**
 * Every query is bound to one owner. There is deliberately no method that accepts a bare store id
 * without the owner condition, so a forgotten check is not possible through this class.
 */
export class StoreRepository {
  constructor(
    private readonly ownerId: string,
    private readonly client: Client = db,
  ) {
    if (!ownerId) throw new Error("StoreRepository requires an ownerId");
  }

  list(): Promise<StoreView[]> {
    return this.client.store.findMany({
      where: { ownerId: this.ownerId },
      select: storeSelect,
      orderBy: { createdAt: "desc" },
    });
  }

  count(): Promise<number> {
    return this.client.store.count({ where: { ownerId: this.ownerId } });
  }

  find(storeId: string): Promise<StoreView | null> {
    return this.client.store.findFirst({ where: { id: storeId, ownerId: this.ownerId }, select: storeSelect });
  }

  /**
   * Compare-and-set of the business category (store METADATA, not draft content): one atomic statement that carries the
   * owner in its condition and does NOT touch draftRevision (the renderer never reads the category).
   * Returns "changed", "unchanged" (already the target value), "conflict" (changed by someone else) or "notfound".
   */
  async setBusinessCategory(storeId: string, expected: string, next: string): Promise<"changed" | "unchanged" | "conflict" | "notfound"> {
    // Writing the value that is already there is not a change: no UPDATE, no updatedAt bump.
    if (expected !== next) {
      const res = await this.client.store.updateMany({
        where: { id: storeId, ownerId: this.ownerId, businessCategory: expected },
        data: { businessCategory: next },
      });
      if (res.count === 1) return "changed";
    }
    const cur = await this.client.store.findFirst({ where: { id: storeId, ownerId: this.ownerId }, select: { businessCategory: true } });
    if (!cur) return "notfound";
    return cur.businessCategory === next ? "unchanged" : "conflict";
  }

  /** Optimistic update: succeeds only if the row is still owned by the user and at the expected revision. */
  async updateDraft(storeId: string, expectedRevision: number, data: { name?: string; settings: Prisma.InputJsonValue }) {
    const res = await this.client.store.updateMany({
      where: { id: storeId, ownerId: this.ownerId, draftRevision: expectedRevision },
      data: { ...data, draftRevision: { increment: 1 } },
    });
    return res.count === 1;
  }

  /** Ownership and the confirmed name are part of the DELETE condition itself (no check-then-act gap). */
  async deleteConfirmed(storeId: string, confirmedName: string) {
    const res = await this.client.store.deleteMany({
      where: { id: storeId, ownerId: this.ownerId, name: confirmedName },
    });
    return res.count === 1;
  }

  /** Everything the theme-switch report needs, owner-scoped in SQL: the current theme, the draft revision and every page. */
  themeContext(storeId: string) {
    return this.client.store.findFirst({
      where: { id: storeId, ownerId: this.ownerId },
      select: {
        draftRevision: true,
        templateVersionId: true,
        templateVersion: { select: { id: true, version: true, template: { select: { key: true, name: true } } } },
        pages: { select: { type: true, title: true, isVisible: true, sections: true }, orderBy: [{ position: "asc" }, { id: "asc" }] },
      },
    });
  }
}

/** Theme versions are global (not tenant data): the latest ACTIVE version of an active theme key, or null. */
export const findLatestActiveThemeVersion = (key: string, client: Client = db) =>
  client.templateVersion.findFirst({
    where: { isActive: true, template: { key, isActive: true } },
    orderBy: { version: "desc" },
    select: { id: true, version: true, template: { select: { key: true, name: true } } },
  });

/** Same read inside a store mutation (the context proves ownership, the store lock and the revision bump). */
export const themeContextInTx = (ctx: MutationContext) =>
  new StoreRepository(ctx.ownerId, ctx.tx).themeContext(ctx.storeId);

/**
 * THE only write of a theme switch: the draft's theme pointer. Conditional on the previous pointer (so a stale decision
 * cannot overwrite a newer one) and carrying the owner in its condition. No page, product, media or settings row is
 * touched, and nothing published (StoreVersion / publishedVersionId / status) is touched.
 */
export async function setTemplateVersionInTx(ctx: MutationContext, expectedVersionId: string, nextVersionId: string): Promise<boolean> {
  const res = await ctx.tx.store.updateMany({
    where: { id: ctx.storeId, ownerId: ctx.ownerId, templateVersionId: expectedVersionId },
    data: { templateVersionId: nextVersionId },
  });
  return res.count === 1;
}

/** Default settings of a theme version (global data): the fallback used when a store's settings are invalid. */
export async function themeVersionDefaults(versionId: string): Promise<unknown> {
  const v = await db.templateVersion.findUnique({ where: { id: versionId }, select: { defaultSettings: true } });
  return v?.defaultSettings ?? {};
}
