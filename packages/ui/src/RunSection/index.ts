export { RunSection } from "./RunSection";
export type {
  RunSectionProps,
  RunField,
  RunOutput,
  RunView,
} from "./RunSection";
export {
  deriveRunView,
  formatRunPremium,
} from "./derive-run-view";
export type { DerivedRunView } from "./derive-run-view";
// FCA #10 — the Sample-risk field list is the DECLARED dictionary
// (gate-only inputs included), not just the chain-seeded keys. The
// same finding's Ship surface: the try-it's wire sample shows every
// declared required key (null = honestly unanswered), seeded by the
// SAME overlay rule the Run form uses.
export {
  deriveRunFields,
  buildSampleRisk,
  buildWireSampleInputs,
  declaredRowKeys,
  overlayVerifiedCase,
  // FCA #12 — the schedule-rating door: per-category judgment fields.
  scheduleFieldKey,
} from "./deriveRunFields";
export type {
  DeriveRunFieldsArgs,
  RunSchedule,
  RunScheduleCategory,
} from "./deriveRunFields";
// FCA #14 (display half) — the parts-don't-sum reconciliation line.
export { roundingReconciliationCaveat } from "./roundingCaveat";
