// @ts-check
//
// OpenRater — ESLint flat config (Rate Lab v4 P2 / G20 remainder).
//
// G20 wired the four design checkers (tokens / raw-palette / v2-buttons /
// color-domains) into CI but deliberately left ESLint un-wired — the handoff
// (§7) said "run it first, turn red into follow-ups" rather than blind-wiring
// a red gate. This is that follow-up: the preset the codebase already assumes.
//
// The preset is reverse-engineered from the 75 `eslint-disable` comments the
// original-prototype port carried in with it — they pin the original rule set exactly:
//   @typescript-eslint/*      (21 sites)  → typescript-eslint recommended
//   react-hooks/*             (33 sites)  → eslint-plugin-react-hooks
//   no-console                (16 sites)  → core no-console
//   jsx-a11y/no-autofocus     ( 4 sites)  → eslint-plugin-jsx-a11y
//   no-await-in-loop, ...     ( 1 site )  → core
//
// Non-type-checked on this first landing (fast CI, low noise). The typed tier
// (no-floating-promises, no-misused-promises, no-unsafe-*) is a documented
// follow-up — it needs a project-service pass across 1058 files and would bury
// the signal on the first run.
//
// Layer rule (pnpm-workspace.yaml): apps depend on packages; packages depend
// downward only. Not yet enforced here — a boundaries follow-up, tracked with
// the typed tier.

import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y";
import globals from "globals";

// jsx-a11y recommended, every rule pinned to `warn`. The 92 accessibility
// findings across the component library are real debt, but remediating them is
// design work (per user-pref #2 a11y touches the surfaces and wants a brief;
// commitment #2 is the bar). Per the G20 handoff (§7) the first landing SURFACES
// the red as a tracked follow-up rather than blind-wiring 92 hard failures or
// papering them over with 92 inline disables. Follow-up: a11y-remediation brief,
// after which these graduate rule-by-rule back to `error`. Options (e.g.
// controlComponents) are preserved; `off` rules stay off.
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
