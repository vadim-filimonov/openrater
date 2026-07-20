import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PremiumShadowControl, type ShadowableStep } from "./PremiumShadowControl";

const STEPS: ShadowableStep[] = [
  { adjustmentId: "adj1", name: "Loss IRPM", modelId: "loss_glm", pinnedVersion: "v2" },
];
const VERSIONS = { loss_glm: ["v2", "v1"] };

describe("PremiumShadowControl", () => {
  it("renders nothing when the step's model has <2 versions", () => {
    const { container } = render(
      <PremiumShadowControl
        steps={STEPS}
        versionsByModel={{ loss_glm: ["v2"] }}
        active={null}
        onChange={vi.fn()}
        baseFiled={1000}
        shadowFiled={null}
      />,
    );
    expect(container.querySelector(".rater-premium-shadow")).toBeNull();
  });

  it("renders the control + fires onChange when a shadow version is picked", () => {
    const onChange = vi.fn();
    render(
      <PremiumShadowControl
        steps={STEPS}
        versionsByModel={VERSIONS}
        active={null}
        onChange={onChange}
        baseFiled={1000}
        shadowFiled={null}
      />,
    );
    expect(screen.getByText("Shadow re-rate")).toBeInTheDocument();
    // Single step → only the version select; pick the non-pinned version.
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "v1" } });
    expect(onChange).toHaveBeenCalledWith({ adjustmentId: "adj1", version: "v1" });
  });

  it("shows the premium impact with a signed Δ when active", () => {
    render(
      <PremiumShadowControl
        steps={STEPS}
        versionsByModel={VERSIONS}
        active={{ adjustmentId: "adj1", version: "v1" }}
        onChange={vi.fn()}
        baseFiled={1000}
        shadowFiled={1120}
      />,
    );
    expect(screen.getByText(/filed \(pinned\)/i)).toBeInTheDocument();
    expect(screen.getByText(/filed \(shadow\)/i)).toBeInTheDocument();
    expect(screen.getByText("+$120")).toBeInTheDocument(); // 1120 − 1000
  });

  it("renders Δ as a placeholder while the shadow is still scoring", () => {
    render(
      <PremiumShadowControl
        steps={STEPS}
        versionsByModel={VERSIONS}
        active={{ adjustmentId: "adj1", version: "v1" }}
        onChange={vi.fn()}
        baseFiled={1000}
        shadowFiled={null}
        isScoring
      />,
    );
    // No signed delta yet; the shadow + delta cells show the muted placeholder.
    expect(screen.queryByText(/^\+\$/)).toBeNull();
  });

  it("shows a 'score a risk' hint instead of bare dashes when nothing scores", () => {
    render(
      <PremiumShadowControl
        steps={STEPS}
        versionsByModel={VERSIONS}
        active={{ adjustmentId: "adj1", version: "v1" }}
        onChange={vi.fn()}
        baseFiled={null}
        shadowFiled={null}
      />,
    );
    expect(screen.getByText(/add a product line that scores/i)).toBeInTheDocument();
    expect(screen.queryByText(/filed \(pinned\)/i)).toBeNull();
  });
});
