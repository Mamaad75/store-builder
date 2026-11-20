import { defineConfig } from "vitest/config";
import { getDbUrls } from "./src/test/db-url.js";

/**
 * Queue integration tests (phase 2.2): the outbox relay and the consumers against a REAL Valkey and PostgreSQL.
 * Local: `docker compose up -d postgres valkey`, then `pnpm test:queue` (REDIS_URL defaults to redis://localhost:6379).
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.queue.test.ts"],
    globalSetup: ["src/test/db-global-setup.ts"],
    env: { DATABASE_URL: getDbUrls().test, AUTH_SECRET: "test-only-secret-test-only-secret-0123456789", REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379" },
    fileParallelism: false,
    testTimeout: 30000,
  },
});
