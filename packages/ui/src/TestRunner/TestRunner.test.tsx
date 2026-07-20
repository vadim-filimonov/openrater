/**
 * <TestRunner> tests.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TestRunner } from "./TestRunner";
import type { Plan, RunResult } from "@openrater/contracts";

const PLAN: Plan = {
  id: "test.plan",
  version: "0.1.0",
  name: "Test plan",
  nodes: [],
  edges: [],
};

function makeRunResult(overrides: Partial<RunResult> = {}): RunResult {
  return {
    outputs: { total_premium: 5000 },
    trace: {
      step1: {
        kindId: "constant",
        inputs: {},
        outputs: { value: 5000 },
        explanation: "Constant 5000",
      },
    },
    startedAt: 0,
    durationMs: 1,
    as_of: "2026-05-20",
    row_status: "ok",
    ...overrides,
  };
}

describe("<TestRunner> — initial render", () => {
  it("shows the inputs textarea", () => {
    render(<TestRunner plan={PLAN} onRun={() => makeRunResult()} />);
    expect(
      screen.getByRole("textbox", { name: "Sample inputs JSON" }),
    ).toBeInTheDocument();
  });

  it("shows the Run button (not Re-run on first render)", () => {
    render(<TestRunner plan={PLAN} onRun={() => makeRunResult()} />);
    expect(screen.getByRole("button", { name: /Run/i })).toBeInTheDocument();
    expect(screen.queryByText("Re-run")).toBeNull();
  });

  it("shows an empty state pointing to the Run button", () => {
    render(<TestRunner plan={PLAN} onRun={() => makeRunResult()} />);
    expect(screen.getByText(/Edit the inputs above/)).toBeInTheDocument();
    expect(screen.getByText(/Test plan/)).toBeInTheDocument();
  });

  it("uses initialInputs JSON when provided", () => {
    render(
      <TestRunner
        plan={PLAN}
        initialInputs={{ x: 5, y: "WI" }}
        onRun={() => makeRunResult()}
      />,
    );
    const ta = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(ta.value).toContain('"x": 5');
    expect(ta.value).toContain('"y": "WI"');
  });

  it("does NOT show Compare button before any successful run", () => {
    render(<TestRunner plan={PLAN} onRun={() => makeRunResult()} />);
    expect(screen.queryByText(/Compare to previous/)).toBeNull();
  });
});

describe("<TestRunner> — run flow", () => {
  it("invokes onRun with parsed inputs", async () => {
    const onRun = vi.fn(() => makeRunResult());
    render(
      <TestRunner
        plan={PLAN}
        initialInputs={{ class_code: "c101", tiv: 250000 }}
        onRun={onRun}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Run/i }));
    await waitFor(() => expect(onRun).toHaveBeenCalledOnce());
    expect(onRun).toHaveBeenCalledWith({ class_code: "c101", tiv: 250000 });
  });

  it("renders TracePanel after a successful run", async () => {
    render(
      <TestRunner
        plan={PLAN}
        initialInputs={{ class_code: "c101" }}
        onRun={() => makeRunResult()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Run/i }));
    await screen.findByText(/Constant 5000/);
    expect(screen.queryByText(/Edit the inputs above/)).toBeNull();
  });

  it("button label switches to 'Re-run' after first successful run", async () => {
    render(
      <TestRunner
        plan={PLAN}
        initialInputs={{}}
        onRun={() => makeRunResult()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Run/i }));
    await screen.findByRole("button", { name: /Re-run/i });
  });

  it("supports async onRun", async () => {
    const onRun = vi.fn(
      () =>
        new Promise<RunResult>((resolve) =>
          setTimeout(() => resolve(makeRunResult()), 10),
        ),
    );
    render(
      <TestRunner plan={PLAN} initialInputs={{}} onRun={onRun} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Run/i }));
    await waitFor(() => expect(onRun).toHaveBeenCalledOnce());
    await screen.findByText(/Constant 5000/);
  });
});

describe("<TestRunner> — error handling", () => {
  it("shows parse error for invalid JSON", () => {
    const onRun = vi.fn();
    render(
      <TestRunner
        plan={PLAN}
        initialInputs={{ class_code: "c101" }}
        onRun={onRun}
      />,
    );
    const ta = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "not valid json {" } });
    fireEvent.click(screen.getByRole("button", { name: /Run/i }));
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(onRun).not.toHaveBeenCalled();
  });

  it("rejects non-object JSON (arrays, strings, numbers)", () => {
    const onRun = vi.fn();
    render(<TestRunner plan={PLAN} initialInputs={{}} onRun={onRun} />);
    const ta = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "[1, 2, 3]" } });
    fireEvent.click(screen.getByRole("button", { name: /Run/i }));
    expect(screen.getByRole("alert").textContent).toMatch(/must be a JSON object/);
    expect(onRun).not.toHaveBeenCalled();
  });

  it("surfaces error banner when onRun throws", async () => {
    const onRun = vi.fn(() => {
      throw new Error("Plan does not compile: missing kind");
    });
    render(<TestRunner plan={PLAN} initialInputs={{}} onRun={onRun} />);
    fireEvent.click(screen.getByRole("button", { name: /Run/i }));
    await waitFor(() => {
      const alert = screen.getByRole("alert");
      expect(alert.textContent).toMatch(/Plan does not compile/);
    });
  });

  it("surfaces error banner when async onRun rejects", async () => {
    const onRun = vi.fn(() => Promise.reject(new Error("network down")));
    render(<TestRunner plan={PLAN} initialInputs={{}} onRun={onRun} />);
    fireEvent.click(screen.getByRole("button", { name: /Run/i }));
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(/network down/);
    });
  });
});

describe("<TestRunner> — compare to previous", () => {
  it("Compare button appears after the second run", async () => {
    let i = 0;
    const onRun = vi.fn(() => makeRunResult({ outputs: { total_premium: 5000 + i++ * 100 } }));
    render(<TestRunner plan={PLAN} initialInputs={{}} onRun={onRun} />);
    // First run — no compare button yet
    fireEvent.click(screen.getByRole("button", { name: /Run/i }));
    await screen.findByRole("button", { name: /Re-run/i });
    expect(screen.queryByText(/Compare to previous/)).toBeNull();
    // Second run — compare button appears
    fireEvent.click(screen.getByRole("button", { name: /Re-run/i }));
    await screen.findByText(/Compare to previous/);
  });

  it("Compare toggle swaps TracePanel for PlanCompareView", async () => {
    let i = 0;
    const onRun = vi.fn(() => makeRunResult({ outputs: { total_premium: 5000 + i++ * 100 } }));
    render(<TestRunner plan={PLAN} initialInputs={{}} onRun={onRun} />);
    fireEvent.click(screen.getByRole("button", { name: /Run/i }));
    await screen.findByRole("button", { name: /Re-run/i });
    fireEvent.click(screen.getByRole("button", { name: /Re-run/i }));
    const compareBtn = await screen.findByRole("button", { name: /Compare to previous/i });
    fireEvent.click(compareBtn);
    // PlanCompareView renders the mode tag "mode: run-vs-run"
    await screen.findByText(/mode: run-vs-run/i);
  });

  it("Hide-comparison toggles back to TracePanel", async () => {
    let i = 0;
    const onRun = vi.fn(() => makeRunResult({ outputs: { total_premium: 5000 + i++ * 100 } }));
    render(<TestRunner plan={PLAN} initialInputs={{}} onRun={onRun} />);
    fireEvent.click(screen.getByRole("button", { name: /Run/i }));
    await screen.findByRole("button", { name: /Re-run/i });
    fireEvent.click(screen.getByRole("button", { name: /Re-run/i }));
    fireEvent.click(await screen.findByRole("button", { name: /Compare to previous/i }));
    fireEvent.click(await screen.findByRole("button", { name: /Hide comparison/i }));
    // Back to trace panel — "Constant 5000" should be visible again
    await screen.findByText(/Constant/);
  });
});
