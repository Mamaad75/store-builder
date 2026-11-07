import { db } from "@/lib/db";
import type { StorefrontSource } from "./build";

/**
 * Reads the live (draft) store for its owner. Ownership is part of the SQL condition, so a foreign or
 * missing store yields `null` (same as any other owner-scoped read). Only storefront-eligible
 * (ACTIVE) products are selected; excluded products contribute a count and nothing else.
 */
export class DraftStorefrontRepository {
  constructor(private readonly ownerId: string) {
    if (!ownerId) throw new Error("DraftStorefrontRepository requires an ownerId");
  }

  async load(storeId: string): Promise<StorefrontSource | null> {
    const store = await db.store.findFirst({
      where: { id: storeId, ownerId: this.ownerId },
      select: {
        name: true,
        settings: true,
        logo: { select: { key: true, width: true, height: true, status: true } },
        templateVersion: { select: { version: true, defaultSettings: true, template: { select: { key: true } } } },
        pages: {
          where: { isVisible: true },
          select: { type: true, title: true, slug: true, position: true, sections: true },
          orderBy: [{ position: "asc" }, { id: "asc" }],
        },
        categories: {
          select: { id: true, name: true, slug: true },
          orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        },
        products: {
          where: { status: "ACTIVE" },
          select: { id: true, name: true, slug: true, description: true, price: true, stockQuantity: true, categoryId: true, image: { select: { key: true, width: true, height: true, status: true } } },
          orderBy: [{ position: "asc" }, { createdAt: "desc" }, { id: "asc" }],
        },
        _count: { select: { products: { where: { status: { not: "ACTIVE" } } } } },
      },
    });
    if (!store) return null;
    return {
      store: { name: store.name, settings: store.settings, logo: store.logo },
      template: { key: store.templateVersion.template.key, version: store.templateVersion.version, defaultSettings: store.templateVersion.defaultSettings },
      pages: store.pages,
      categories: store.categories,
      products: store.products,
      excludedProductCount: store._count.products,
    };
  }
}
