import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { rules: { "no-console": "error" } },
  // Command-line job scripts talk to the terminal.
  { files: ["scripts/**/*.ts", "prisma/**/*.ts"], rules: { "no-console": "off" } },
  // Test helpers and the domain tests may be noisy and use non-null assertions on fixtures.
  { files: ["**/*.test.ts", "src/test/**/*.ts", "src/__tests__/**/*.ts"], rules: { "no-console": "off", "@typescript-eslint/no-explicit-any": "off" } },
);
