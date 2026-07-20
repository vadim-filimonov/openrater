/**
 * <RatingChainCard> tests.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  RatingChainCard,
  type ChainFactor,
} from "./RatingChainCard";

const FACTORS: ChainFactor[] = [
  {
    id: "class_factor",
    label: "class factor",
    kind: "lookup.classification",
    resolves_to: "sample_bop_class_table",
  },
  {
    id: "construction",
    label: "construction",
    kind: "lookup.direct",
    resolves_to: "construction_class_table",
  },
  {
    id: "sprinkler",
    label: "sprinkler credit",
    kind: "constant",
    resolves_to: "0.95",
  },
];

describe("<RatingChainCard> — header", () => {
  it("renders the title", () => {
    render(
      <RatingChainCard title="BOP class chain" operator="multiply" factors={[]} />,
    );
    expect(screen.getByText("BOP class chain")).toBeInTheDocument();
  });

  it("uses 'chain.mult' label for multiply operator", () => {
    render(<RatingChainCard title="x" operator="multiply" factors={[]} />);
    expect(screen.getByText("chain.mult")).toBeInTheDocument();
  });

  it("uses 'chain.add' label for add operator", () => {
    render(<RatingChainCard title="x" operator="add" factors={[]} />);
    expect(screen.getByText("chain.add")).toBeInTheDocument();
  });

  it("has accessible aria-label including the chain title", () => {
    render(
      <RatingChainCard title="My Chain" operator="multiply" factors={[]} />,
    );
    expect(
      screen.getByRole("article", { name: /Chain: My Chain/i }),
    ).toBeInTheDocument();
  });
});

describe("<RatingChainCard> — base", () => {
  it("renders the base row when base is provided", () => {
    render(
      <RatingChainCard
        title="x"
        operator="multiply"
        base="$500.00"
        factors={[]}
      />,
    );
    expect(screen.getByText("Base")).toBeInTheDocument();
    expect(screen.getByText("$500.00")).toBeInTheDocument();
  });

  it("omits the base row when base is omitted", () => {
    render(<RatingChainCard title="x" operator="multiply" factors={[]} />);
    expect(screen.queryByText("Base")).toBeNull();
  });
});

describe("<RatingChainCard> — factors", () => {
  it("renders each factor's label, kind chip, and resolves text", () => {
    render(
      <RatingChainCard title="x" operator="multiply" factors={FACTORS} />,
    );
    expect(screen.getByText("class factor")).toBeInTheDocument();
    expect(screen.getByText("lookup.classification")).toBeInTheDocument();
    expect(screen.getByText("→ sample_bop_class_table")).toBeInTheDocument();
  });

  it("renders the multiply operator symbol once per factor", () => {
    render(
      <RatingChainCard title="x" operator="multiply" factors={FACTORS} />,
    );
    // 3 factors → 3 × symbols
    const symbols = screen.getAllByText("×");
    expect(symbols.length).toBeGreaterThanOrEqual(3);
  });

  it("renders the add operator symbol for additive chains", () => {
    render(
      <RatingChainCard title="x" operator="add" factors={FACTORS} />,
    );
    const symbols = screen.getAllByText("+");
    expect(symbols.length).toBeGreaterThanOrEqual(3);
  });

  it("empty-factor state shows the empty hint", () => {
    render(
      <RatingChainCard title="x" operator="multiply" factors={[]} />,
    );
    expect(screen.getByText(/No factors yet/i)).toBeInTheDocument();
    expect(screen.getByText(/multiplier to start/i)).toBeInTheDocument();
  });

  it("empty-factor state for additive chain mentions 'addend'", () => {
    render(<RatingChainCard title="x" operator="add" factors={[]} />);
    expect(screen.getByText(/addend to start/i)).toBeInTheDocument();
  });
});

describe("<RatingChainCard> — actions", () => {
  it("calls onEditFactor when a factor row is clicked", () => {
    const onEditFactor = vi.fn();
    render(
      <RatingChainCard
        title="x"
        operator="multiply"
        factors={FACTORS}
        onEditFactor={onEditFactor}
      />,
    );
    fireEvent.click(screen.getByLabelText("Edit class factor"));
    expect(onEditFactor).toHaveBeenCalledWith("class_factor");
  });

  it("factor button is disabled when onEditFactor is not provided", () => {
    render(
      <RatingChainCard title="x" operator="multiply" factors={FACTORS} />,
    );
    const btn = screen.getByLabelText("Edit class factor");
    expect(btn).toBeDisabled();
  });

  it("calls onAddFactor when the + Add factor button is clicked", () => {
    const onAddFactor = vi.fn();
    render(
      <RatingChainCard
        title="x"
        operator="multiply"
        factors={FACTORS}
        onAddFactor={onAddFactor}
      />,
    );
    fireEvent.click(screen.getByText("Add factor"));
    expect(onAddFactor).toHaveBeenCalledOnce();
  });

  it("does not render Add button when no callback", () => {
    render(
      <RatingChainCard title="x" operator="multiply" factors={FACTORS} />,
    );
    expect(screen.queryByText("Add factor")).toBeNull();
  });

  it("calls onRemoveFactor with the right id", () => {
    const onRemoveFactor = vi.fn();
    render(
      <RatingChainCard
        title="x"
        operator="multiply"
        factors={FACTORS}
        onRemoveFactor={onRemoveFactor}
      />,
    );
    fireEvent.click(screen.getByLabelText("Remove sprinkler credit"));
    expect(onRemoveFactor).toHaveBeenCalledWith("sprinkler");
  });

  it("does not render remove buttons when callback omitted", () => {
    render(
      <RatingChainCard title="x" operator="multiply" factors={FACTORS} />,
    );
    expect(screen.queryByLabelText("Remove class factor")).toBeNull();
  });
});

describe("<RatingChainCard> — output", () => {
  it("renders the output_label footer when provided", () => {
    render(
      <RatingChainCard
        title="x"
        operator="multiply"
        factors={[]}
        output_label="Indicated premium"
      />,
    );
    expect(screen.getByText("Indicated premium")).toBeInTheDocument();
  });

  it("omits the footer when output_label is not provided", () => {
    render(
      <RatingChainCard title="x" operator="multiply" factors={[]} />,
    );
    expect(screen.queryByText("Indicated premium")).toBeNull();
  });
});

describe("<RatingChainCard> — factors without resolves_to", () => {
  it("renders cleanly when factors omit the resolves_to field", () => {
    const minimal: ChainFactor[] = [
      { id: "x", label: "no-resolve", kind: "constant" },
    ];
    render(
      <RatingChainCard title="t" operator="multiply" factors={minimal} />,
    );
    expect(screen.getByText("no-resolve")).toBeInTheDocument();
    expect(screen.getByText("constant")).toBeInTheDocument();
    expect(screen.queryByText(/→/)).toBeNull();
  });
});
