/** <Citation> rendering-contract tests. */

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Citation } from "./Citation";

describe("<Citation>", () => {
  it("renders rule + source + single page", () => {
    const { container } = render(
      <Citation source="Meridian BOP" rule="§11.A.1" page={108} />,
    );
    expect(container.querySelector(".rater-citation__source")).toHaveTextContent(
      "Meridian BOP",
    );
    expect(container.querySelector(".rater-citation__rule")).toHaveTextContent(
      "§11.A.1",
    );
    expect(container.querySelector(".rater-citation__page")).toHaveTextContent(
      "p.108",
    );
  });

  it("formats a page range as pp.A-B", () => {
    const { container } = render(
      <Citation source="Meridian BOP" rule="§7.B.1" page={[41, 44]} />,
    );
    expect(container.querySelector(".rater-citation__page")).toHaveTextContent(
      "pp.41-44",
    );
  });

  it("collapses a single-value range [N, N] to p.N", () => {
    const { container } = render(
      <Citation source="Meridian BOP" rule="§3" page={[12, 12]} />,
    );
    expect(container.querySelector(".rater-citation__page")).toHaveTextContent(
      "p.12",
    );
  });

  it("omits the page block entirely when page is undefined", () => {
    const { container } = render(<Citation source="Meridian BOP" rule="§11.A.1" />);
    expect(container.querySelector(".rater-citation__page")).toBeNull();
    expect(container.querySelector(".rater-citation__sep")).toBeNull();
  });

  it("omits the source block when source is not provided", () => {
    const { container } = render(<Citation rule="§11.A.1" page={108} />);
    expect(container.querySelector(".rater-citation__source")).toBeNull();
  });

  it("dedupes when the rule already starts with the source name", () => {
    // Common case: actuary types "Meridian BOP §11.A.1" as the rule + sets
    // source="Meridian BOP". The component should not duplicate "Meridian BOP".
    const { container } = render(
      <Citation source="Meridian BOP" rule="Meridian BOP §11.A.1" page={108} />,
    );
    expect(container.querySelector(".rater-citation__source")).toBeNull();
    expect(container.querySelector(".rater-citation__rule")).toHaveTextContent(
      "Meridian BOP §11.A.1",
    );
  });

  it("dedupe is case-insensitive and whitespace-tolerant", () => {
    const { container } = render(
      <Citation
        source="  meridian bop  "
        rule="Meridian BOP §3.1"
        page={5}
      />,
    );
    expect(container.querySelector(".rater-citation__source")).toBeNull();
  });

  it("renders inline variant by default", () => {
    const { container } = render(
      <Citation source="Meridian BOP" rule="§11.A.1" page={108} />,
    );
    const root = container.querySelector(".rater-citation");
    expect(root).toHaveClass("rater-citation--inline");
    expect(root).not.toHaveClass("rater-citation--block");
  });

  it("renders block variant on opt-in", () => {
    const { container } = render(
      <Citation
        source="Meridian BOP"
        rule="§11.A.1"
        page={108}
        variant="block"
      />,
    );
    const root = container.querySelector(".rater-citation");
    expect(root).toHaveClass("rater-citation--block");
    expect(root).not.toHaveClass("rater-citation--inline");
  });

  it("builds a structured aria-label by default", () => {
    render(<Citation source="Meridian BOP" rule="§11.A.1" page={108} />);
    expect(
      screen.getByLabelText("Citation: Meridian BOP §11.A.1 page 108"),
    ).toBeInTheDocument();
  });

  it("builds aria-label with page range form", () => {
    render(
      <Citation source="Meridian BOP" rule="§7.B.1" page={[41, 44]} />,
    );
    expect(
      screen.getByLabelText("Citation: Meridian BOP §7.B.1 pages 41 to 44"),
    ).toBeInTheDocument();
  });

  it("respects ariaLabel override", () => {
    render(
      <Citation
        source="Meridian BOP"
        rule="§11.A.1"
        page={108}
        ariaLabel="Custom label here"
      />,
    );
    expect(screen.getByLabelText("Custom label here")).toBeInTheDocument();
  });

  it("always includes the leading book icon", () => {
    const { container } = render(<Citation rule="§3" />);
    expect(container.querySelector(".rater-citation__icon")).not.toBeNull();
  });
});
