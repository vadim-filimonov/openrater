/**
 * <TierVerdictChip> tests — Brief 55.
 *
 * The one visual for an eligibility tier verdict. Pins: every tier
 * renders its canonical label + tone + description tooltip + a11y
 * label, and the tone map is the single source of color truth.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TierVerdictChip, TIER_CHIP_TONE } from "./TierVerdictChip";
import {
  ELIGIBILITY_TIERS,
  ELIGIBILITY_TIER_LABELS,
  ELIGIBILITY_TIER_DESCRIPTIONS,
} from "@openrater/contracts";

describe("TIER_CHIP_TONE", () => {
  it("maps each tier to a distinct, semantically-right chip tone", () => {
    expect(TIER_CHIP_TONE).toEqual({
      preferred: "success",
      standard: "default",
      submit: "warning",
      decline: "danger",
    });
  });

  it("covers every tier in the closed vocabulary", () => {
    for (const tier of ELIGIBILITY_TIERS) {
      expect(TIER_CHIP_TONE[tier]).toBeTruthy();
    }
  });
});

describe("<TierVerdictChip>", () => {
  it("renders the canonical label for every tier", () => {
    for (const tier of ELIGIBILITY_TIERS) {
      const { unmount } = render(<TierVerdictChip tier={tier} />);
      expect(
        screen.getByText(ELIGIBILITY_TIER_LABELS[tier]),
      ).toBeInTheDocument();
      unmount();
    }
  });

  it("carries the tier description as the tooltip + an a11y label (never color-only)", () => {
    render(<TierVerdictChip tier="submit" testId="t-submit" />);
    const chip = screen.getByTestId("t-submit");
    expect(chip.getAttribute("title")).toBe(
      ELIGIBILITY_TIER_DESCRIPTIONS.submit,
    );
    expect(chip.getAttribute("aria-label")).toBe("Eligibility tier: Submit");
    expect(chip.getAttribute("data-tier")).toBe("submit");
  });

  it("honors a title override", () => {
    render(<TierVerdictChip tier="decline" title="Out of appetite" testId="t-d" />);
    expect(screen.getByTestId("t-d").getAttribute("title")).toBe(
      "Out of appetite",
    );
  });
});
