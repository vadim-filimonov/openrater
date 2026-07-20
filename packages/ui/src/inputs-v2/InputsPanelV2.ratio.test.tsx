/**
 * <InputsPanelV2> — P2.5 derived-ratio binding tests.
 *
 * A mapping row can bind to colA ÷ colB instead of a single column (the
 * `@ratio:` sentinel, Brief 45 K8) — for a banded input whose data carries
 * the components, not the ratio. Hidden until chosen: a "Ratio of two
 * columns…" option seeds it, then a compact A ÷ B picker edits it in place.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { InputsPanelV2 } from "./InputsPanelV2";
import type { PlanInputMapping, RequiredInputEntry } from "../InputsWorkspace";

const MAPPING: PlanInputMapping = {
  source: {
    kind: "csv",
    columns: ["losses", "premium", "exposure"],
    sample_rows: [{ losses: "300", premium: "1000", exposure: "50000" }],
  },
  column_map: {},
};

const REQUIRED: readonly RequiredInputEntry[] = [
  { id: "loss_ratio", name: "Loss ratio", dtype: "number", category: "inputs" },
];

function renderPanel(
  mapping: PlanInputMapping,
  onMappingChange = vi.fn(),
) {
  render(
    <InputsPanelV2
      stages={[]}
      inputMapping={mapping}
      onMappingChange={onMappingChange}
      requiredInputs={REQUIRED}
      dimensions={[]}
    />,
  );
  return onMappingChange;
}

describe("<InputsPanelV2> — P2.5 derived-ratio binding", () => {
  it("offers a 'Ratio of two columns…' option and seeds it on select", () => {
    const onMappingChange = renderPanel(MAPPING);
    const select = screen.getByLabelText(
      "Source column for Loss ratio",
    ) as HTMLSelectElement;
    // The ratio option is present (book has ≥2 columns).
    expect(
      [...select.options].some((o) => /Ratio of two columns/.test(o.text)),
    ).toBe(true);

    // Selecting it seeds @ratio:<col0>/<col1>.
    const ratioOpt = [...select.options].find((o) =>
      /Ratio of two columns/.test(o.text),
    )!;
    fireEvent.change(select, { target: { value: ratioOpt.value } });
    expect(onMappingChange).toHaveBeenCalledWith(
      expect.objectContaining({
        column_map: { loss_ratio: "@ratio:losses/premium" },
      }),
    );
  });

  it("renders the A ÷ B picker + a computed sample for a ratio binding", () => {
    renderPanel({
      ...MAPPING,
      column_map: { loss_ratio: "@ratio:losses/premium" },
    });
    const num = screen.getByLabelText(
      "Numerator for Loss ratio",
    ) as HTMLSelectElement;
    const den = screen.getByLabelText(
      "Denominator for Loss ratio",
    ) as HTMLSelectElement;
    expect(num.value).toBe("losses");
    expect(den.value).toBe("premium");
    // Single-column picker is gone in ratio mode.
    expect(
      screen.queryByLabelText("Source column for Loss ratio"),
    ).not.toBeInTheDocument();
    // Sample shows the computed ratio: 300 / 1000 = 0.3.
    expect(screen.getByText("0.3")).toBeInTheDocument();
  });

  it("edits the numerator and reverts to a single column", () => {
    const onMappingChange = renderPanel({
      ...MAPPING,
      column_map: { loss_ratio: "@ratio:losses/premium" },
    });
    fireEvent.change(screen.getByLabelText("Numerator for Loss ratio"), {
      target: { value: "exposure" },
    });
    expect(onMappingChange).toHaveBeenCalledWith(
      expect.objectContaining({
        column_map: { loss_ratio: "@ratio:exposure/premium" },
      }),
    );

    // The clear button reverts to single-column (unmapped) mode.
    fireEvent.click(
      screen.getByLabelText("Use a single source column instead"),
    );
    expect(onMappingChange).toHaveBeenCalledWith(
      expect.objectContaining({ column_map: {} }),
    );
  });
});
