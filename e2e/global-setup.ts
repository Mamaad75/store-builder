import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

export default async function globalSetup() {
  const url = process.env.E2E_DATABASE_URL ?? "postgresql://storebuilder:storebuilder@localhost:5432/storebuilder_e2e";
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
  execSync("pnpm exec prisma migrate deploy", { env, stdio: "pipe" });
  execSync("pnpm exec prisma db seed", { env, stdio: "pipe" }); // the three templates
}
