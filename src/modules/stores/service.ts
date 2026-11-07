import type { Prisma } from "@prisma/client";
import { isDeepStrictEqual } from "node:util";
import { ZodError } from "zod";
import { db } from "@/lib/db";
import { getBusinessCategory, inferCategoryFromThemeKey } from "@/lib/business-categories";
import { pageDefinitionSchema } from "@/templates/section-parse";
import { allThemes, resolveThemeDefinition } from "@/templates/theme-catalog";
import { applyStarterCopy } from "./starter-content";
import { templateSettingsSchema } from "@/templates/sections";
import { ConflictError, NotFoundError, StoreLimitError, ValidationError } from "./errors";
import { StoreRepository, type StoreView } from "./repository";
import {
  MAX_STORES_PER_USER,
  createStoreSchema,
  storeIdSchema,
  updateBusinessCategorySchema,
  updateStoreSchema,
} from "./schemas";
import { z } from "zod";

/**
 * Every function takes `ownerId` as its first argument. It must come from the server-side session
 * (requireUser()), never from request data.
 */

function toValidationError(e: ZodError): ValidationError {
  return new ValidationError(e.flatten().fieldErrors as Record<string, string[]>);
}

function parseOrThrow<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const r = schema.safeParse(input);
  if (!r.success) throw toValidationError(r.error);
  return r.data;
}

export function parseStoreId(storeId: unknown): string {
  const r = storeIdSchema.safeParse(storeId);
  if (!r.success) throw new NotFoundError();
  return r.data;
}

/**
 * Themes a new store can be created with: active in the database AND registered in code, in catalog order. The display
 * name/description come from the theme's own metadata (a visual direction), not from the seed's `Template.name`.
 */
export async function listActiveTemplates(): Promise<{ key: string; name: string; description: string }[]> {
  const rows = await db.template.findMany({ where: { isActive: true, versions: { some: { isActive: true } } }, select: { key: true, versions: { where: { isActive: true }, select: { version: true } } } });
  const out: { key: string; name: string; description: string }[] = [];
  for (const t of allThemes()) {
    const row = rows.find((r) => r.key === t.key);
    if (row && row.versions.some((v) => v.version === t.version)) out.push({ key: t.key, name: t.meta.name, description: t.meta.description });
  }
  return out;
}

export async function listStores(ownerId: string): Promise<StoreView[]> {
  return new StoreRepository(ownerId).list();
}

export async function getStore(ownerId: string, storeId: unknown): Promise<StoreView> {
  const store = await new StoreRepository(ownerId).find(parseStoreId(storeId));
  if (!store) throw new NotFoundError();
  return store;
}

export async function createStore(ownerId: string, input: unknown): Promise<{ id: string }> {
  const { name, templateKey, businessCategory } = parseOrThrow(createStoreSchema, input);
  // What the merchant sells (a label + starter text) is chosen independently of the visual theme.
  const category = getBusinessCategory(businessCategory ?? inferCategoryFromThemeKey(templateKey));
  if (!category) throw new ValidationError({ businessCategory: ["دسته‌بندی انتخاب‌شده معتبر نیست"] });

  return db.$transaction(async (tx) => {
    // Serialise concurrent creates for this user so the limit cannot be exceeded by a race.
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${ownerId} FOR UPDATE`;
    const repo = new StoreRepository(ownerId, tx);
    if ((await repo.count()) >= MAX_STORES_PER_USER) throw new StoreLimitError(MAX_STORES_PER_USER);

    // Template and version are chosen on the server; clients never supply a version id.
    const version = await tx.templateVersion.findFirst({
      where: { isActive: true, template: { key: templateKey, isActive: true } },
      orderBy: { version: "desc" },
    });
    // A theme must also exist in code (definition + renderer); a store is never created on a theme that cannot be shown.
    if (!version || !resolveThemeDefinition(templateKey, version.version)) throw new ValidationError({ templateKey: ["قالب انتخاب‌شده معتبر نیست"] });

    const settings = templateSettingsSchema.parse(version.defaultSettings);
    // Category starter text is applied here, once. It is never re-applied when the category is changed later.
    const pages = applyStarterCopy(z.array(pageDefinitionSchema).parse(version.defaultPages), category.starter);

    const store = await tx.store.create({
      data: {
        ownerId,
        templateVersionId: version.id,
        name,
        businessCategory: category.key,
        settings,
        pages: {
          create: pages.map((p, i) => ({
            type: p.type,
            title: p.title,
            slug: p.slug,
            sections: p.sections as unknown as Prisma.InputJsonValue,
            position: i,
          })),
        },
      },
      select: { id: true },
    });
    return store;
  });
}

const stripUndefined = <T extends object>(o: T | undefined) => Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => v !== undefined));

export async function updateStore(ownerId: string, storeId: unknown, input: unknown): Promise<StoreView> {
  const id = parseStoreId(storeId);
  const patch = parseOrThrow(updateStoreSchema, input);
  const repo = new StoreRepository(ownerId);

  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await repo.find(id);
    if (!current) throw new NotFoundError();
    const settings = templateSettingsSchema.parse(current.settings);
    const next = {
      ...settings,
      ...(patch.primaryColor !== undefined && { primaryColor: patch.primaryColor }),
      contact: { ...settings.contact, ...patch.contact },
      social: { ...settings.social, ...patch.social },
      typography: { ...settings.typography, ...stripUndefined(patch.typography) },
    };
    // A save that changes nothing writes nothing and does not bump the draft revision.
    if ((patch.name === undefined || patch.name === current.name) && isDeepStrictEqual(next, settings)) return current;
    const ok = await repo.updateDraft(id, current.draftRevision, {
      ...(patch.name !== undefined && { name: patch.name }),
      settings: next,
    });
    if (ok) {
      const updated = await repo.find(id);
      if (updated) return updated;
      throw new NotFoundError();
    }
  }
  throw new ConflictError();
}

/**
 * Changes the business category label. This is metadata: it does not modify pages, sections, products, categories,
 * settings, colors or typography, and it does not bump `draftRevision` (nothing the renderer shows changes). Ownership
 * is part of the atomic UPDATE; a concurrent change by another tab is an explicit ConflictError.
 */
export async function updateBusinessCategory(ownerId: string, storeId: unknown, input: unknown): Promise<{ businessCategory: string; changed: boolean }> {
  const id = parseStoreId(storeId);
  const { businessCategory, expected } = parseOrThrow(updateBusinessCategorySchema, input);
  if (!getBusinessCategory(businessCategory)) throw new ValidationError({ businessCategory: ["دسته‌بندی انتخاب‌شده معتبر نیست"] });
  const result = await new StoreRepository(ownerId).setBusinessCategory(id, expected, businessCategory);
  if (result === "notfound") throw new NotFoundError();
  if (result === "conflict") throw new ConflictError();
  return { businessCategory, changed: result === "changed" };
}

export async function deleteStore(ownerId: string, storeId: unknown, confirmName: unknown): Promise<void> {
  const id = parseStoreId(storeId);
  const repo = new StoreRepository(ownerId);
  const store = await repo.find(id);
  if (!store) throw new NotFoundError();

  const typed = typeof confirmName === "string" ? confirmName.trim() : "";
  if (typed !== store.name) {
    throw new ValidationError({ confirmName: ["نام واردشده با نام فروشگاه مطابقت ندارد"] });
  }
  if (!(await repo.deleteConfirmed(id, store.name))) throw new NotFoundError();
}
