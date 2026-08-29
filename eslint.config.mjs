import js from "@eslint/js";
import tseslint from "typescript-eslint";
import { FlatCompat } from "@eslint/eslintrc";

/**
 * ESLint, configured for the first time.
 *
 * The repo had `eslint` and `eslint-config-next` installed, an `npm run lint`
 * script, and a comment in `next.config.mjs` claiming lint ran in CI — but no
 * config file anywhere. With nothing to load, the deprecated `next lint` drops
 * into its interactive setup prompt rather than linting, so the script had
 * never checked a single file and no workflow ran it.
 *
 * Flat config on ESLint 9, driven through the ESLint CLI rather than
 * `next lint`, which is deprecated in Next 15 and removed in 16. `FlatCompat`
 * is what lets the still-eslintrc-shaped `eslint-config-next` load here.
 *
 * Deliberately calibrated to report rather than block, for now. This is the
 * first time ~700 source files have been linted; the useful move is to see the
 * real backlog and burn it down deliberately, not to turn a large unknown into
 * a merge gate on day one. `npm run lint` exits non-zero only on `error`, and
 * the rules most likely to be noisy on an existing codebase are set to `warn`.
 */

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

export default tseslint.config(
  {
    // Generated, vendored or third-party. `public/artifact-runtime` is written
    // by scripts/vendor-artifact-runtime.mjs; `agent/skills` is vendored docs.
    ignores: [
      ".next/**",
      ".next-*/**",
      "out/**",
      "build/**",
      "node_modules/**",
      "public/artifact-runtime/**",
      "agent/**",
      "next-env.d.ts",
      // Runs inside the artifact sandbox against globals that do not exist here.
      "scripts/artifact-shims.js",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Next's own rules: React hooks correctness, and the framework-specific
  // checks (next/image, next/link, no sync scripts) that catch real bugs.
  ...compat.extends("next/core-web-vitals"),

  {
    rules: {
      // ---- Kept as errors: these catch defects, not style. ----
      // A hook dependency mistake is the single most common source of stale
      // state and infinite render loops in this codebase's shape.
      "react-hooks/rules-of-hooks": "error",

      // ---- Downgraded to warnings for the first pass. ----
      // Each is legitimate, and each has a backlog on an existing codebase.
      // These become errors once the count is at zero — see CONTRIBUTING.md.
      "react-hooks/exhaustive-deps": "warn",
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          // The repo already uses a leading underscore for intentionally unused
          // bindings (see `const { [id]: _drop, ...rest }` in flags-store.ts).
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-empty-object-type": "warn",
      "@typescript-eslint/no-require-imports": "warn",
      "@typescript-eslint/ban-ts-comment": "warn",
      "no-empty": ["warn", { allowEmptyCatch: true }],
    },
  },

  {
    // Tests reach for `any` and non-null assertions to build fixtures quickly;
    // that is appropriate there and not worth flagging.
    files: ["**/*.test.ts", "**/*.test.tsx", "**/__fixtures__/**"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },

  {
    // Node scripts, not browser code.
    files: ["scripts/**/*.mjs", ".github/scripts/**/*.mjs", "*.config.mjs"],
    rules: {
      "@typescript-eslint/no-var-requires": "off",
    },
  },
);
