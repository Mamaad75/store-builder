import { execSync } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { E2E_MAIL_DIR } from "../playwright.config";
import { ensureTestBucket, getTestStorageEnv } from "../src/storage-env";

/** Drops, recreates, migrates and seeds one E2E database. Refuses any database whose name does not end in "_e2e". */
export async function resetDatabase(url: string): Promise<void> {
  const u = new URL(url);
  const dbName = u.pathname.slice(1);
  if (!dbName.endsWith("_e2e")) throw new Error(`Refusing to reset non-e2e database: ${dbName}`);
  u.pathname = "/postgres";
  const admin = new PrismaClient({ datasources: { db: { url: u.toString() } } });
  try {
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
  } finally {
    await admin.$disconnect();
  }
  const env = { ...process.env, DATABASE_URL: url };
  const api = path.join(import.meta.dirname, "..", "..", "api"); // the schema, migrations and seed belong to the API
  execSync("pnpm exec prisma migrate deploy", { env, cwd: api, stdio: "pipe" });
  execSync("pnpm exec prisma db seed", { env, cwd: api, stdio: "pipe" }); // the three templates
}

export default async function globalSetup() {
  await resetDatabase(process.env.E2E_DATABASE_URL ?? "postgresql://storebuilder:storebuilder@localhost:5432/storebuilder_e2e");
  await rm(E2E_MAIL_DIR, { recursive: true, force: true });
  await ensureTestBucket(getTestStorageEnv("e2e")); // isolated bucket, public read-only
}
