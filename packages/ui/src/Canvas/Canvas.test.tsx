/**
 * <Canvas> tests — sub-brief 24.G.
 *
 * The Canvas primitive wraps @xyflow/react. We test the wrapper-level
 * contract (render, props pass-through, default behavior) rather than
 * the underlying library's drag / zoom / edge-routing — those are
 * @xyflow/react's responsibility per ADR-0024.
 *
 * In jsdom, @xyflow/react's viewport measurement (getBoundingClientRect
 * returns zeros) means nodes don't render visually. The tests focus
 * on the wrapper surface: the <div class="rater-canvas"> shell, the
 * <ReactFlow> mount, controls + minimap + background slots.
 */

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Canvas, type CanvasNode, type CanvasEdge } from "./Canvas";

const EMPTY_NODES: CanvasNode[] = [];
const EMPTY_EDGES: CanvasEdge[] = [];

const SAMPLE_NODES: CanvasNode[] = [
  {
    id: "n1",
    type: "default",
    position: { x: 0, y: 0 },
    data: { label: "Input" },
  },
  {
    id: "n2",
    type: "default",
    position: { x: 200, y: 0 },
    data: { label: "Multiplicative chain" },
  },
];

const SAMPLE_EDGES: CanvasEdge[] = [
  { id: "e1", source: "n1", target: "n2" },
];

describe("<Canvas>", () => {
  it("renders the wrapper with the rater-canvas test id", () => {
    render(<Canvas nodes={EMPTY_NODES} edges={EMPTY_EDGES} />);
    expect(screen.getByTestId("rater-canvas")).toBeInTheDocument();
  });

  it("renders a custom testId when supplied", () => {
    render(
      <Canvas nodes={EMPTY_NODES} edges={EMPTY_EDGES} testId="my-canvas" />,
    );
    expect(screen.getByTestId("my-canvas")).toBeInTheDocument();
  });

  it("mounts ReactFlow's container element", () => {
    const { container } = render(
      <Canvas nodes={EMPTY_NODES} edges={EMPTY_EDGES} />,
    );
    expect(container.querySelector(".react-flow")).toBeTruthy();
  });

  it("hides the background by default flag (showBackground=false)", () => {
    const { container } = render(
      <Canvas
        nodes={EMPTY_NODES}
        edges={EMPTY_EDGES}
        showBackground={false}
      />,
    );
    expect(container.querySelector(".react-flow__background")).toBeNull();
  });

  it("renders the dotted background when showBackground is true (default)", () => {
    const { container } = render(
      <Canvas nodes={EMPTY_NODES} edges={EMPTY_EDGES} />,
    );
    expect(container.querySelector(".react-flow__background")).toBeTruthy();
  });

  it("renders Controls by default", () => {
    const { container } = render(
      <Canvas nodes={EMPTY_NODES} edges={EMPTY_EDGES} />,
    );
    expect(container.querySelector(".react-flow__controls")).toBeTruthy();
  });

  it("hides Controls when showControls is false", () => {
    const { container } = render(
      <Canvas nodes={EMPTY_NODES} edges={EMPTY_EDGES} showControls={false} />,
    );
    expect(container.querySelector(".react-flow__controls")).toBeNull();
  });

  it("hides MiniMap by default; renders it when showMinimap is true", () => {
    const { container, rerender } = render(
      <Canvas nodes={SAMPLE_NODES} edges={SAMPLE_EDGES} />,
    );
    expect(container.querySelector(".react-flow__minimap")).toBeNull();
    rerender(
      <Canvas nodes={SAMPLE_NODES} edges={SAMPLE_EDGES} showMinimap />,
    );
    expect(container.querySelector(".react-flow__minimap")).toBeTruthy();
  });

  it("renders the overlay slot when supplied", () => {
    render(
      <Canvas
        nodes={EMPTY_NODES}
        edges={EMPTY_EDGES}
        overlay={<div data-testid="my-overlay">overlay</div>}
      />,
    );
    expect(screen.getByTestId("my-overlay")).toBeInTheDocument();
  });

  it("applies inline style overrides on the wrapper", () => {
    render(
      <Canvas
        nodes={EMPTY_NODES}
        edges={EMPTY_EDGES}
        style={{ height: 600 }}
      />,
    );
    const wrapper = screen.getByTestId("rater-canvas");
    expect(wrapper).toHaveStyle({ height: "600px" });
  });

  it("accepts the supplied nodes + edges (props flow through)", () => {
    // We don't visually assert node rendering (jsdom doesn't measure
    // viewport), but we verify the canvas doesn't error on mount with
    // sample data — a regression test for prop-shape changes.
    expect(() =>
      render(
        <Canvas
          nodes={SAMPLE_NODES}
          edges={SAMPLE_EDGES}
          onNodesChange={() => {}}
          onEdgesChange={() => {}}
          onConnect={() => {}}
        />,
      ),
    ).not.toThrow();
  });
});
