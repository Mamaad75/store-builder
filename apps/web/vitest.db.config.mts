import { defineConfig } from "vitest/config";
import path from "node:path";

import { getDbUrls } from "./src/test/db-url.ts";

const urls = getDbUrls();

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    environment: "node",
    include: ["src/**/*.db.test.{ts,tsx}"],
    globalSetup: ["src/test/db-global-setup.ts"],
    env: {
      DATABASE_URL: urls.test,
      AUTH_SECRET: "test-only-secret-test-only-secret-0123456789",
      AUTH_TRUST_HOST: "true",
    },
    // next-auth imports "next/server" without an extension; let Vite resolve it.
    server: { deps: { inline: ["next-auth"] } },
    fileParallelism: false,
    testTimeout: 20000,
  },
});
