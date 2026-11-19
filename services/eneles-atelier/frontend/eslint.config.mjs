import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import texerRules from "./eslint-rules.mjs";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-empty-object-type": "off",
    },
  },
  {
    files: ["app/**/*.tsx", "components/**/*.tsx"],
    plugins: { texer: texerRules },
    // A warning while pages move onto the role tokens; an error once they have.
    rules: { "texer/token-styles": "warn" },
  },
  globalIgnores([".next/**", "out/**", "public/**", "next-env.d.ts"]),
]);
