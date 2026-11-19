import { defineConfig } from "vitest/config";
import { getDbUrls } from "./src/test/db-url.js";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.db.test.ts"],
    globalSetup: ["src/test/db-global-setup.ts"],
    env: { DATABASE_URL: getDbUrls().test, AUTH_SECRET: "test-only-secret-test-only-secret-0123456789" },
    fileParallelism: false,
    testTimeout: 30000,
  },
});
