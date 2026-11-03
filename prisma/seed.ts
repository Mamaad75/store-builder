import { Prisma, PrismaClient } from "@prisma/client";
import { TEMPLATE_DEFINITIONS, templateDefinitionSchema } from "../src/templates/definitions";

/** Idempotent: creates missing templates/versions, never modifies existing versions. */
export async function seedTemplates(db: PrismaClient) {
  for (const def of TEMPLATE_DEFINITIONS) {
    templateDefinitionSchema.parse({ settings: def.settings, pages: def.pages });
    const template = await db.template.upsert({
      where: { key: def.key },
      create: { key: def.key, name: def.name },
      update: {},
    });
    await db.templateVersion.upsert({
      where: { templateId_version: { templateId: template.id, version: def.version } },
      create: { templateId: template.id, version: def.version, defaultSettings: def.settings, defaultPages: def.pages as unknown as Prisma.InputJsonValue },
      update: {},
    });
  }
}

async function main() {
  const db = new PrismaClient();
  try {
    await seedTemplates(db);
    const n = await db.templateVersion.count();
    console.log(`Seeded templates. TemplateVersion rows: ${n}`);
  } finally {
    await db.$disconnect();
  }
}

if (process.argv[1]?.endsWith("seed.ts")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
