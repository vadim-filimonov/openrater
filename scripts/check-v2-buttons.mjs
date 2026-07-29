#!/usr/bin/env node
/**
 * v2 button-primitive guard — drift prevention.
 *
 * The rebuilt v2 surfaces use the design-system <Button> / <IconButton>
 * primitives for every STANDARD button, so sizing, color, hover/focus
 * states, and the one-primary-per-surface rule hold by construction.
 *
 * A raw <button> is therefore a bespoke control. A few are legitimate —
 * specialized inline affordances that aren't standard buttons (section
 * tabs, the per-row premium chips, the hover-reveal table delete, the ⌘K
 * search trigger). But a NEW raw <button> almost always means someone
 * hand-rolled a button that should be a primitive. That is exactly the
 * drift that produced the inconsistent Auto-recognize / Ungroup / Score-
 * all buttons this guard exists to stop from recurring.
 *
 * For each scanned v2 file this counts raw <button> and fails if the
 * count exceeds the file's allowlist. To add a standard button, use
 * <Button> / <IconButton>. To add a genuine inline control, bump the
 * allowlist below with a one-line reason.
 */

import { readFileSync, existsSync } from "node:fs";

// file → { max, reason }. `max` is the number of INTENTIONAL bespoke
// <button> inline controls the file is allowed to keep. Anything above
// it is treated as drift.
const ALLOWLIST = {
  "packages/ui/src/PlanGenesis/PlanGenesis.tsx": {
    max: 2,
    reason:
      "the two genesis door cards (whole-card selectors, the /new template-radio idiom — Brief 89 R3; the duplicate link is a <Button variant=plain>)",
  },
  "packages/ui/src/DimensionEditor/LevelRowsTable.tsx": {
    max: 1,
    reason: "per-row hover-reveal remove (inline grid control, Brief 66)",
  },
  "packages/ui/src/DimensionEditor/UsedInPanel.tsx": {
    max: 1,
    reason: "the clickable reference row itself (a list row, Brief 66)",
  },
  "packages/ui/src/AnalyticsWorkspace/PlanReport.tsx": {
    max: 2,
    reason:
      "the boundary line's two inline-in-prose text links (Book / connect-in-Inputs — Brief 93 §1.1.8, the AppetiteStatement nudge-link idiom); every standard action is a <Button>",
  },
  "packages/ui/src/AppetiteStatement/AppetiteStatement.tsx": {
    max: 3,
    reason:
      "the default-tier seat (a chip button) · its picker option rows · the mis-scope nudge text-link (Brief 70 §3)",
  },
  "packages/ui/src/StatementComposer/StatementComposer.tsx": {
    max: 3,
    reason:
      "the composer's slot seat + option row + the value seat's no-match 'Use …' escape row (the mad-libs grammar's own inline controls, Brief 70 P1 / Brief 89.3 follow-up)",
  },
  "packages/ui/src/dimensionMeta.tsx": {
    max: 1,
    reason:
      "the DimToken pick-list row (a row selector with the keyboard twin, Brief 70 P1)",
  },
  "packages/ui/src/ParametrizeCanvas/ParametrizeCanvas.tsx": {
    max: 3,
    reason:
      "the RATES-BY axis chip (an inline chip control) · the creation CSV drop-zone (a drop target) · the axis popover's pinned coverage-split row (Brief 70 §1)",
  },
  "packages/ui/src/BuildUpSheet/BuildUpSheet.tsx": {
    max: 12,
    reason:
      "the sheet's own inline grammar (Brief 70 §2): dashed inline-value scalar · sample chip · exposure pill · add-step row · picker rows · 4 outline rail rows · the define-a-dimension text link · the 2 picker CREATE rows (Brief 89 R5, same pick-row idiom) — every standard button is a <Button>/<IconButton>",
  },
  "packages/ui/src/FactorTableNode/FactorTableNode.tsx": {
    max: 1,
    reason:
      "the '+ Coverage split' two-line axis-slot affordance (an inline drop-slot control, Brief 67 — every standard button here is a <Button>/<IconButton>)",
  },
  "packages/ui/src/FactorTablesTable/FactorTablesTable.tsx": {
    max: 1,
    reason:
      "the clickable table-name row opener (a row selector, Brief 67 — every standard button here is an <IconButton>)",
  },
  "packages/ui/src/inputs-v2/InputsPanelV2.tsx": {
    max: 4,
    reason:
      "mismatch flag · per-row premium chip · per-policy row (inline expand/signal controls) · act-1 collapsed summary bar (whole-bar expand affordance, Brief 65)",
  },
  "packages/ui/src/inputs-v2/DictionaryTable.tsx": {
    max: 5,
    reason:
      "inline name-edit · type chip · 2-state hover-reveal delete · draft-row cancel",
  },
  "packages/ui/src/inputs-v2/WebhookSource.tsx": {
    max: 2,
    reason:
      "borderless inline text-links: \"Use a CSV instead\" mode-switch · \"Advanced\" reveal toggle (every standard button here is a <Button>/<IconButton>)",
  },
  "packages/ui/src/DimensionsWorkspace/DimensionsWorkspaceV2.tsx": {
    max: 1,
    reason:
      "the clickable dimension-list row (a row selector, not a standard button — keyboard/a11y). The back-crumb migrated to <Button variant=plain> in Wave 1.",
  },
  "packages/ui/src/PlanShell/PlanStatusChip.tsx": {
    max: 1,
    reason:
      "the Brief-84 status chip's clickable variant (a chip that navigates to Ship, not a standard button; replaced PlanLifecycleStepper)",
  },
  "frontend/src/components/AppNavV2/AppNavV2.tsx": {
    max: 2,
    reason:
      "the ⌘K command-palette search trigger (a search affordance) + the sub-900px 'More' overflow trigger (a nav item wrapping Menu.Trigger, styled as .rater-nav2__item — Brief 88 §3.1 F10)",
  },
  "frontend/src/routes/ExhibitsRoute.tsx": {
    max: 9,
    reason:
      "the exhibit's own grammar (Brief: portfolio-redesign v2 §5.1/§5.4 + P4–P7): the plan/compare/book pills, the swap, the B/book clears, the rail item, the rail's What-changed opener (P7), and the footer's download-all text action — standard actions (Download CSV) are <Button>",
  },
  "frontend/src/routes/exhibits/Overview.tsx": {
    max: 1,
    reason:
      "the comparison ledger's row (P7) — a whole-row door onto the stage (the KpisDrawer row-selector idiom); it is a table row typographically, so <Button> chrome would misread",
  },
  "frontend/src/routes/PlanNewRoute.tsx": {
    max: 2,
    reason:
      "the copy-a-plan picker row (a whole-row selector, the KpisDrawer idiom — Brief 91 §1.2) + the workbook door card (whole-card selector, the PlanGenesis idiom — Brief 92's door promoted 2026-07-15); every standard action is a <Button> (note toggle / copy door / back are variant=plain)",
  },
};

const RAW_BUTTON = /<button[\s/>]/g;

let failed = false;
const results = [];

for (const [file, { max, reason }] of Object.entries(ALLOWLIST)) {
  if (!existsSync(file)) {
    console.error(`\x1b[31m✗ v2-buttons-check: allowlisted file is missing: ${file}\x1b[0m`);
    console.error(`  Update scripts/check-v2-buttons.mjs if it moved or was deleted.`);
    failed = true;
    continue;
  }
  const src = readFileSync(file, "utf8");
  const count = (src.match(RAW_BUTTON) || []).length;
  results.push({ file, count, max, reason });
  if (count > max) failed = true;
}

if (failed) {
  console.error(
    "\x1b[31m✗ v2-buttons-check: a v2 surface gained a bespoke <button>.\x1b[0m",
  );
  for (const { file, count, max, reason } of results) {
    if (count > max) {
      console.error(`  ${file}: ${count} raw <button> (allowed ${max}).`);
      console.error(
        "    → For a standard button use <Button>/<IconButton> from @openrater/design-system.",
      );
      console.error(
        `    → If it is a genuine inline control, bump the allowlist (current: ${reason}).`,
      );
    }
  }
  process.exit(1);
}

const total = results.reduce((n, r) => n + r.count, 0);
console.log(
  `\x1b[32m✓ v2-buttons-check: ${results.length} v2 surfaces · ${total} allowlisted inline <button> controls — no bespoke button drift.\x1b[0m`,
);
