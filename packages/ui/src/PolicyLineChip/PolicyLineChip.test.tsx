/**
 * <PolicyLineChip> tests (Brief 46).
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PolicyLineChip } from "./PolicyLineChip";

describe("PolicyLineChip", () => {
  it("renders badge (product code), name, version, output, premium", () => {
    render(
      <PolicyLineChip
        product="do"
        planName="Nonprofit D&O"
        contentHash="7221abcd1234c630"
        premiumOutput="do_premium"
        premium={658}
        coverageSummary="all coverages bound"
      />,
    );
    expect(screen.getByText("DO")).toBeTruthy(); // product code badge
    expect(screen.getByText("Nonprofit D&O")).toBeTruthy();
    expect(screen.getByText("v7221…c630")).toBeTruthy(); // short hash
    expect(screen.getByText("do_premium")).toBeTruthy();
    expect(screen.getByText("$658")).toBeTruthy(); // whole-dollar
  });

  it("uses PRODUCT_LABELS as the badge title (accessible full name)", () => {
    render(
      <PolicyLineChip
        product="do"
        planName="X"
        contentHash="abcd"
        premiumOutput="p"
        premium={1}
      />,
    );
    expect(screen.getByText("DO").getAttribute("title")).toBe("Directors & Officers");
  });

  it("shows an em-dash before scoring (premium null)", () => {
    render(
      <PolicyLineChip
        product="cgl"
        planName="X"
        contentHash="abcd"
        premiumOutput="gl_premium"
        premium={null}
      />,
    );
    expect(screen.getByText("—")).toBeTruthy();
  });

  it("renders the rebind hint when a newer version exists + fires onRebind", () => {
    const onRebind = vi.fn();
    render(
      <PolicyLineChip
        product="cgl"
        planName="Nonprofit GL"
        contentHash="9a3b0000000000041"
        premiumOutput="gl_premium"
        premium={396}
        newerVersionHash="c1e70000000000ff"
        onRebind={onRebind}
      />,
    );
    expect(screen.getByText(/newer filed version/i)).toBeTruthy();
    fireEvent.click(screen.getByText(/review & rebind/i));
    expect(onRebind).toHaveBeenCalledTimes(1);
  });

  it("fires onRemove + onToggleExpand", () => {
    const onRemove = vi.fn();
    const onToggleExpand = vi.fn();
    render(
      <PolicyLineChip
        product="bop"
        planName="ACME BOP"
        contentHash="abcd"
        premiumOutput="bop_premium"
        premium={700}
        onRemove={onRemove}
        onToggleExpand={onToggleExpand}
      />,
    );
    fireEvent.click(screen.getByLabelText(/remove acme bop/i));
    expect(onRemove).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByLabelText(/expand line/i));
    expect(onToggleExpand).toHaveBeenCalledTimes(1);
  });

  it("renders expanded children only when expanded", () => {
    const { rerender } = render(
      <PolicyLineChip
        product="do"
        planName="X"
        contentHash="abcd"
        premiumOutput="p"
        premium={1}
        onToggleExpand={() => {}}
        expanded={false}
      >
        <div>per-line build-up</div>
      </PolicyLineChip>,
    );
    expect(screen.queryByText("per-line build-up")).toBeNull();
    rerender(
      <PolicyLineChip
        product="do"
        planName="X"
        contentHash="abcd"
        premiumOutput="p"
        premium={1}
        onToggleExpand={() => {}}
        expanded={true}
      >
        <div>per-line build-up</div>
      </PolicyLineChip>,
    );
    expect(screen.getByText("per-line build-up")).toBeTruthy();
  });

  it("renders a premium-output picker (D3) when multiple outputs + a handler", () => {
    const onPremiumOutputChange = vi.fn();
    render(
      <PolicyLineChip
        product="cgl"
        planName="Combined plan"
        contentHash="abcd"
        premiumOutput="do_premium"
        premium={1962}
        availableOutputs={["do_premium", "gl_premium"]}
        onPremiumOutputChange={onPremiumOutputChange}
      />,
    );
    const select = screen.getByLabelText(/premium output/i) as HTMLSelectElement;
    expect(select.value).toBe("do_premium");
    expect(Array.from(select.options).map((o) => o.value)).toEqual([
      "do_premium",
      "gl_premium",
    ]);
    fireEvent.change(select, { target: { value: "gl_premium" } });
    expect(onPremiumOutputChange).toHaveBeenCalledWith("gl_premium");
  });

  it("renders the output as static code when there's nothing to pick", () => {
    render(
      <PolicyLineChip
        product="do"
        planName="X"
        contentHash="abcd"
        premiumOutput="do_premium"
        premium={1}
        availableOutputs={["do_premium"]}
        onPremiumOutputChange={() => {}}
      />,
    );
    // single output → no picker
    expect(screen.queryByLabelText(/premium output/i)).toBeNull();
    expect(screen.getByText("do_premium")).toBeTruthy();
  });

  it("derives the badge tone generically — stable per product, no per-product map", () => {
    const { container, rerender } = render(
      <PolicyLineChip product="do" planName="X" contentHash="a" premiumOutput="p" premium={1} />,
    );
    const toneOf = () =>
      Array.from(container.querySelector(".rater-policy-line-chip__badge")!.classList).find((c) =>
        c.startsWith("rater-policy-line-chip__badge--tone-"),
      );
    const doTone = toneOf();
    expect(doTone).toBeTruthy(); // a tone is always assigned

    // Same product → same tone (stable).
    rerender(<PolicyLineChip product="do" planName="Y" contentHash="b" premiumOutput="p" premium={2} />);
    expect(toneOf()).toBe(doTone);

    // A never-special-cased product (auto) also gets a tone — no map needed.
    rerender(<PolicyLineChip product="auto" planName="Z" contentHash="c" premiumOutput="p" premium={3} />);
    expect(toneOf()).toBeTruthy();
  });
});
