import { defineConfig } from "vitest/config";
import path from "node:path";

import { getDbUrls } from "./src/test/db-url.ts";

const urls = getDbUrls();

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    environment: "node",
    include: ["src/**/*.db.test.ts"],
    globalSetup: ["src/test/db-global-setup.ts"],
    env: { DATABASE_URL: urls.test },
    fileParallelism: false,
    testTimeout: 20000,
  },
});
