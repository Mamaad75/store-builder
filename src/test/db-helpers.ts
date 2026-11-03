import { PrismaClient } from "@prisma/client";
import { seedTemplates } from "../../prisma/seed";

export const prisma = new PrismaClient();

export async function resetDb() {
  await prisma.$executeRawUnsafe(
    `TRUNCATE "RateLimitBucket","Domain","Product","ProductCategory","Media","Page","Store","StoreVersion","User","TemplateVersion","Template" RESTART IDENTITY CASCADE`,
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

export async function makeMedia(storeId: string, uploadedById: string) {
  n += 1;
  return prisma.media.create({ data: { storeId, uploadedById, key: `k${n}`, mimeType: "image/png", sizeBytes: 10 } });
}

/** Publishes a store the way the publishing service will: version + pointer + status in one transaction. */
export async function publishStore(storeId: string) {
  return prisma.$transaction(async (tx) => {
    const v = await tx.storeVersion.create({ data: { storeId, number: 1, draftRevision: 1, snapshot: {} } });
    return tx.store.update({ where: { id: storeId }, data: { status: "PUBLISHED", publishedVersionId: v.id, publishedAt: new Date() } });
  });
}
