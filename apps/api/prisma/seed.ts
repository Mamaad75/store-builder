import { Prisma, PrismaClient } from "@prisma/client";
import { TEMPLATE_DEFINITIONS, templateDefinitionSchema } from "@store-builder/shared/templates/definitions";

/** Idempotent: creates missing templates/versions, never modifies existing versions. */
export async function seedTemplates(db: PrismaClient) {
  for (const def of TEMPLATE_DEFINITIONS) {
    templateDefinitionSchema.parse({ settings: def.settings, pages: def.pages });
  }

  const templates = [...new Map(TEMPLATE_DEFINITIONS.map(({ key, name }) => [key, { key, name }])).values()];
  await db.$transaction(async (tx) => {
    await tx.template.createMany({ data: templates, skipDuplicates: true });
    const rows = await tx.template.findMany({
      where: { key: { in: templates.map(({ key }) => key) } },
      select: { id: true, key: true },
    });
    const ids = new Map(rows.map(({ key, id }) => [key, id]));
    await tx.templateVersion.createMany({
      data: TEMPLATE_DEFINITIONS.map((def) => ({
        templateId: ids.get(def.key)!,
        version: def.version,
        defaultSettings: def.settings,
        defaultPages: def.pages as unknown as Prisma.InputJsonValue,
      })),
      skipDuplicates: true,
    });
  });
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
