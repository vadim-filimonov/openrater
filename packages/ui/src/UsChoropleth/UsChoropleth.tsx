/**
 * <UsChoropleth> — a token-themed US choropleth (maps next-gen, Mode A).
 *
 * Replaces the MapLibre-no-basemap national choropleth that backed the
 * Analytics MapPanel + the Portfolio Map. The problem with that path: MapLibre
 * renders in Web Mercator (which d3 explicitly discourages for US choropleths —
 * it distorts areas and pushes Alaska/Hawaii off-frame), one WebGL source+layer
 * pair per state, on a blank canvas.
 *
 * This renders the SAME bundled us-atlas geometry (reused from geoCatalog) with
 * `d3.geoAlbersUsa()` — equal-area, Alaska & Hawaii inset — as crisp SVG paths
 * in a fixed viewBox (so it never depends on a settled container width). Fills
 * are data-driven (the caller's pre-bucketed colors); strokes/selection are
 * token-driven via CSS, so dark/light "just work" with no per-paint theme hack.
 * Each region is a real DOM `<path>` with a `<title>` + testid — accessible and
 * testable, unlike the WebGL canvas it replaces.
 *
 * Pure-ish presentation: the caller owns the values + the color buckets; this
 * owns projection, hit-testing, hover, and cross-filter selection.
 */

import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import { geoAlbersUsa, geoGraticule, geoPath } from "d3-geo";
import type { Feature, MultiPolygon, Polygon } from "geojson";
import {
  loadGeoCatalog,
  type GeoCountyFeature,
  type GeoStateFeature,
} from "../GeoMapEditor/geoCatalog";
import "./UsChoropleth.css";

type RegionFeature = GeoStateFeature | GeoCountyFeature;

export interface UsChoroplethProps {
  /**
   * "state" → the national 51-state choropleth (or one state when `focusState`
   * is set). "county" → the counties of `focusState`.
   */
  readonly granularity: "state" | "county";
  /** county: whose counties to draw. state: optional single-state zoom. */
  readonly focusState?: string;
  /** Region id → fill color. id = USPS (state) or 5-digit FIPS (county). The
   *  caller pre-buckets (e.g. the shared `bucketMap` + ramp). */
  readonly colorById: ReadonlyMap<string, string>;
  /** Region id → raw value, for the hover tooltip. */
  readonly valueById?: ReadonlyMap<string, number | null>;
  /** Format a value for the tooltip. Defaults to `String`. */
  readonly formatValue?: (v: number | null) => string;
  /** Metric name shown in the tooltip ("Earned premium"). */
  readonly metricLabel?: string;
  /** The cross-filtered region (focus stroke); others dim. */
  readonly selectedId?: string | null;
  /** Fires with the clicked region id. The consumer owns toggle semantics
   *  (and any state→territory indirection). */
  readonly onSelect?: (id: string) => void;
  readonly onHover?: (id: string | null) => void;
  /**
   * Draw the Albers geographic-context backdrop (maps next-gen "Mode C"):
   * a faint lat/lng graticule over the land, a crisp coastline, and a
   * brand-cyan depth halo that lifts the landmass off the canvas. Pure SVG
   * in the same projection — no tiles. Opt-in (Analytics + Portfolio maps).
   */
  readonly geographicContext?: boolean;
  readonly ariaLabel?: string;
  readonly testId?: string;
}

const VIEW = { w: 960, h: 600 } as const;

function idOf(f: RegionFeature): string {
  return "STATE_USPS" in f.properties ? f.properties.GEOID : f.properties.USPS;
}

export function UsChoropleth(props: UsChoroplethProps): JSX.Element {
  const {
    granularity, focusState, colorById, valueById, formatValue = String,
    metricLabel, selectedId, onSelect, onHover, geographicContext = false,
    ariaLabel = "US choropleth map", testId = "rater-us-choropleth",
  } = props;

  const [features, setFeatures] = useState<readonly RegionFeature[] | null>(null);
  const [outline, setOutline] = useState<Feature<Polygon | MultiPolygon> | null>(null);
  const [hover, setHover] = useState<{ id: string; name: string; x: number; y: number } | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);

  // ── load the bundled us-atlas geometry for this view ──
  useEffect(() => {
    let cancelled = false;
    setHover(null); // a focus-state/granularity change must not leave a stale card
    void (async () => {
      const cat = await loadGeoCatalog();
      if (cancelled) return;
      if (granularity === "county") {
        setFeatures(focusState ? cat.countiesByState.get(focusState) ?? [] : []);
        // the focused state's silhouette frames its counties
        setOutline(geographicContext && focusState ? cat.statesByUsps.get(focusState) ?? null : null);
      } else if (focusState) {
        const s = cat.statesByUsps.get(focusState);
        setFeatures(s ? [s] : []);
        setOutline(geographicContext ? s ?? null : null);
      } else {
        setFeatures([...cat.statesByUsps.values()]);
        setOutline(geographicContext ? cat.nationOutline : null);
      }
    })();
    return () => { cancelled = true; };
  }, [granularity, focusState, geographicContext]);

  // ── project + path once per feature set ──
  // The outline + graticule ride the SAME projection (fit to the regions) so
  // the geographic-context backdrop registers exactly with the choropleth.
  const { paths, outlinePath, graticulePath } = useMemo(() => {
    if (!features || features.length === 0) {
      return { paths: [] as { id: string; name: string; d: string }[], outlinePath: "", graticulePath: "" };
    }
    const fc = { type: "FeatureCollection" as const, features: features as unknown as Feature<Polygon | MultiPolygon>[] };
    const projection = geoAlbersUsa().fitExtent([[10, 10], [VIEW.w - 10, VIEW.h - 10]], fc);
    const path = geoPath(projection);
    const regionPaths = features.map((f) => ({ id: idOf(f), name: f.properties.NAME, d: path(f) ?? "" }));
    const oPath = outline ? path(outline) ?? "" : "";
    const gPath = outline ? path(geoGraticule().step([8, 8])()) ?? "" : "";
    return { paths: regionPaths, outlinePath: oPath, graticulePath: gPath };
  }, [features, outline]);

  const fmt = (id: string): string => {
    const v = valueById?.get(id);
    if (v === undefined || v === null) return "no data";
    return formatValue(v);
  };

  if (features === null) {
    return (
      <div className="rater-us-choropleth rater-us-choropleth--loading" data-testid={testId} role="img" aria-label={ariaLabel}>
        <div className="rater-us-choropleth__shimmer" aria-hidden />
      </div>
    );
  }
  if (paths.length === 0) {
    return (
      <div className="rater-us-choropleth rater-us-choropleth--empty" data-testid={testId} role="img" aria-label={ariaLabel}>
        <span className="rater-us-choropleth__empty-text">No geography to draw.</span>
      </div>
    );
  }

  return (
    <div className="rater-us-choropleth" data-testid={testId} ref={hostRef}>
      <svg
        className="rater-us-choropleth__svg"
        viewBox={`0 0 ${VIEW.w} ${VIEW.h}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={ariaLabel}
        data-testid={`${testId}-svg`}
        onMouseLeave={() => { setHover(null); onHover?.(null); }}
      >
        {geographicContext && outlinePath && (
          <>
            <defs>
              <clipPath id={`${testId}-land`}>
                <path d={outlinePath} />
              </clipPath>
            </defs>
            {/* depth halo — sits behind the regions so its glow lifts the
                landmass off the canvas (outer edge shows; inner is covered) */}
            <path className="rater-us-choropleth__halo" d={outlinePath} aria-hidden />
          </>
        )}
        {paths.map((p) => {
          const color = colorById.get(p.id);
          const isSel = selectedId === p.id;
          const dimmed = selectedId != null && !isSel;
          const cls = [
            "rater-us-choropleth__region",
            color ? "" : "is-empty",
            isSel ? "is-selected" : "",
            dimmed ? "is-dimmed" : "",
          ].filter(Boolean).join(" ");
          const label = `${p.name}${metricLabel ? ` — ${metricLabel}` : ""}: ${fmt(p.id)}`;
          return (
            <path
              key={p.id}
              className={cls}
              d={p.d}
              {...(color ? { fill: color } : {})}
              data-region-id={p.id}
              data-testid={`${testId}-region-${p.id}`}
              aria-label={label}
              {...(onSelect
                ? {
                    role: "button",
                    tabIndex: 0,
                    onKeyDown: (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelect(p.id);
                      }
                    },
                  }
                : {})}
              onClick={() => onSelect?.(p.id)}
              onMouseMove={(e) => {
                const r = hostRef.current?.getBoundingClientRect();
                setHover({ id: p.id, name: p.name, x: r ? e.clientX - r.left : 0, y: r ? e.clientY - r.top : 0 });
                onHover?.(p.id);
              }}
            >
              <title>{label}</title>
            </path>
          );
        })}
        {geographicContext && outlinePath && (
          <>
            {/* faint cartographic grid, clipped to the land silhouette */}
            <path
              className="rater-us-choropleth__graticule"
              d={graticulePath}
              clipPath={`url(#${testId}-land)`}
              aria-hidden
            />
            {/* crisp coastline on top of the choropleth */}
            <path className="rater-us-choropleth__coastline" d={outlinePath} aria-hidden />
          </>
        )}
      </svg>
      {hover && (
        <div
          className="rater-us-choropleth__tt"
          data-testid={`${testId}-tooltip`}
          style={{ left: `${Math.min(hover.x + 14, VIEW.w)}px`, top: `${hover.y + 12}px` }}
        >
          <div className="rater-us-choropleth__tt-name">{hover.name}</div>
          <div className="rater-us-choropleth__tt-value">{fmt(hover.id)}</div>
          {metricLabel && <div className="rater-us-choropleth__tt-metric">{metricLabel}</div>}
        </div>
      )}
    </div>
  );
}
