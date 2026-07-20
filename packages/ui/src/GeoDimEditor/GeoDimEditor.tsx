/**
 * Brief 44 PR 44.3 — `<GeoDimEditor>`.
 *
 * The 3-tab post-creation editor for a geographic dimension:
 *
 *   · Levels       — canonical + custom level list (functional in PR 44.3)
 *   · Map          — <UsChoropleth> scope preview (maps next-gen; was
 *                    the MapLibre <GeoMapEditor> through PR 44.4)
 *   · Territories  — placeholder; <TerritoryGrouping> lands in PR 44.7
 *
 * The editor reads the dim's geo_granularity / geo_scope / geo_territories
 * (Brief 44 §3.1 substrate) and surfaces them in the header so the
 * actuary sees the locked shape at a glance.
 *
 * Visual lock: Frame 3 from
 * `rate-lab/frontend/public/mockup/44-geographic-rating.html`.
 *
 * Scope of PR 44.3 (intentionally bounded):
 *   ✓ Header + meta row + tab strip
 *   ✓ Levels list — display + add custom + delete custom + reset
 *     from scope (auto-seed via shared geoLevelSeeds)
 *   ✓ Map / Territories tabs as static placeholders pointing to the
 *     follow-up PRs
 *   ✗ Modal / drawer wrap — consumer's choice (matches GeoDimWizard
 *     convention)
 *   ✗ Scope widening UI — deferred to a polish pass after PR 44.4
 *   ✗ Used-in panel — re-uses Brief 30 <UsedInPanel> at consumer site
 *   ✗ Delete-with-impact modal — same; consumers wrap <DimensionDeletePrompt>
 */

import { useMemo, useRef, useState } from "react";
import { ChevronDown, ClipboardPaste, Upload } from "lucide-react";
import { Button, Menu } from "@openrater/design-system";

import {
  STATE_LABEL_BY_CODE,
  getLevelsForScope,
  type GeoGranularity,
  type GeoScope,
  type SeedLevel,
} from "../GeoDimWizard/geoLevelSeeds";
import { UsChoropleth } from "../UsChoropleth";
import { SavePill } from "../SavePill/SavePill";
import { TerritoryGrouping } from "../TerritoryGrouping";
import {
  parseZipTerritoryCsv,
  type ImportedTerritory,
  type ZipTerritoryImportReport,
} from "./zipTerritoryImport";

import "./GeoDimEditor.css";

// ──────────────────────────────────────────────────────────────────────
// Public types
// ──────────────────────────────────────────────────────────────────────

/** Shape the editor operates on. Mirrors Brief 44 §3.1 substrate. */
export interface GeoDimEditorDimension {
  readonly dim_id: string;
  readonly display_name: string;
  readonly geo_granularity: GeoGranularity;
  readonly geo_scope: GeoScope;
  readonly geo_territories: ReadonlyArray<{
    readonly id: string;
    readonly label: string;
    readonly members: readonly string[];
  }>;
  readonly levels: readonly SeedLevel[];
}

/** Editor tabs (Brief 44 §1.3 IA). */
export type GeoDimEditorTab = "levels" | "map" | "territories";

/**
 * Brief 66 §3.3 — DimensionRow → the editor's input shape. Lives here
 * (not in the legacy workspace) so both surfaces share one conversion
 * and the legacy file can delete at the cutover.
 */
export function dimensionRowToGeoDim(row: {
  readonly id: string;
  readonly display_name: string;
  readonly geo_granularity?: GeoGranularity;
  readonly geo_scope?: GeoScope;
  readonly geo_territories?: GeoDimEditorDimension["geo_territories"];
  readonly levels?: ReadonlyArray<{
    readonly kind: string;
    readonly id: string;
    readonly label: string;
  }>;
}): GeoDimEditorDimension {
  const granularity: GeoGranularity = row.geo_granularity ?? "state";
  const scope: GeoScope = row.geo_scope ?? { kind: "national" };
  const territories: GeoDimEditorDimension["geo_territories"] =
    row.geo_territories ?? [];
  const rowLevels = row.levels ?? [];
  return {
    dim_id: row.id,
    display_name: row.display_name,
    geo_granularity: granularity,
    geo_scope: scope,
    geo_territories: territories,
    levels: rowLevels
      .filter((l) => l.kind === "categorical")
      .map((l) => ({ kind: "categorical", id: l.id, label: l.label })),
  };
}

export interface GeoDimEditorProps {
  /** The dimension being edited. Source of truth for all rendering. */
  readonly dimension: GeoDimEditorDimension;

  /** Active tab — controlled. */
  readonly activeTab: GeoDimEditorTab;
  readonly onTabChange: (tab: GeoDimEditorTab) => void;

  /** Edits. Consumer persists; the primitive is stateless beyond UI. */
  readonly onDisplayNameChange: (name: string) => void;
  readonly onLevelsChange: (levels: SeedLevel[]) => void;
  /**
   * Brief 44 PR 44.7 — Called when the user edits territories on the
   * Territories tab (drag-bucket). When omitted, the Territories tab
   * renders read-only.
   */
  readonly onTerritoriesChange?: (
    next: ReadonlyArray<{
      readonly id: string;
      readonly label: string;
      readonly members: readonly string[];
    }>,
  ) => void;

  /**
   * Brief 51 / ADR-0038 — called when the user imports a ZIP→territory CSV on
   * the Levels tab. Commits the seeded `levels` AND the `geo_territories`
   * grouping TOGETHER (one commit — committing them as two separate changes
   * would race on a stale dimension snapshot). When omitted, the import
   * affordance is hidden.
   */
  readonly onImportLevelsAndTerritories?: (
    levels: readonly SeedLevel[],
    territories: readonly ImportedTerritory[],
  ) => void;

  /** Optional: navigation back to the dimensions list (header crumb). */
  readonly onBack?: () => void;

  /**
   * Brief 66 §3.3 — suppress the editor's own crumb/name/meta header.
   * The dims2 detail pane owns the dimension's identity row (InlineEdit
   * name + save pill + shape tile); the editor contributes ONLY its
   * tab strip + tab bodies. Default false (the legacy center-pane
   * mount keeps the full chrome until the cutover deletes it).
   */
  readonly headless?: boolean;

  /**
   * Optional autosave indicator. When omitted, the pill is hidden.
   * Brief 30 convention reused.
   */
  readonly saveState?: "saved" | "saving" | "dirty" | "error";
}

// ──────────────────────────────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────────────────────────────

export function GeoDimEditor({
  dimension,
  activeTab,
  onTabChange,
  onDisplayNameChange,
  onLevelsChange,
  onTerritoriesChange,
  onImportLevelsAndTerritories,
  onBack,
  headless = false,
  saveState,
}: GeoDimEditorProps): JSX.Element {
  const {
    dim_id,
    display_name,
    geo_granularity,
    geo_scope,
    geo_territories,
    levels,
  } = dimension;

  // Canonical seed for this dim's (granularity, scope). Anything in
  // `levels` whose id is NOT in this set is a user-added custom level.
  const seedIds = useMemo(
    () => new Set(getLevelsForScope(geo_granularity, geo_scope).map((l) => l.id)),
    [geo_granularity, geo_scope],
  );

  const scopeText = scopeToText(geo_scope);
  const grainLabel = grainToLabel(geo_granularity);

  return (
    <section className="rater-geo-editor" aria-label={`Geographic dimension: ${display_name}`}>
      {!headless && (
      <>
      <header className="rater-geo-editor__head">
        {onBack && (
          <button
            type="button"
            className="rater-geo-editor__crumb"
            onClick={onBack}
          >
            ← All dimensions
          </button>
        )}
        {saveState && <SavePill state={saveState} />}
      </header>

      <div className="rater-geo-editor__title-row">
        <span
          className="rater-geo-editor__shape-glyph"
          aria-label="geographic dimension"
          title="Geographic dimension"
        >
          {/* Compact SVG: stylized stack of map polygons (BEM, no emojis). */}
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            aria-hidden="true"
          >
            <path d="M3 7L9 5l6 2 6-2v14l-6 2-6-2-6 2V7z" />
          </svg>
        </span>
        <input
          className="rater-geo-editor__name"
          value={display_name}
          onChange={(e) => onDisplayNameChange(e.target.value)}
          aria-label="Display name"
        />
        <span className="rater-geo-editor__shape-badge">
          geographic · {grainLabel} · {levels.length.toLocaleString()} levels
        </span>
      </div>

      <div className="rater-geo-editor__meta-row">
        <code>scope: {scopeText}</code>
        <code>granularity: {geo_granularity}</code>
        <code>id: {dim_id}</code>
      </div>
      </>
      )}

      <TabBar
        active={activeTab}
        onChange={onTabChange}
        levelCount={levels.length}
        territoryCount={geo_territories.length}
      />

      <div className="rater-geo-editor__body">
        {activeTab === "levels" && (
          <LevelsTab
            dimension={dimension}
            seedIds={seedIds}
            onLevelsChange={onLevelsChange}
            onImport={onImportLevelsAndTerritories}
          />
        )}
        {activeTab === "map" && (
          <MapTab dimension={dimension} />
        )}
        {activeTab === "territories" && (
          <TerritoriesTab
            dimension={dimension}
            onTerritoriesChange={onTerritoriesChange}
          />
        )}
      </div>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────────────────────────────

interface TabBarProps {
  readonly active: GeoDimEditorTab;
  readonly onChange: (tab: GeoDimEditorTab) => void;
  readonly levelCount: number;
  readonly territoryCount: number;
}

function TabBar({
  active,
  onChange,
  levelCount,
  territoryCount,
}: TabBarProps): JSX.Element {
  const tabs: ReadonlyArray<{
    readonly id: GeoDimEditorTab;
    readonly label: string;
    readonly count?: number;
  }> = [
    { id: "levels", label: "Levels", count: levelCount },
    { id: "map", label: "Map" },
    { id: "territories", label: "Territories", count: territoryCount },
  ];
  return (
    <div className="rater-geo-editor__tabbar" role="tablist">
      {tabs.map((t) => {
        const isActive = active === t.id;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={`rater-geo-editor__tab${isActive ? " is-active" : ""}`}
            onClick={() => onChange(t.id)}
          >
            {t.label}
            {t.count !== undefined && (
              <span className="rater-geo-editor__tab-count">
                {t.count.toLocaleString()}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

interface LevelsTabProps {
  readonly dimension: GeoDimEditorDimension;
  readonly seedIds: ReadonlySet<string>;
  readonly onLevelsChange: (levels: SeedLevel[]) => void;
  readonly onImport?: GeoDimEditorProps["onImportLevelsAndTerritories"];
}

function LevelsTab({
  dimension,
  seedIds,
  onLevelsChange,
  onImport,
}: LevelsTabProps): JSX.Element {
  const { geo_granularity, geo_scope, levels } = dimension;
  const [addOpen, setAddOpen] = useState(false);
  const [newId, setNewId] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [resetConfirm, setResetConfirm] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importReport, setImportReport] =
    useState<ZipTerritoryImportReport | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  // I4 — search/filter the level list. A ZIP-granularity dim can carry 747+
  // levels; without a filter, finding/editing one means scrolling the lot.
  const [levelQuery, setLevelQuery] = useState("");
  // F12 — paste-import twin of "Import CSV" (keyboard/headless; no native file
  // dialog). Reuses the same parseZipTerritoryCsv → onImport commit, so paste
  // and file are interchangeable + consistent with the class-table paste box.
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");

  const customCount = levels.filter((l) => !seedIds.has(l.id)).length;
  const visibleLevels = useMemo(() => {
    const q = levelQuery.trim().toLowerCase();
    if (q === "") return levels;
    return levels.filter(
      (l) =>
        l.id.toLowerCase().includes(q) ||
        (l.label ?? "").toLowerCase().includes(q),
    );
  }, [levels, levelQuery]);

  function handleReset(): void {
    const reseeded = getLevelsForScope(geo_granularity, geo_scope);
    onLevelsChange([...reseeded]);
    setResetConfirm(false);
  }

  // F12 — the shared parse + commit, used by BOTH file-import and paste-import.
  // Returns whether the import succeeded so the paste form can stay open (with
  // the error shown above it) on a bad paste instead of closing + losing the text.
  function handleImportText(text: string): boolean {
    const result = parseZipTerritoryCsv(text);
    if (result.error) {
      setImportError(result.error);
      setImportReport(null);
      return false;
    }
    setImportError(null);
    setImportReport(result.report);
    // One commit — levels + territories together (ADR-0038).
    onImport?.(result.levels, result.territories);
    return true;
  }

  function handleImportFile(file: File): void {
    const reader = new FileReader();
    reader.onerror = () => {
      setImportError("Couldn't read the file.");
      setImportReport(null);
    };
    reader.onload = () => {
      handleImportText(typeof reader.result === "string" ? reader.result : "");
    };
    reader.readAsText(file);
  }

  function handleAdd(): void {
    const id = newId.trim();
    const label = newLabel.trim() || id;
    if (!id) return;
    if (levels.some((l) => l.id === id)) {
      // Duplicate id — quiet no-op; consumer should surface a toast.
      return;
    }
    onLevelsChange([
      ...levels,
      { kind: "categorical", id, label },
    ]);
    setNewId("");
    setNewLabel("");
    setAddOpen(false);
  }

  function handleDelete(id: string): void {
    onLevelsChange(levels.filter((l) => l.id !== id));
  }

  const seedCount = getLevelsForScope(geo_granularity, geo_scope).length;
  const hasSeed = seedCount > 0;

  return (
    <div className="rater-geo-editor__levels">
      <div className="rater-geo-editor__levels-head">
        <span className="rater-geo-editor__levels-count">
          {levels.length} level{levels.length === 1 ? "" : "s"}
          {customCount > 0 && (
            <span className="rater-geo-editor__levels-custom-count">
              {" · "}
              {customCount} custom
            </span>
          )}
        </span>
        <span className="rater-geo-editor__levels-spacer" />
        {onImport && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="rater-geo-editor__file-input"
              aria-label="Import a ZIP to territory CSV"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleImportFile(f);
                // Reset so re-selecting the same file fires onChange again.
                e.target.value = "";
              }}
            />
            <button
              type="button"
              className="rater-geo-editor__action"
              onClick={() => fileInputRef.current?.click()}
              title="Import a ZIP→territory CSV — seeds the ZIP levels AND the territory grouping in one step"
            >
              <Upload size={13} aria-hidden="true" /> Import CSV
            </button>
            <button
              type="button"
              className="rater-geo-editor__action"
              onClick={() => setPasteOpen((v) => !v)}
              title="Paste a ZIP→territory CSV (zip,territory[,label] per line) — no file needed"
            >
              <ClipboardPaste size={13} aria-hidden="true" />{" "}
              {pasteOpen ? "Cancel" : "Paste"}
            </button>
          </>
        )}
        {hasSeed && (
          <button
            type="button"
            className="rater-geo-editor__action"
            onClick={() => setResetConfirm(true)}
            title="Re-seed levels from the canonical scope (replaces all levels)"
          >
            Reset from scope
          </button>
        )}
        <button
          type="button"
          className="rater-geo-editor__action"
          onClick={() => setAddOpen((v) => !v)}
        >
          {addOpen ? "Cancel" : "+ Add custom level"}
        </button>
      </div>

      {importError && (
        <div
          className="rater-geo-editor__import-msg rater-geo-editor__import-msg--error"
          role="alert"
        >
          <strong>Import failed.</strong> {importError}
        </div>
      )}
      {importReport && (
        <div className="rater-geo-editor__import-msg" role="status">
          <strong>
            Imported {importReport.levelsCreated.toLocaleString()} level
            {importReport.levelsCreated === 1 ? "" : "s"}
          </strong>
          {" · "}
          {importReport.territories.length} territor
          {importReport.territories.length === 1 ? "y" : "ies"}
          {importReport.territories.length > 0 && (
            <>
              {" ("}
              {importReport.territories
                .map((t) => `${t.id}: ${t.count}`)
                .join(", ")}
              {")"}
            </>
          )}
          {importReport.skipped.length > 0 && (
            <span className="rater-geo-editor__import-warn">
              {" · "}
              {importReport.skipped.length} row
              {importReport.skipped.length === 1 ? "" : "s"} skipped
            </span>
          )}
          {importReport.duplicateZips.length > 0 && (
            <span className="rater-geo-editor__import-warn">
              {" · "}
              {importReport.duplicateZips.length} duplicate ZIP
              {importReport.duplicateZips.length === 1 ? "" : "s"} (last row won)
            </span>
          )}
        </div>
      )}

      {pasteOpen && (
        <form
          className="rater-geo-editor__paste-form"
          onSubmit={(e) => {
            e.preventDefault();
            // Keep the form open (with the error above) on a bad paste.
            if (handleImportText(pasteText)) {
              setPasteText("");
              setPasteOpen(false);
            }
          }}
        >
          <textarea
            className="rater-geo-editor__paste-input"
            placeholder={
              "Paste zip,territory[,label] per line — e.g.\n66101,t1,Kansas City\n66044,t2,Lawrence"
            }
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            aria-label="Paste a ZIP to territory CSV"
            rows={5}
            autoFocus
          />
          <div className="rater-geo-editor__paste-actions">
            <button
              type="button"
              className="rater-geo-editor__action"
              onClick={() => {
                setPasteOpen(false);
                setPasteText("");
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rater-geo-editor__add-submit"
              disabled={!pasteText.trim()}
            >
              Import
            </button>
          </div>
        </form>
      )}

      {addOpen && (
        <form
          className="rater-geo-editor__add-form"
          onSubmit={(e) => {
            e.preventDefault();
            handleAdd();
          }}
        >
          <input
            className="rater-geo-editor__add-input rater-geo-editor__add-input--id"
            placeholder="id (e.g. MILITARY)"
            value={newId}
            onChange={(e) => setNewId(e.target.value)}
            aria-label="New level id"
            autoFocus
          />
          <input
            className="rater-geo-editor__add-input"
            placeholder="label (optional; falls back to id)"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            aria-label="New level label"
          />
          <button
            type="submit"
            className="rater-geo-editor__add-submit"
            disabled={
              !newId.trim() || levels.some((l) => l.id === newId.trim())
            }
          >
            Add
          </button>
        </form>
      )}

      {resetConfirm && (
        <div className="rater-geo-editor__reset-confirm" role="alert">
          <span className="rater-geo-editor__reset-confirm-text">
            Replace all {levels.length} level{levels.length === 1 ? "" : "s"}{" "}
            with {seedCount} from the canonical scope?
            {customCount > 0 && (
              <strong>
                {" "}
                {customCount} custom level{customCount === 1 ? "" : "s"} will
                be removed.
              </strong>
            )}
          </span>
          <span className="rater-geo-editor__levels-spacer" />
          <button
            type="button"
            className="rater-geo-editor__action"
            onClick={() => setResetConfirm(false)}
          >
            Cancel
          </button>
          <button
            type="button"
            className="rater-geo-editor__action rater-geo-editor__action--danger"
            onClick={handleReset}
          >
            Reset
          </button>
        </div>
      )}

      {/* I4 — filter the level list (kicks in once it's long enough to
          warrant it; a 747-ZIP dim is unusable without it). */}
      {levels.length > 12 && (
        <input
          type="search"
          className="rater-geo-editor__levels-search"
          placeholder={`Search ${levels.length} levels by code or name…`}
          value={levelQuery}
          onChange={(e) => setLevelQuery(e.target.value)}
          aria-label="Search levels"
          data-testid="rater-geo-editor-levels-search"
        />
      )}

      <ul className="rater-geo-editor__levels-list" role="list">
        {levels.length === 0 ? (
          <li className="rater-geo-editor__levels-empty">
            {hasSeed
              ? 'No levels yet. Use "Reset from scope" to auto-seed, or import / paste a CSV, or add a custom level.'
              : "No levels yet. Import a CSV, paste a ZIP→territory list, or add a custom level."}
          </li>
        ) : visibleLevels.length === 0 ? (
          <li className="rater-geo-editor__levels-empty">
            No levels match “{levelQuery.trim()}”.
          </li>
        ) : (
          visibleLevels.map((l) => {
            const isCustom = !seedIds.has(l.id);
            return (
              <li key={l.id} className="rater-geo-editor__levels-row">
                <span className="rater-geo-editor__levels-key">{l.id}</span>
                <span className="rater-geo-editor__levels-label">{l.label}</span>
                {/* B1 — the 1fr label column pushes the badge + delete right; the
                    old explicit spacer made FIVE children in a FOUR-track grid,
                    so the delete ✕ wrapped onto a second line (every row 68px). */}
                {isCustom && (
                  <span className="rater-geo-editor__levels-badge">custom</span>
                )}
                {isCustom && (
                  <button
                    type="button"
                    className="rater-geo-editor__levels-delete"
                    onClick={() => handleDelete(l.id)}
                    title="Remove this custom level"
                    aria-label={`Remove ${l.label}`}
                  >
                    ✕
                  </button>
                )}
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}

interface MapTabProps {
  readonly dimension: GeoDimEditorDimension;
}

function MapTab({ dimension }: MapTabProps): JSX.Element {
  const { geo_granularity, geo_scope } = dimension;
  // The scope determines which states are available in the flip dropdown.
  // For "national" we expose all 51; for "subset" we expose only the
  // picked states.
  const availableStates: readonly string[] =
    geo_scope.kind === "national"
      ? Object.keys(STATE_LABEL_BY_CODE)
      : geo_scope.states;

  // Default to the first available state. Component is stateful around
  // the active flip choice — uncontrolled v1.
  const initialState = availableStates[0] ?? "WI";
  const [flipState, setFlipState] = useState(initialState);

  // Empty scope (e.g. mid-creation) — surface a hint instead of an
  // empty canvas.
  if (availableStates.length === 0) {
    return (
      <div
        className="rater-geo-editor__placeholder"
        role="region"
        aria-label="No state in scope"
      >
        <h3 className="rater-geo-editor__placeholder-title">No states in scope</h3>
        <p className="rater-geo-editor__placeholder-body">
          Widen the scope (Levels tab → Reset from scope is a no-op until
          the dim has at least one state). The map renders once the dim
          has a state to focus on.
        </p>
      </div>
    );
  }

  // ZIP grain has no polygon geometry (us-atlas is state + county) — the
  // old MapLibre canvas rendered blank here; say so instead.
  if (geo_granularity === "zip") {
    return (
      <div
        className="rater-geo-editor__placeholder"
        role="region"
        aria-label="ZIP map unavailable"
      >
        <h3 className="rater-geo-editor__placeholder-title">
          ZIP-level map unavailable
        </h3>
        <p className="rater-geo-editor__placeholder-body">
          The map draws states and counties. This dim is ZIP-grain — review
          its {availableStates.length} state
          {availableStates.length === 1 ? "" : "s"} of scope on the Levels tab.
        </p>
      </div>
    );
  }

  // State grain → tint the in-scope states so the footprint reads at a
  // glance (national draws all 51). County grain → one state's counties,
  // neutral, with a flip picker. Raw hex: the choropleth `fill` attribute
  // can't read CSS vars (mirrors --rater-cat-choropleth-4 / azure-600).
  const colorById = new Map<string, string>();
  if (geo_granularity === "state") {
    for (const s of availableStates) colorById.set(s.toUpperCase(), "#2563eb");
  }

  return (
    <div className="rater-geo-editor__map">
      {geo_granularity === "county" ? (
        <div className="rater-geo-editor__map-head">
          <Menu>
            <Menu.Trigger>
              <Button variant="ghost" size="sm" iconAfter={<ChevronDown />}>
                State: {flipState}
              </Button>
            </Menu.Trigger>
            <Menu.Items aria-label="Pick a state">
              {availableStates.map((s) => (
                <Menu.Item key={s} onSelect={() => setFlipState(s)}>
                  {STATE_LABEL_BY_CODE[s] ?? s}
                </Menu.Item>
              ))}
            </Menu.Items>
          </Menu>
        </div>
      ) : null}
      <UsChoropleth
        granularity={geo_granularity}
        {...(geo_granularity === "county" ? { focusState: flipState } : {})}
        colorById={colorById}
        ariaLabel="Geographic scope preview"
        testId="rater-geo-editor-map"
      />
    </div>
  );
}

interface TerritoriesTabProps {
  readonly dimension: GeoDimEditorDimension;
  readonly onTerritoriesChange?: GeoDimEditorProps["onTerritoriesChange"];
}

function TerritoriesTab({
  dimension,
  onTerritoriesChange,
}: TerritoriesTabProps): JSX.Element {
  // Brief 44 PR 44.7 — Drag-bucket grouping. When the consumer hasn't
  // wired onTerritoriesChange, render the read-only fallback (which
  // is rare — the editor lifecycle always wires this in production).
  if (!onTerritoriesChange) {
    return (
      <div
        className="rater-geo-editor__placeholder"
        role="region"
        aria-label="Territories tab (read-only)"
      >
        <h3 className="rater-geo-editor__placeholder-title">
          Territories tab is read-only
        </h3>
        <p className="rater-geo-editor__placeholder-body">
          The consumer hasn't wired <code>onTerritoriesChange</code>.
          Pass that prop to enable drag-bucket editing.
        </p>
      </div>
    );
  }
  return (
    <TerritoryGrouping
      levels={dimension.levels}
      territories={dimension.geo_territories}
      onChange={onTerritoriesChange}
    />
  );
}

// ──────────────────────────────────────────────────────────────────────
// Pure helpers
// ──────────────────────────────────────────────────────────────────────

function scopeToText(scope: GeoScope): string {
  if (scope.kind === "national") return "national (50 + DC)";
  if (scope.states.length === 0) return "(none)";
  // Show up to 6 codes inline; collapse the tail.
  const head = scope.states.slice(0, 6).join(", ");
  if (scope.states.length <= 6) return head;
  return `${head}, +${scope.states.length - 6} more`;
}

function grainToLabel(g: GeoGranularity): string {
  if (g === "state") return "state";
  if (g === "county") return "county";
  return "zip";
}

// Internal — kept for potential consumer use; not re-exported.
export const _scopeToText = scopeToText;
export const _STATE_LABEL_BY_CODE = STATE_LABEL_BY_CODE;
