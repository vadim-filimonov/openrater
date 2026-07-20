import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PlanGenesis } from "./PlanGenesis";

describe("PlanGenesis (Brief 89 §2.1)", () => {
  it("renders both doors with their requirement lines wired via aria-describedby", () => {
    render(
      <PlanGenesis
        onDataDoor={() => {}}
        onAlgorithmDoor={() => {}}
        editable
      />,
    );
    const data = screen.getByTestId("rater-genesis-door-data");
    const alg = screen.getByTestId("rater-genesis-door-algorithm");
    expect(data).toHaveTextContent("Start from your data");
    expect(alg).toHaveTextContent("Start from the algorithm");
    // R3 — requirements live ON the doors.
    const dataNeed = document.getElementById(
      data.getAttribute("aria-describedby") ?? "",
    );
    const algNeed = document.getElementById(
      alg.getAttribute("aria-describedby") ?? "",
    );
    expect(dataNeed).toHaveTextContent(/CSV with a header row/);
    expect(algNeed).toHaveTextContent(/nothing but the manual/);
  });

  it("fires the door callbacks", () => {
    const onData = vi.fn();
    const onAlg = vi.fn();
    render(
      <PlanGenesis onDataDoor={onData} onAlgorithmDoor={onAlg} editable />,
    );
    fireEvent.click(screen.getByTestId("rater-genesis-door-data"));
    fireEvent.click(screen.getByTestId("rater-genesis-door-algorithm"));
    expect(onData).toHaveBeenCalledTimes(1);
    expect(onAlg).toHaveBeenCalledTimes(1);
  });

  it("shows the duplicate link only when a target exists (R4)", () => {
    const { rerender } = render(
      <PlanGenesis onDataDoor={() => {}} onAlgorithmDoor={() => {}} editable />,
    );
    expect(screen.queryByTestId("rater-genesis-duplicate")).toBeNull();
    const onDup = vi.fn();
    rerender(
      <PlanGenesis
        onDataDoor={() => {}}
        onAlgorithmDoor={() => {}}
        onDuplicate={onDup}
        editable
      />,
    );
    fireEvent.click(screen.getByTestId("rater-genesis-duplicate"));
    expect(onDup).toHaveBeenCalledTimes(1);
  });

  it("disables the doors on a read-only plan (§7)", () => {
    const onData = vi.fn();
    render(
      <PlanGenesis
        onDataDoor={onData}
        onAlgorithmDoor={() => {}}
        editable={false}
      />,
    );
    const door = screen.getByTestId("rater-genesis-door-data");
    expect(door).toBeDisabled();
    fireEvent.click(door);
    expect(onData).not.toHaveBeenCalled();
    expect(
      screen.getByText(/read-only — reopen a draft/i),
    ).toBeInTheDocument();
  });
});
