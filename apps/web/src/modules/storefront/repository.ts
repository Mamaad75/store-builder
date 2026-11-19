import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { StorefrontSource } from "./build";

/**
 * Reads the live (draft) store for its owner. Ownership is part of the SQL condition, so a foreign or
 * missing store yields `null` (same as any other owner-scoped read). Only storefront-eligible
 * (ACTIVE) products are selected; excluded products contribute a count and nothing else.
 */
export class DraftStorefrontRepository {
  /** `client` is the database or a transaction (publishing reads the draft inside its locked transaction). */
  constructor(
    private readonly ownerId: string,
    private readonly client: Prisma.TransactionClient | typeof db = db,
  ) {
    if (!ownerId) throw new Error("DraftStorefrontRepository requires an ownerId");
  }

  async load(storeId: string): Promise<StorefrontSource | null> {
    const store = await this.client.store.findFirst({
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
          select: { id: true, name: true, slug: true, description: true, price: true, stockQuantity: true, categoryId: true, specs: true, image: { select: { key: true, width: true, height: true, status: true } } },
          orderBy: [{ position: "asc" }, { createdAt: "desc" }, { id: "asc" }],
        },
        _count: { select: { products: { where: { status: { not: "ACTIVE" } } } } },
      },
    });
    if (!store) return null;
    // Images referenced by section props (`imageId`): READY media of THIS store only (owner-scoped in SQL).
    const ids = new Set<string>();
    for (const page of store.pages) {
      if (!Array.isArray(page.sections)) continue;
      for (const sec of page.sections as unknown[]) {
        const id = (sec as { props?: { imageId?: unknown } } | null)?.props?.imageId;
        if (typeof id === "string" && id.length > 0 && id.length <= 64) ids.add(id);
      }
    }
    const media =
      ids.size === 0
        ? []
        : await this.client.media.findMany({
            where: { id: { in: [...ids].slice(0, 200) }, storeId, status: "READY", store: { ownerId: this.ownerId } },
            select: { id: true, key: true, width: true, height: true, status: true },
          });
    return {
      images: Object.fromEntries(media.map((m) => [m.id, { key: m.key, width: m.width, height: m.height, status: m.status }])),
      store: { name: store.name, settings: store.settings, logo: store.logo },
      template: { key: store.templateVersion.template.key, version: store.templateVersion.version, defaultSettings: store.templateVersion.defaultSettings },
      pages: store.pages,
      categories: store.categories,
      products: store.products,
      excludedProductCount: store._count.products,
    };
  }
}
