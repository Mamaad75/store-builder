import { defineConfig } from "vitest/config";
import { getDbUrls } from "./src/test/db-url.js";
import { getTestStorageEnv } from "./src/test/storage-env.js";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.storage.test.ts"],
    globalSetup: ["src/test/storage-global-setup.ts"],
    env: { DATABASE_URL: getDbUrls().test, ...getTestStorageEnv("test") },
    fileParallelism: false,
    testTimeout: 30000,
  },
});
