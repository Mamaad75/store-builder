import { defineConfig } from "vitest/config";
import path from "node:path";

import { getDbUrls } from "./src/test/db-url.ts";
import { getTestStorageEnv } from "./src/test/storage-env.ts";

const urls = getDbUrls();

/** Integration tests that need a real S3-compatible server (MinIO in CI) next to the database. */
export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    environment: "node",
    include: ["src/**/*.storage.test.{ts,tsx}"],
    globalSetup: ["src/test/storage-global-setup.ts"],
    env: {
      DATABASE_URL: urls.test,
      AUTH_SECRET: "test-only-secret-test-only-secret-0123456789",
      AUTH_TRUST_HOST: "true",
      ...getTestStorageEnv("test"),
    },
    server: { deps: { inline: ["next-auth"] } },
    fileParallelism: false,
    testTimeout: 30000,
  },
});
