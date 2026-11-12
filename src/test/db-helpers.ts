import { PrismaClient } from "@prisma/client";
import { seedTemplates } from "../../prisma/seed";

export const prisma = new PrismaClient();

export async function resetDb() {
  await prisma.$executeRawUnsafe(
    `TRUNCATE "RateLimitBucket","SubdomainReservation","Domain","Product","ProductCategory","Media","Page","Store","StoreVersion","User","TemplateVersion","Template" RESTART IDENTITY CASCADE`,
  );
  await seedTemplates(prisma);
}

let n = 0;
export async function makeUser() {
  n += 1;
  return prisma.user.create({ data: { email: `u${n}@example.com`, name: `User ${n}`, passwordHash: "x" } });
}

export async function makeStore(ownerId: string, name = "Shop") {
  const tv = await prisma.templateVersion.findFirstOrThrow({ where: { template: { key: "general" } } });
  return prisma.store.create({ data: { ownerId, templateVersionId: tv.id, name, settings: {} } });
}

/** A schema-valid media row (key shape, type and limits are enforced by CHECK constraints). */
export async function makeMedia(storeId: string, uploadedById: string, over: { status?: "PENDING" | "READY" | "DELETING"; sizeBytes?: number; key?: string } = {}) {
  n += 1;
  const key = over.key ?? `stores/${storeId}/${n.toString(16).padStart(32, "0")}.webp`;
  return prisma.media.create({
    data: { storeId, uploadedById, key, mimeType: "image/webp", sizeBytes: over.sizeBytes ?? 10, width: 100, height: 100, status: over.status ?? "READY" },
  });
}

/** Publishes a store the way the publishing service will: version + pointer + status in one transaction. */
export async function publishStore(storeId: string) {
  return prisma.$transaction(async (tx) => {
    const v = await tx.storeVersion.create({ data: { storeId, number: 1, draftRevision: 1, snapshot: {} } });
    return tx.store.update({ where: { id: storeId }, data: { status: "PUBLISHED", publishedVersionId: v.id, publishedAt: new Date() } });
  });
}

/**
 * A store pinned to a theme version that no code registers (a "retired" theme): used to prove that unsupported themes
 * fail safely. Pages and settings are copied from the general seed.
 */
export async function makeUnregisteredThemeStore(ownerId: string, name = "Legacy shop") {
  const general = await prisma.templateVersion.findFirstOrThrow({ where: { template: { key: "general" } } });
  const template = await prisma.template.upsert({ where: { key: "legacy-demo" }, create: { key: "legacy-demo", name: "Legacy" }, update: {} });
  const tv = await prisma.templateVersion.upsert({
    where: { templateId_version: { templateId: template.id, version: 1 } },
    create: { templateId: template.id, version: 1, defaultSettings: general.defaultSettings as never, defaultPages: general.defaultPages as never },
    update: {},
  });
  const pages = general.defaultPages as { type: string; title: string; slug: string; sections: unknown }[];
  return prisma.store.create({
    data: {
      ownerId,
      templateVersionId: tv.id,
      name,
      settings: general.defaultSettings as never,
      pages: { create: pages.map((p, i) => ({ type: p.type as never, title: p.title, slug: p.slug, sections: p.sections as never, position: i })) },
    },
  });
}
