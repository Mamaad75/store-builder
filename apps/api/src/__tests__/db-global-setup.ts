import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { getDbUrls } from "./test-db.js";

/** Recreates an isolated test database and applies every migration of the web app's schema. Never touches the dev database. */
export default async function setup() {
  const { admin: adminUrl, test: testUrl } = getDbUrls();
  const dbName = new URL(testUrl).pathname.slice(1);
  if (!dbName.endsWith("_test")) throw new Error(`Refusing to reset non-test database: ${dbName}`);
  const { PrismaClient } = createRequire(import.meta.url)("@prisma/client") as typeof import("@prisma/client");
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  try {
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
  } finally {
    await admin.$disconnect();
  }
  // The schema and migrations live in apps/web/prisma (one schema, ADR 0001); the Prisma CLI is a dependency of the web app.
  execSync("pnpm --filter @store-builder/web exec prisma migrate deploy", { env: { ...process.env, DATABASE_URL: testUrl }, stdio: "pipe" });
}
