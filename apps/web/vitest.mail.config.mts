import { defineConfig } from "vitest/config";
import path from "node:path";

/** Real SMTP tests against throw-away Mailpit servers (scripts/ci-start-mailpit.sh). */
export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    environment: "node",
    include: ["src/**/*.mail.test.{ts,tsx}"],
    fileParallelism: false,
    testTimeout: 30000,
  },
});
