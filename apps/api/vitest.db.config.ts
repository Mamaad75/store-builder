import { defineConfig } from "vitest/config";
import { getDbUrls } from "./src/__tests__/test-db.js";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.db.test.ts"],
    globalSetup: ["src/__tests__/db-global-setup.ts"],
    env: { DATABASE_URL: getDbUrls().test },
    fileParallelism: false,
    testTimeout: 30000,
  },
});
