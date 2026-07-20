import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Chip } from "./Chip";

describe("Chip", () => {
  it("renders the label", () => {
    render(<Chip>active</Chip>);
    expect(screen.getByText("active")).toBeInTheDocument();
  });

  it("defaults to sans variant + default tone", () => {
    render(<Chip>chip</Chip>);
    const el = screen.getByText("chip").parentElement!;
    expect(el).toHaveClass("rater-chip--sans");
    expect(el).toHaveClass("rater-chip--default");
  });

  it("applies variant + tone classes", () => {
    render(
      <Chip variant="mono" tone="input">
        09341
      </Chip>,
    );
    const el = screen.getByText("09341").parentElement!;
    expect(el).toHaveClass("rater-chip--mono");
    expect(el).toHaveClass("rater-chip--input");
  });

  it("renders all 10 tones without crashing", () => {
    const tones = [
      "default",
      "input",
      "transform",
      "lookup",
      "math",
      "loading",
      "output",
      "success",
      "warning",
      "danger",
    ] as const;
    for (const t of tones) {
      const { unmount } = render(<Chip tone={t}>{t}</Chip>);
      expect(screen.getByText(t)).toBeInTheDocument();
      unmount();
    }
  });

  it("shows a dot when dot=true", () => {
    const { container } = render(<Chip dot>active</Chip>);
    expect(container.querySelector(".rater-chip__dot")).toBeInTheDocument();
  });

  it("renders remove button when onRemove is set", () => {
    render(
      <Chip onRemove={() => {}}>
        with-remove
      </Chip>,
    );
    expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
  });

  it("fires onRemove + uses custom removeLabel", async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    render(
      <Chip onRemove={onRemove} removeLabel="Clear filter">
        WI
      </Chip>,
    );
    await user.click(screen.getByRole("button", { name: "Clear filter" }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("does NOT render remove button when onRemove omitted", () => {
    render(<Chip>no-remove</Chip>);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
