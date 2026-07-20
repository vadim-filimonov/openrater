/**
 * PlanShell — the live v2 plan chrome (V2_INTERFACE_SPEC §2.1).
 * Re-homed from tower-v2/ when the Brief 70 cutover deleted that
 * directory's canvas reference primitives; the header + status chip
 * are the SHIPPED shell, not canvas.
 *
 * Brief 84: PlanLifecycleStepper is deleted — its thumb was hardcoded
 * to Draft (F1). PlanStatusChip renders the ONE derived headline status
 * (Draft / Live · vN / Archived) and deep-links to Ship.
 */
export { PlanHeader } from "./PlanHeader";
export type {
  PlanHeaderProps,
  PlanHeaderChecklistItem,
} from "./PlanHeader";
export { PlanStatusChip } from "./PlanStatusChip";
export type { PlanStatusChipProps } from "./PlanStatusChip";
