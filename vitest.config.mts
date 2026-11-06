import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["**/node_modules/**", "src/**/*.db.test.{ts,tsx}"],
  },
});
