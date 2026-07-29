/**
 * <WorkspaceShell> + <WorkspaceToolPane> tests — sub-brief 24.F.
 */

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { WorkspaceShell } from "./WorkspaceShell";
import { WorkspaceToolPane } from "./WorkspaceToolPane";

describe("<WorkspaceShell>", () => {
  it("uses the title as the aria-label (no visible h2 — 24.F3)", () => {
    render(
      <WorkspaceShell title="DIMENSIONS" toolPane={null}>
        <div />
      </WorkspaceShell>,
    );
    // 24.F3 dropped the visible h2 (the active tab is the title).
    // The accessible workspace identity lives on the section aria-label.
    expect(
      screen.queryByRole("heading", { level: 2 }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "DIMENSIONS" }),
    ).toBeInTheDocument();
  });

  it("renders the description in the context strip when supplied", () => {
    render(
      <WorkspaceShell
        title="DIMENSIONS"
        description="Define the variables your plan reads."
        toolPane={null}
      >
        <div />
      </WorkspaceShell>,
    );
    expect(
      screen.getByText("Define the variables your plan reads."),
    ).toBeInTheDocument();
  });

  it("renders headerActions in the context strip's right slot", () => {
    render(
      <WorkspaceShell
        title="ASSEMBLE"
        toolPane={null}
        headerActions={<button>Run sample</button>}
      >
        <div />
      </WorkspaceShell>,
    );
    expect(
      screen.getByRole("button", { name: "Run sample" }),
    ).toBeInTheDocument();
  });

  it("omits the context strip when neither description nor actions is supplied (24.F3)", () => {
    const { container } = render(
      <WorkspaceShell title="DIMENSIONS" toolPane={null}>
        <div />
      </WorkspaceShell>,
    );
    expect(
      container.querySelector(".rater-workspace-shell__context"),
    ).toBeNull();
  });

  it("renders toolPane in an aside with workspace-scoped aria-label", () => {
    render(
      <WorkspaceShell
        title="GATE"
        toolPane={<div data-testid="my-tool-pane">tools</div>}
      >
        <div />
      </WorkspaceShell>,
    );
    expect(screen.getByTestId("my-tool-pane")).toBeInTheDocument();
    // The aside is labelled "{title} tools" for screen-reader navigation
    expect(
      screen.getByRole("complementary", { name: "GATE tools" }),
    ).toBeInTheDocument();
  });

  it("renders children in the content area", () => {
    render(
      <WorkspaceShell title="PARAMETRIZE" toolPane={null}>
        <div data-testid="my-content">content</div>
      </WorkspaceShell>,
    );
    expect(screen.getByTestId("my-content")).toBeInTheDocument();
  });

  it("uses the supplied testId override", () => {
    render(
      <WorkspaceShell title="DIMENSIONS" toolPane={null} testId="custom-shell">
        <div />
      </WorkspaceShell>,
    );
    expect(screen.getByTestId("custom-shell")).toBeInTheDocument();
  });
});

describe("<WorkspaceToolPane>", () => {
  it("renders a section heading + body", () => {
    render(
      <WorkspaceToolPane>
        <WorkspaceToolPane.Section label="ADD">
          <WorkspaceToolPane.Button onClick={() => {}}>
            Standard
          </WorkspaceToolPane.Button>
        </WorkspaceToolPane.Section>
      </WorkspaceToolPane>,
    );
    expect(screen.getByText("ADD")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Standard" }),
    ).toBeInTheDocument();
  });

  it("fires onClick when a button is activated", () => {
    const onClick = vi.fn();
    render(
      <WorkspaceToolPane>
        <WorkspaceToolPane.Section label="ADD">
          <WorkspaceToolPane.Button onClick={onClick}>
            Geographic
          </WorkspaceToolPane.Button>
        </WorkspaceToolPane.Section>
      </WorkspaceToolPane>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Geographic" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("renders multiple sections with dividers between them", () => {
    render(
      <WorkspaceToolPane>
        <WorkspaceToolPane.Section label="ADD">
          <WorkspaceToolPane.Button>Standard</WorkspaceToolPane.Button>
        </WorkspaceToolPane.Section>
        <WorkspaceToolPane.Section label="TEMPLATES">
          <WorkspaceToolPane.Button>ISO BOP defaults</WorkspaceToolPane.Button>
        </WorkspaceToolPane.Section>
      </WorkspaceToolPane>,
    );
    expect(screen.getByText("ADD")).toBeInTheDocument();
    expect(screen.getByText("TEMPLATES")).toBeInTheDocument();
  });

  it("renders sublabel as a secondary text line on a button", () => {
    render(
      <WorkspaceToolPane>
        <WorkspaceToolPane.Section label="ADD">
          <WorkspaceToolPane.Button sublabel="Plain variable">
            Standard
          </WorkspaceToolPane.Button>
        </WorkspaceToolPane.Section>
      </WorkspaceToolPane>,
    );
    expect(screen.getByText("Plain variable")).toBeInTheDocument();
  });

  it("disables the button when disabled prop is true", () => {
    render(
      <WorkspaceToolPane>
        <WorkspaceToolPane.Section label="ADD">
          <WorkspaceToolPane.Button disabled>Geographic</WorkspaceToolPane.Button>
        </WorkspaceToolPane.Section>
      </WorkspaceToolPane>,
    );
    expect(screen.getByRole("button", { name: "Geographic" })).toBeDisabled();
  });

  it("supports the icon slot", () => {
    render(
      <WorkspaceToolPane>
        <WorkspaceToolPane.Section label="ADD">
          <WorkspaceToolPane.Button
            icon={<span data-testid="my-icon" />}
          >
            Standard
          </WorkspaceToolPane.Button>
        </WorkspaceToolPane.Section>
      </WorkspaceToolPane>,
    );
    expect(screen.getByTestId("my-icon")).toBeInTheDocument();
  });
});
