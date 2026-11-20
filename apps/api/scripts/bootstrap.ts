import { createPrismaClient } from "../src/database/prisma-client.js";
import { configureRateLimiter } from "../src/lib/rate-limit.js";
import { useDb } from "../src/lib/db.js";
import { configureStorage } from "../src/lib/storage/index.js";
import { getStorageConfig } from "../src/lib/storage/config.js";

/**
 * What every job script needs before it touches the domain modules: the database handle and, for jobs that use it, object storage.
 * Jobs are separate processes (not the Nest app), so they read their own environment here, once.
 */
export function bootstrapJob(opts: { storage?: boolean } = {}): void {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  useDb(createPrismaClient(url));
  configureRateLimiter(process.env.RATE_LIMIT_BACKEND === "memory" ? "memory" : "postgres");
  if (opts.storage) configureStorage(getStorageConfig(process.env));
}
