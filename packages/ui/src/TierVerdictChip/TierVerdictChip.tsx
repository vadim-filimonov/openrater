/**
 * <TierVerdictChip> — Brief 55.
 *
 * The single visual for an eligibility tier verdict (preferred /
 * standard / submit / decline), used in FOUR places so the actuary
 * learns one color language (node-design P-N7 / P-N9):
 *
 *   1. the filter editor's tier picker pills (interactive)
 *   2. the gate rail's rule list (the rule's assigned tier)
 *   3. the scored row (the verdict a risk landed in)
 *   4. the Analytics tier-slice legend
 *
 * Pure presentation over the design-system <Chip>. The tier→tone map
 * is the single source of color truth; the label + description come
 * from @openrater/contracts so the vocabulary never forks.
 *
 *   preferred → success (green)   best risks
 *   standard  → default (neutral) bread-and-butter book — the
 *               unremarkable middle; azure is reserved for interaction
 *               (V2_INTERFACE_SPEC §1.1)
 *   submit    → warning (amber)   manual UW review
 *   decline   → danger  (red)     out of appetite
 */

import type { JSX } from "react";
import { Chip, type ChipTone } from "@openrater/design-system";
import {
  type EligibilityTier,
  ELIGIBILITY_TIER_LABELS,
  ELIGIBILITY_TIER_DESCRIPTIONS,
} from "@openrater/contracts";

/** Single source of tier→chip-tone truth. Reused by the picker pills. */
export const TIER_CHIP_TONE: Readonly<Record<EligibilityTier, ChipTone>> = {
  preferred: "success",
  standard: "default",
  submit: "warning",
  decline: "danger",
};

export interface TierVerdictChipProps {
  readonly tier: EligibilityTier;
  /** Leading tone dot. Default true. */
  readonly dot?: boolean;
  /** Override the tooltip (defaults to the tier's canonical description). */
  readonly title?: string;
  readonly className?: string;
  readonly testId?: string;
}

export function TierVerdictChip({
  tier,
  dot = true,
  title,
  className,
  testId,
}: TierVerdictChipProps): JSX.Element {
  const label = ELIGIBILITY_TIER_LABELS[tier];
  return (
    <Chip
      variant="sans"
      tone={TIER_CHIP_TONE[tier]}
      dot={dot}
      className={className}
      title={title ?? ELIGIBILITY_TIER_DESCRIPTIONS[tier]}
      aria-label={`Eligibility tier: ${label}`}
      data-tier={tier}
      {...(testId ? { "data-testid": testId } : {})}
    >
      {label}
    </Chip>
  );
}
