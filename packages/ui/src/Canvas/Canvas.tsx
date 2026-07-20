/**
 * <Canvas> — substrate primitive for node-and-edge graph surfaces
 * (sub-brief 24.G; per ADR-0024).
 *
 * Thin wrapper around @xyflow/react's <ReactFlow> that:
 *   • Applies our design-token aesthetics (background, controls
 *     palette, edge stroke, node border defaults).
 *   • Restricts the surface area we depend on so the swap cost
 *     stays small (per ADR-0024 §Negative).
 *   • Re-exports the @xyflow/react types from one place so consumers
 *     don't reach into the library directly.
 *
 * 24.G ships this as substrate only — no rate-lab UI mounts it yet.
 * 24.H (ASSEMBLE workspace) will be the first consumer.
 *
 * Usage:
 *
 *   import { Canvas, type CanvasNode, type CanvasEdge } from "@openrater/ui";
 *
 *   const nodes: CanvasNode[] = [
 *     { id: "n1", position: { x: 0, y: 0 }, data: { label: "Class code" } },
 *   ];
 *   const edges: CanvasEdge[] = [
 *     { id: "e1", source: "n1", target: "n2" },
 *   ];
 *
 *   <Canvas
 *     nodes={nodes}
 *     edges={edges}
 *     onNodesChange={…}
 *     onEdgesChange={…}
 *     onConnect={…}
 *   />
 *
 * For surfaces that need more of the @xyflow/react API (custom node
 * types, viewport-API access via useReactFlow, etc.), import directly
 * from @xyflow/react — the library is a runtime dependency that ships
 * with this package.
 */

import { useEffect, useRef } from "react";
import type { CSSProperties, DragEvent, JSX, ReactNode } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type Connection,
  type FitViewOptions,
  type NodeTypes,
  type EdgeTypes,
} from "@xyflow/react";

import "@xyflow/react/dist/style.css";
import "./Canvas.css";

/** Re-exported under our domain names so consumers depend on one place. */
export type CanvasNode<TData extends Record<string, unknown> = Record<string, unknown>> = Node<TData>;
export type CanvasEdge<TData extends Record<string, unknown> = Record<string, unknown>> = Edge<TData>;
export type CanvasNodeChange = NodeChange;
export type CanvasEdgeChange = EdgeChange;
export type CanvasConnection = Connection;
export type CanvasNodeTypes = NodeTypes;
export type CanvasEdgeTypes = EdgeTypes;

export interface CanvasProps {
  /** The current nodes. Use [] for an empty canvas. */
  readonly nodes: readonly CanvasNode[];
  /** The current edges. Use [] for none. */
  readonly edges: readonly CanvasEdge[];
  /**
   * Fires when the user drags / selects / deletes nodes. Parent owns
   * the state; canvas is controlled. Forward to applyNodeChanges
   * from @xyflow/react if you want default behavior.
   */
  readonly onNodesChange?: (changes: CanvasNodeChange[]) => void;
  /** Same for edges. */
  readonly onEdgesChange?: (changes: CanvasEdgeChange[]) => void;
  /**
   * Fires when the user drags an output-handle onto an input-handle.
   * Parent appends the connection to `edges` (typically via
   * addEdge from @xyflow/react).
   */
  readonly onConnect?: (connection: CanvasConnection) => void;
  /** Custom node renderers, keyed by node.type. */
  readonly nodeTypes?: CanvasNodeTypes;
  /** Custom edge renderers, keyed by edge.type. */
  readonly edgeTypes?: CanvasEdgeTypes;
  /**
   * When true, the canvas fits all nodes in view on first paint.
   * Default true. Set false for empty-state canvases.
   */
  readonly fitView?: boolean;
  /** Options passed to the initial fitView call (padding, duration, etc.). */
  readonly fitViewOptions?: FitViewOptions;
  /**
   * Show the minimap in the bottom-right corner. Default false —
   * enable for canvases that grow large enough to scroll out of view.
   */
  readonly showMinimap?: boolean;
  /**
   * Show the controls panel (zoom + fit-view + interactivity lock)
   * in the bottom-left. Default true.
   */
  readonly showControls?: boolean;
  /**
   * Show the dotted background grid. Default true. Set false for
   * presentation surfaces (compare-view, trace cascade).
   */
  readonly showBackground?: boolean;
  /**
   * Slot for parent-supplied panel overlays (e.g., a node-inspector
   * positioned absolutely over the canvas). Rendered as a child of
   * the canvas wrapper; positioning is the consumer's responsibility.
   */
  readonly overlay?: ReactNode;
  /** Style override for the wrapper. Use sparingly. */
  readonly style?: CSSProperties;
  /**
   * Fired when the user drops a draggable onto the canvas (e.g., a
   * palette item in ASSEMBLE). The position is in flow coordinates,
   * not screen coordinates — pre-converted via xyflow's
   * `screenToFlowPosition`. The native `event` is passed through so
   * consumers can read `event.dataTransfer`.
   *
   * Requires the consumer to set the dataTransfer payload on
   * dragStart. The Canvas calls `event.preventDefault()` on dragOver
   * + drop automatically when this prop is supplied.
   */
  readonly onPaneDrop?: (
    event: DragEvent<HTMLDivElement>,
    position: { x: number; y: number },
  ) => void;
  /**
   * Fired when a node receives a click. Bubbles up from xyflow's
   * `onNodeClick`. Consumers typically open the node's edit drawer.
   */
  readonly onNodeClick?: (nodeId: string) => void;
  readonly testId?: string;
}

const DEFAULT_FIT_VIEW_OPTIONS: FitViewOptions = {
  padding: 0.2,
  duration: 300,
};

/**
 * Inner component that lives inside the <ReactFlowProvider> tree so it
 * can call `useReactFlow()` for coordinate conversions (drop position).
 * The public <Canvas> wraps this in the provider.
 */
function CanvasInner(props: CanvasProps): JSX.Element {
  const {
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    onConnect,
    nodeTypes,
    edgeTypes,
    fitView = true,
    fitViewOptions = DEFAULT_FIT_VIEW_OPTIONS,
    showMinimap = false,
    showControls = true,
    showBackground = true,
    overlay,
    style,
    onPaneDrop,
    onNodeClick,
    testId = "rater-canvas",
  } = props;

  // ReactFlow nodes/edges are mutable internally; cast away readonly
  // at the boundary. Parent state should still be treated as
  // readonly upstream.
  const mutableNodes = nodes as CanvasNode[];
  const mutableEdges = edges as CanvasEdge[];

  // @xyflow/react emits a warning when fitView is true with 0 nodes.
  // Disable fitView until we have nodes to fit; re-enable once they
  // arrive. Avoids the spurious warning + the no-op call.
  const effectiveFitView = fitView && nodes.length > 0;

  // Access to flow coordinate-system conversion for drop handling.
  // Safe to call unconditionally — Canvas always wraps in
  // ReactFlowProvider (see exported Canvas below).
  const { screenToFlowPosition } = useReactFlow();

  // Defensive: warn once if the consumer forgot to import the
  // stylesheet (we import it ourselves, but in case of bundler
  // tree-shaking weirdness).
  useEffect(() => {
    if (typeof document === "undefined") return;
    const probe = document.querySelector(".react-flow");
    if (!probe) return;
    const styles = window.getComputedStyle(probe);
    if (styles.position !== "relative") {
      // Stylesheet probably missing. Don't throw — just hint.
      // eslint-disable-next-line no-console
      console.warn(
        "[Canvas] @xyflow/react stylesheet may be missing — node positioning may be broken.",
      );
    }
  }, []);

  // ── Drop handlers (only active when onPaneDrop is supplied) ──

  const wrapperRef = useRef<HTMLDivElement | null>(null);

  const handleDragOver = onPaneDrop
    ? (event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }
    : undefined;

  const handleDrop = onPaneDrop
    ? (event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        const position = screenToFlowPosition({
          x: event.clientX,
          y: event.clientY,
        });
        onPaneDrop(event, position);
      }
    : undefined;

  // Wrap xyflow's onNodeClick (which has a different signature) into
  // our consumer-friendly `(nodeId) => void` callback.
  const handleNodeClick = onNodeClick
    ? (_event: unknown, node: { id: string }) => onNodeClick(node.id)
    : undefined;

  return (
    <div
      ref={wrapperRef}
      className="rater-canvas"
      data-testid={testId}
      style={style}
      {...(handleDragOver !== undefined ? { onDragOver: handleDragOver } : {})}
      {...(handleDrop !== undefined ? { onDrop: handleDrop } : {})}
    >
      <ReactFlow
        nodes={mutableNodes}
        edges={mutableEdges}
        {...(onNodesChange !== undefined ? { onNodesChange } : {})}
        {...(onEdgesChange !== undefined ? { onEdgesChange } : {})}
        {...(onConnect !== undefined ? { onConnect } : {})}
        {...(nodeTypes !== undefined ? { nodeTypes } : {})}
        {...(edgeTypes !== undefined ? { edgeTypes } : {})}
        {...(handleNodeClick !== undefined
          ? { onNodeClick: handleNodeClick }
          : {})}
        fitView={effectiveFitView}
        fitViewOptions={fitViewOptions}
        // Snap-to-grid keeps node positions readable; matches the
        // background dot spacing.
        snapToGrid
        snapGrid={[12, 12]}
        proOptions={{ hideAttribution: true }}
        // Pan + zoom feels natural with the defaults; expose them for
        // future surfaces (compare-view may want pan but not zoom).
        panOnDrag
        zoomOnScroll
        zoomOnPinch
        // Selection: clicking the background deselects; clicking a node
        // selects it. Multi-select via shift-click / marquee.
        selectionOnDrag={false}
        deleteKeyCode={["Backspace", "Delete"]}
      >
        {showBackground ? (
          <Background variant={BackgroundVariant.Dots} gap={12} size={1} />
        ) : null}
        {showControls ? <Controls showInteractive={false} /> : null}
        {showMinimap ? (
          <MiniMap pannable zoomable className="rater-canvas__minimap" />
        ) : null}
      </ReactFlow>
      {overlay}
    </div>
  );
}

/**
 * Public Canvas — wraps `CanvasInner` in a `<ReactFlowProvider>` so
 * inner code (and any consumer that wants to use `useReactFlow()`
 * inside the overlay or via a custom node) has access to the flow
 * store.
 *
 * The provider was added in sub-brief 24.H to support drag-drop into
 * the canvas; existing consumers see no behavior change.
 */
export function Canvas(props: CanvasProps): JSX.Element {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}

// Convenience re-exports so consumers don't need to reach into
// @xyflow/react for the common helpers. (Direct imports still work
// for the long tail.)
export { applyNodeChanges, applyEdgeChanges, addEdge } from "@xyflow/react";
