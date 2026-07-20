/**
 * useBrush1D — Brief 34 PR 34.5.
 *
 * Shared brush gesture hook for 1-D SVG charts (LineChart, BarChart,
 * LineMultiples). Owns the pointerdown → pointermove → pointerup
 * dance + click-vs-brush disambiguation. The caller renders the
 * visual brush rect from `state.range` and the SVG-level pointer
 * handlers from `handlers`.
 *
 * Contract:
 *   • pointerdown anywhere in the SVG starts a potential brush
 *   • pointermove tracks the gesture; if movement crosses
 *     BRUSH_MIN_WIDTH, `state.isBrushing` flips true and the visual
 *     rect should render
 *   • pointerup decides:
 *       – significant movement  → fires `onBrushEnd(rect)`
 *       – insignificant         → fires `onClick(startX)` so the
 *         caller can find the nearest datum (click-to-focus)
 *   • Escape cancels an active brush without firing either callback
 *
 * The caller passes `enabled` to gate the gesture entirely. When
 * disabled, no handlers fire (caller can short-circuit by passing
 * `enabled={false}` when neither `onBrushEnd` nor `onClick` are
 * wired).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BRUSH_MIN_WIDTH,
  clientToSvgCoords,
  isBrushSignificant,
  type BrushRect,
} from "./brushSelect";

/** Active brush state — visible to the consumer for rendering. */
export interface BrushState {
  readonly isBrushing: boolean;
  /** Brush rect in viewBox coords. Null when not brushing. */
  readonly rect: BrushRect | null;
}

export interface UseBrush1DOptions {
  /** Whether the brush gesture is enabled. */
  readonly enabled?: boolean;
  /**
   * Fires on pointerup when the brush is significant (drag distance
   * ≥ BRUSH_MIN_WIDTH). Hand the rect off; the caller computes
   * which keys it covers.
   */
  readonly onBrushEnd?: (rect: BrushRect) => void;
  /**
   * Fires on pointerup when the brush is insignificant (click).
   * `clickX` is the viewBox X coord of the pointerdown. Caller
   * picks the nearest datum.
   */
  readonly onClick?: (clickX: number) => void;
  /**
   * Optional Y-bounds for the brush rect — used to render the rect
   * visually (the brush itself is X-extent-only for 1-D charts).
   */
  readonly y1?: number;
  readonly y2?: number;
}

export interface UseBrush1DReturn {
  /** Active brush state — pass through to the SVG render. */
  readonly state: BrushState;
  /** Ref to attach to the SVG element. */
  readonly svgRef: React.RefObject<SVGSVGElement>;
  /** Spread these onto the SVG element. */
  readonly handlers: {
    readonly onPointerDown: (e: React.PointerEvent<SVGSVGElement>) => void;
    readonly onPointerMove: (e: React.PointerEvent<SVGSVGElement>) => void;
    readonly onPointerUp: (e: React.PointerEvent<SVGSVGElement>) => void;
    readonly onPointerCancel: (e: React.PointerEvent<SVGSVGElement>) => void;
  };
}

interface InternalState {
  readonly pointerId: number;
  readonly startX: number;
  readonly currentX: number;
}

/**
 * Brush hook for 1-D SVG charts. See module doc for the contract.
 */
export function useBrush1D(opts: UseBrush1DOptions = {}): UseBrush1DReturn {
  const { enabled = true, onBrushEnd, onClick, y1, y2 } = opts;
  // useRef<T>(null) returns RefObject<T> (read-only), which is what
  // React.JSX's `ref` prop expects (the mutable variant errors under
  // exactOptionalPropertyTypes).
  const svgRef = useRef<SVGSVGElement>(null);
  const [internal, setInternal] = useState<InternalState | null>(null);

  // Mirror callbacks in refs so handlers stay stable across renders.
  const onBrushEndRef = useRef<UseBrush1DOptions["onBrushEnd"]>(onBrushEnd);
  const onClickRef = useRef<UseBrush1DOptions["onClick"]>(onClick);
  useEffect(() => {
    onBrushEndRef.current = onBrushEnd;
  }, [onBrushEnd]);
  useEffect(() => {
    onClickRef.current = onClick;
  }, [onClick]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (!enabled) return;
      if (e.button !== 0) return; // Left button only.
      const svg = svgRef.current;
      if (!svg) return;
      const coords = clientToSvgCoords(svg, e.clientX, e.clientY);
      if (!coords) return;
      // Capture the pointer so move + up come to the SVG even if the
      // pointer drifts outside.
      try {
        svg.setPointerCapture(e.pointerId);
      } catch {
        // Some browsers (or test envs) reject when pointerType is
        // unknown; degrade silently.
      }
      setInternal({
        pointerId: e.pointerId,
        startX: coords.x,
        currentX: coords.x,
      });
    },
    [enabled],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (!internal || e.pointerId !== internal.pointerId) return;
      const svg = svgRef.current;
      if (!svg) return;
      const coords = clientToSvgCoords(svg, e.clientX, e.clientY);
      if (!coords) return;
      setInternal({ ...internal, currentX: coords.x });
    },
    [internal],
  );

  const finalize = useCallback(
    (final: InternalState) => {
      const rect: BrushRect = {
        x1: final.startX,
        x2: final.currentX,
        ...(y1 !== undefined ? { y1 } : {}),
        ...(y2 !== undefined ? { y2 } : {}),
      };
      if (isBrushSignificant(rect)) {
        onBrushEndRef.current?.(rect);
      } else {
        onClickRef.current?.(final.startX);
      }
    },
    [y1, y2],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (!internal || e.pointerId !== internal.pointerId) return;
      const svg = svgRef.current;
      if (svg) {
        try {
          svg.releasePointerCapture(e.pointerId);
        } catch {
          /* ignored */
        }
      }
      finalize(internal);
      setInternal(null);
    },
    [internal, finalize],
  );

  const onPointerCancel = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (!internal || e.pointerId !== internal.pointerId) return;
      setInternal(null);
    },
    [internal],
  );

  // Escape cancels an in-flight brush without firing either callback.
  useEffect(() => {
    if (!internal) return;
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === "Escape") setInternal(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [internal]);

  const isBrushing =
    internal !== null &&
    Math.abs(internal.currentX - internal.startX) >= BRUSH_MIN_WIDTH;
  const state: BrushState = {
    isBrushing,
    rect: internal
      ? {
          x1: internal.startX,
          x2: internal.currentX,
          ...(y1 !== undefined ? { y1 } : {}),
          ...(y2 !== undefined ? { y2 } : {}),
        }
      : null,
  };

  return {
    state,
    svgRef,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel },
  };
}
