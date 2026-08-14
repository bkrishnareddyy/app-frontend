import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    ".claude/**",
    // Obsolete one-off codemods and throwaway investigation scripts. These are
    // not application code and are not maintained; they are out of lint scope.
    "fix_decimal*.js",
    "fix_engine.js",
    "scratch/**",
    // One-off manual Playwright debug scripts against a demo deployment,
    // hardcoded to another machine's filesystem path. Not part of the vitest
    // suite and not maintained.
    "tests/test_chat*.js",
  ]),
  {
    rules: {
      // Destructuring a field out to keep it off a response body is a deliberate
      // omission, not dead code. Everything else stays reported.
      "@typescript-eslint/no-unused-vars": ["warn", { ignoreRestSiblings: true }],
    },
  },
]);

export default eslintConfig;
