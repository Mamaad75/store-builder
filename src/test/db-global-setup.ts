import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { getDbUrls } from "./db-url";

/** Recreates an isolated test database and applies all migrations. Never touches the dev database. */
export default async function setup() {
  const { admin: adminUrl, test: testUrl } = getDbUrls();
  const dbName = new URL(testUrl).pathname.slice(1);
  if (!dbName.endsWith("_test")) throw new Error(`Refusing to reset non-test database: ${dbName}`);

  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  try {
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
  } finally {
    await admin.$disconnect();
  }
  execSync("pnpm exec prisma migrate deploy", { env: { ...process.env, DATABASE_URL: testUrl }, stdio: "pipe" });
}
