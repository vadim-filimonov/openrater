/**
 * V2 — MapPanel single-state focus. We mock <UsChoropleth> (the d3-geo Albers
 * choropleth, maps next-gen Mode A) and capture the props MapPanel hands it,
 * asserting the national vs single-state choice.
 */
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

const captured: Array<Record<string, unknown>> = [];
vi.mock("../UsChoropleth", () => ({
  UsChoropleth: (props: Record<string, unknown>) => {
    captured.push(props);
    return null;
  },
}));

import { MapPanel } from "./MapPanel";
import type { SliceExhibit } from "./exhibit-math";

const EXHIBIT: SliceExhibit = {
  sliceId: "territory",
  sliceLabel: "Territory",
  levels: [
    { id: "KS", label: "Kansas", value: 1000, delta: null, share: 1 },
  ],
} as unknown as SliceExhibit;

const KPI = { id: "total_premium", label: "Total premium" } as never;

describe("MapPanel — V2 single-state focus", () => {
  it("focuses the single state when focusState is set", () => {
    captured.length = 0;
    render(<MapPanel exhibit={EXHIBIT} kpi={KPI} focusState="ks" />);
    const props = captured.at(-1)!;
    expect(props.granularity).toBe("state");
    expect(props.focusState).toBe("KS");
  });

  it("keeps the national 50-state view when focusState is absent", () => {
    captured.length = 0;
    render(<MapPanel exhibit={EXHIBIT} kpi={KPI} />);
    const props = captured.at(-1)!;
    expect(props.granularity).toBe("state");
    expect(props.focusState).toBeUndefined();
  });
});
