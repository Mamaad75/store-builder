import type { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { db } from "@/lib/db";
import { pageDefinitionSchema, templateSettingsSchema } from "@/templates/sections";
import { ConflictError, NotFoundError, StoreLimitError, ValidationError } from "./errors";
import { StoreRepository, type StoreView } from "./repository";
import {
  MAX_STORES_PER_USER,
  createStoreSchema,
  storeIdSchema,
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

export async function listActiveTemplates() {
  return db.template.findMany({
    where: { isActive: true },
    select: { key: true, name: true },
    orderBy: { key: "asc" },
  });
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
  const { name, templateKey } = parseOrThrow(createStoreSchema, input);

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
    if (!version) throw new ValidationError({ templateKey: ["قالب انتخاب‌شده معتبر نیست"] });

    const settings = templateSettingsSchema.parse(version.defaultSettings);
    const pages = z.array(pageDefinitionSchema).parse(version.defaultPages);

    const store = await tx.store.create({
      data: {
        ownerId,
        templateVersionId: version.id,
        name,
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
    };
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
