/**
 * <MapStage> — the territory, drawn as a map (P6; P8: areas, never
 * dots).
 *
 * When a geographic variable takes the stage, show WHERE the plan
 * prices — and show it as the actual geographic UNIT, filled:
 *
 *   · zip grain — each member ZCTA's real Census boundary, fetched
 *     as a per-state chunk (public/geo/zcta-shapes/{STATE}.json,
 *     built by scripts/geo/build-zcta-shapes.py from the Census
 *     1:500k cartographic files), over the member states'
 *     silhouettes with county seams faint beneath (the same bundled
 *     us-atlas geometry the Rate Lab maps use, d3-geo Albers).
 *   · state / county grain — the member shapes themselves, from the
 *     bundled catalog.
 *
 * A shape carries its territory's factor in the stage's diverging
 * language — warm above ×1.00, azure below, intensity = distance
 * from par. Compare mode strokes changed members violet; the legend
 * prints each territory's ×a → ×b pair. Members without a boundary
 * (PO-box ZIPs have no ZCTA; a state's chunk may not be bundled)
 * are counted in a note, never dropped silently — and if nothing
 * resolves, the stage falls back to the diverging bars: an honest
 * map or no map.
 */

import { useEffect, useMemo, useState, type JSX } from "react";
import { geoAlbersUsa, geoPath } from "d3-geo";
import type { Feature, MultiPolygon, Polygon } from "geojson";
import {
  fips5_to_state,
  loadGeoCatalog,
  type GeoCountyFeature,
  type GeoStateFeature,
} from "@openrater/ui";
import type { ExhibitTile, LevelValue } from "./anatomy";
import { DivergingRows } from "./rows";
import {
  divergingPaint,
  geoGrainOf,
  mapTerritoriesOf,
  memberStates,
  shapeCoordinates,
  type ZctaShapes,
} from "./geo";

const W = 640;
const H = 400;
const PAD = 26;

type AnyFeature = Feature<Polygon | MultiPolygon>;

/** Per-state boundary chunks, fetched once per session. */
const shapeCache = new Map<string, Promise<ZctaShapes | null>>();
function loadZctaShapes(state: string): Promise<ZctaShapes | null> {
  let promise = shapeCache.get(state);
  if (promise === undefined) {
    promise = fetch(`/geo/zcta-shapes/${state}.json`)
      .then((res) => (res.ok ? (res.json() as Promise<ZctaShapes>) : null))
      .catch(() => null);
    shapeCache.set(state, promise);
  }
  return promise;
}

interface FillShape {
  readonly id: string;
  readonly territoryId: string;
  readonly feature: AnyFeature;
}

type MapModel =
  | {
      readonly kind: "fill";
      readonly shapes: readonly FillShape[];
      readonly missing: readonly string[];
      /** Backdrop silhouettes (zip + county grain); [] for state grain. */
      readonly states: readonly GeoStateFeature[];
      /** County seams under zip-grain fills; [] otherwise. */
      readonly counties: readonly GeoCountyFeature[];
    }
  | { readonly kind: "fallback" };

/** Resolve every member's boundary — async, cancellable. */
async function buildModel(tile: ExhibitTile): Promise<MapModel> {
  const dim = tile.dim;
  const territories = mapTerritoriesOf(dim);
  if (dim === null || territories === null) return { kind: "fallback" };
  const grain = geoGrainOf(dim);
  if (grain === null) return { kind: "fallback" };

  if (grain === "zip") {
    const members = memberStates(territories);
    if (members.states.length === 0) return { kind: "fallback" };
    const [catalog, ...chunks] = await Promise.all([
      loadGeoCatalog(),
      ...members.states.map(loadZctaShapes),
    ]);
    const chunkByState = new Map(
      members.states.map((state, i) => [state, chunks[i] ?? null]),
    );
    const shapes: FillShape[] = [];
    const missing: string[] = [];
    for (const territory of territories) {
      for (const raw of territory.members) {
        const zip = raw.trim();
        if (zip === "") continue;
        const state = members.stateOf.get(zip);
        const packed =
          state === undefined
            ? undefined
            : chunkByState.get(state)?.shapes[zip];
        const coordinates =
          packed === undefined ? [] : shapeCoordinates(packed);
        if (coordinates.length === 0) {
          missing.push(zip);
          continue;
        }
        shapes.push({
          id: zip,
          territoryId: territory.id,
          feature: {
            type: "Feature",
            properties: {},
            geometry: { type: "MultiPolygon", coordinates },
          } as AnyFeature,
        });
      }
    }
    if (shapes.length === 0) return { kind: "fallback" };
    const states = members.states
      .map((usps) => catalog.statesByUsps.get(usps))
      .filter((f): f is GeoStateFeature => f !== undefined);
    const counties = members.states.flatMap(
      (usps) => catalog.countiesByState.get(usps) ?? [],
    );
    return { kind: "fill", shapes, missing, states, counties };
  }

  const catalog = await loadGeoCatalog();
  const shapes: FillShape[] = [];
  const missing: string[] = [];
  const backdropStates = new Set<string>();
  for (const territory of territories) {
    for (const raw of territory.members) {
      const member = raw.trim();
      if (member === "") continue;
      const feature =
        grain === "state"
          ? catalog.statesByUsps.get(member.toUpperCase())
          : catalog.countiesByGeoid.get(member);
      if (feature === undefined) {
        missing.push(member);
        continue;
      }
      shapes.push({
        id: member,
        territoryId: territory.id,
        feature: feature as unknown as AnyFeature,
      });
      if (grain === "county") {
        const state = fips5_to_state(member);
        if (state !== null) backdropStates.add(state);
      }
    }
  }
  if (shapes.length === 0) return { kind: "fallback" };
  const states = [...backdropStates]
    .sort()
    .map((usps) => catalog.statesByUsps.get(usps))
    .filter((f): f is GeoStateFeature => f !== undefined);
  return { kind: "fill", shapes, missing, states, counties: [] };
}

export function MapStage({
  tile,
  drawn,
  bValues,
}: {
  readonly tile: ExhibitTile;
  readonly drawn: readonly LevelValue[];
  readonly bValues: ReadonlyMap<string, number> | null;
}): JSX.Element {
  const [model, setModel] = useState<MapModel | null>(null);

  useEffect(() => {
    let cancelled = false;
    setModel(null);
    void buildModel(tile).then((built) => {
      if (!cancelled) setModel(built);
    });
    return () => {
      cancelled = true;
    };
  }, [tile]);

  const valueByTerritory = useMemo(
    () => new Map(tile.values.map((v) => [v.id, v.value] as const)),
    [tile.values],
  );
  const labelByTerritory = useMemo(
    () =>
      new Map(
        (mapTerritoriesOf(tile.dim) ?? []).map(
          (t) => [t.id, t.label === "" ? t.id : t.label] as const,
        ),
      ),
    [tile.dim],
  );
  const maxDev = useMemo(
    () => Math.max(...tile.values.map((v) => Math.abs(v.value - 1)), 0),
    [tile.values],
  );

  const changedIn = (territoryId: string): number | null => {
    const a = valueByTerritory.get(territoryId);
    const b = bValues?.get(territoryId);
    return a !== undefined && b !== undefined && Math.abs(b - a) > 1e-9
      ? b
      : null;
  };

  if (model === null) {
    return <p className="rater-exh__quiet">Drawing the territory…</p>;
  }
  if (model.kind === "fallback") {
    return (
      <>
        <p className="rater-exh__map-note">
          No bundled boundaries for these members — showing the levels
          instead.
        </p>
        <DivergingRows values={drawn} bValues={bValues} />
      </>
    );
  }

  const fillable = model.shapes.filter((s) =>
    valueByTerritory.has(s.territoryId),
  );
  if (fillable.length === 0) {
    return (
      <>
        <p className="rater-exh__map-note">
          No factor reaches these members — showing the levels instead.
        </p>
        <DivergingRows values={drawn} bValues={bValues} />
      </>
    );
  }

  // Fit the frame to the MEMBER shapes — the data fills the stage
  // (urban ZCTAs are tiny at full-state zoom); the state silhouette
  // and county seams crop at the edges as context, the atlas way.
  const frame: AnyFeature[] = fillable.map((s) => s.feature);
  const projection = geoAlbersUsa().fitExtent(
    [
      [PAD, PAD],
      [W - PAD, H - PAD],
    ],
    { type: "FeatureCollection", features: frame },
  );
  const path = geoPath(projection);

  const missingNote =
    model.missing.length > 0
      ? `${model.missing.length} member${model.missing.length === 1 ? "" : "s"} without a bundled boundary — drawn without ${model.missing.length === 1 ? "it" : "them"}.`
      : null;

  return (
    <>
      <svg
        className="rater-exh__map"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${tile.table.display_name} — territory map`}
      >
        {model.states.map((s) => (
          <path
            key={s.properties.USPS}
            className="rater-exh__map-state"
            d={path(s as unknown as AnyFeature) ?? ""}
          />
        ))}
        {model.counties.map((c) => (
          <path
            key={c.properties.GEOID}
            className="rater-exh__map-county"
            d={path(c as unknown as AnyFeature) ?? ""}
          />
        ))}
        {fillable.map((s) => {
          const value = valueByTerritory.get(s.territoryId) as number;
          const b = changedIn(s.territoryId);
          const paint = divergingPaint(value, maxDev);
          const d = path(s.feature) ?? "";
          const label = labelByTerritory.get(s.territoryId) ?? s.territoryId;
          return (
            <g key={s.id}>
              <path
                className={
                  paint.up
                    ? "rater-exh__map-shape rater-exh__map-shape--up"
                    : "rater-exh__map-shape rater-exh__map-shape--down"
                }
                d={d}
                fillOpacity={paint.alpha}
                strokeOpacity={paint.alpha}
              >
                <title>
                  {`${s.id} · ${label} · ×${value.toFixed(2)}${b !== null ? ` → ×${b.toFixed(2)}` : ""}`}
                </title>
              </path>
              {b !== null ? (
                <path className="rater-exh__map-ring" d={d} />
              ) : null}
            </g>
          );
        })}
      </svg>

      {/* The legend — every territory, its paint, its exact factor. */}
      <div className="rater-exh__map-legend">
        {tile.values.map((v) => {
          const paint = divergingPaint(v.value, maxDev);
          const b = changedIn(v.id);
          return (
            <span className="rater-exh__map-key" key={v.id}>
              <span
                className={
                  paint.up
                    ? "rater-exh__map-key-dot rater-exh__map-key-dot--up"
                    : "rater-exh__map-key-dot rater-exh__map-key-dot--down"
                }
                style={{ opacity: paint.alpha }}
                aria-hidden="true"
              />
              {v.label}
              <span className="rater-exh__map-key-val">
                ×{v.value.toFixed(2)}
                {b !== null ? (
                  <span className="rater-exh__map-key-b"> → ×{b.toFixed(2)}</span>
                ) : null}
              </span>
            </span>
          );
        })}
      </div>
      {missingNote !== null ? (
        <p className="rater-exh__map-note">{missingNote}</p>
      ) : null}
    </>
  );
}
