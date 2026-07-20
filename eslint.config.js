// @ts-check
//
// OpenRater — ESLint flat config.
//
// The configuration covers TypeScript correctness, React hooks, console use,
// and JSX accessibility. Type-aware checks stay in the separate TypeScript
// build so this lint pass remains fast and deterministic.
//
// Layer rule (pnpm-workspace.yaml): apps depend on packages; packages depend
// downward only. Package manifests and TypeScript project references enforce
// that boundary; ESLint focuses on source-level rules.

import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y";
import globals from "globals";

// Apply the recommended JSX accessibility rules as warnings. Options such as
// `controlComponents` are preserved, and rules disabled by the preset stay off.
const jsxA11yWarn = Object.fromEntries(
  Object.entries(jsxA11y.flatConfigs.recommended.rules).map(([rule, level]) => {
    if (level === "off" || level === 0) return [rule, level];
    if (Array.isArray(level)) return [rule, ["warn", ...level.slice(1)]];
    return [rule, "warn"];
  }),
);

export default tseslint.config(
  // ── Global ignores ──────────────────────────────────────────────────────
  // Build output, vendored/generated, and everything git already ignores.
  {
    ignores: [
      "**/dist/**",
      "**/build/**",
      "**/.vite/**",
      "**/coverage/**",
      "**/node_modules/**",
      "**/*.d.ts",
    ],
  },

  // ── TypeScript sources ──────────────────────────────────────────────────
  // packages/*, frontend, services/*. Browser + node globals both on
  // (frontend touches window/localStorage; services/scoring touches process/
  // Buffer) — harmless since typescript-eslint turns core `no-undef` off and
  // lets the compiler own undefined-symbol detection.
  {
    files: ["**/*.{ts,tsx,mts,cts}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      // Error logging is always legitimate; warn/log/info must be deliberate.
      // A deliberate diagnostic opts in with an `eslint-disable-next-line
      // no-console` — this is the mechanism the projector's fallback warnings
      // already use (packages/ui/src/InputsWorkspace/stagesToRuntimePlan.ts).
      "no-console": ["warn", { allow: ["error"] }],

      // Align the lint rule with the compiler: tsconfig.base.json already runs
      // noUnusedLocals + noUnusedParameters, and tsc exempts `_`-prefixed
      // params/vars by convention. Mirror that so the two tools never disagree.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],

      // The codebase uses U+200B (zero-width space) inside JSDoc to escape a
      // literal `*/` in block comments (e.g. FactorEditor's type-union docs,
      // chainTraceValues' scope note) — deliberate and load-bearing: removing
      // it closes the comment early. Keep the rule's real value (stray
      // whitespace in CODE) and stop policing comments.
      "no-irregular-whitespace": ["error", { skipComments: true }],
    },
  },

  // ── React hooks (components AND custom hooks) ───────────────────────────
  // Scoped to .ts *and* .tsx: custom hooks live in plain .ts files too
  // (frontend/src/integrations/useComposedPolicy.ts, …), and they use
  // hooks + carry react-hooks disable directives. rules-of-hooks is a hard
  // error (a violation is a real bug); exhaustive-deps stays a warning — the
  // React team's own guidance, and the codebase has 33 reviewed opt-outs.
  {
    files: ["**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },

  // ── Accessibility (JSX only) ────────────────────────────────────────────
  // Keeps the 4 no-autofocus opt-outs meaningful and backs commitment #2
  // (Apple-grade UX). Advisory for now — see jsxA11yWarn above.
  {
    files: ["**/*.tsx"],
    plugins: { "jsx-a11y": jsxA11y },
    rules: { ...jsxA11yWarn },
  },

  // ── Build tooling + design checkers ─────────────────────────────────────
  // scripts/*.mjs (the four design checkers) and *.config.* files run in Node
  // and legitimately print to stdout. Lint them for real bugs, but let them log.
  {
    files: ["scripts/**/*.{js,mjs,cjs}", "**/*.config.{js,mjs,cjs,ts,mts}"],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: {
      "no-console": "off",
      // Checker scripts carry the same JSDoc `*/`-escape trick in their header
      // comments — see the note on the sources block.
      "no-irregular-whitespace": ["error", { skipComments: true }],
    },
  },
);
