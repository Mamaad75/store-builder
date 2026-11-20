import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node", include: ["src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "src/**/*.db.test.ts", "src/**/*.storage.test.ts", "src/**/*.queue.test.ts"], testTimeout: 20_000 },
});
