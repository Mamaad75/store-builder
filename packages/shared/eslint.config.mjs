import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { rules: { "no-console": "error", "no-control-regex": "off", "no-irregular-whitespace": "off" } },  // text sanitisers deliberately match control and irregular whitespace characters
);