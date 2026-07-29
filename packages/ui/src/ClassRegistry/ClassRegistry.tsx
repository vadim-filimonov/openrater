/**
 * <ClassRegistry> — the writable per-plan class registry (Brief 51).
 *
 * Replaces the read-only `<ClassBrowser>` + `<ClassDetailPane>` mount on
 * `/rate-lab/:id/classification`. Master/detail, but every affordance the
 * old surface lacked is here:
 *
 *   · search + family filter (carried from ClassBrowser)
 *   · per-class CREATE / EDIT / DELETE via the standard drawer (P-N8)
 *   · bulk CSV import (the acceptance path for a real class_table)
 *   · MULTI-SELECT + "Add N classes to plan" → registers the class_code
 *     classification dimension scoped to the selection
 *
 * The detail pane surfaces the DERIVED rating attributes (prop_rate_number
 * / liab_class_group / liab_exposure_base) — the values that drive the
 * structural dimensions a factor table keys off (ADR-0035).
 *
 * Presentational + self-contained: the parent (rate-lab route) supplies
 * the data + the four write callbacks and owns the network; this owns the
 * list/filter/select/drawer/import UI.
 */

import { useMemo, useState } from "react";
import { FileUp, Pencil, Plus, Search } from "lucide-react";
import { Button, Checkbox } from "@openrater/design-system";
import { ClassBulkImportOverlay } from "./ClassBulkImportOverlay";
import { ClassEditDrawer } from "./ClassEditDrawer";
import {
  emptyDraft,
  recordToDraft,
  type ClassDraft,
  type ClassRegistryRecord,
} from "./types";
import "./ClassRegistry.css";

export interface ClassRegistryProps {
  readonly classes: readonly ClassRegistryRecord[];
  readonly onUpsertClass: (draft: ClassDraft) => void | Promise<void>;
  readonly onDeleteClass: (classCode: string) => void | Promise<void>;
  readonly onBulkImport: (
    rows: ClassDraft[],
    mode: "merge" | "replace",
  ) => void | Promise<void>;
  /** Register / update the class_code classification dimension scoped to
   *  the selected codes. */
  readonly onAddToPlan: (classCodes: string[]) => void | Promise<void>;
  /** When true, the class_code dimension already exists — the CTA reads
   *  "Update plan dimension" rather than "Add to plan". */
  readonly classDimensionExists?: boolean;
  /** FCA #30 (finding 147) — the plan's OWN classification dimension,
   *  when one exists. The registry and the dimension are SEPARATE
   *  stores: a workbook build creates the dimension directly, so an
   *  empty registry beside a 30-class dimension used to read "No
   *  classes yet / 0 classes" — data loss to anyone arriving from
   *  Dimensions. The empty state leads with the truth instead. */
  readonly planClassDimension?: {
    readonly name: string;
    readonly levelCount: number;
  } | null;
  readonly testId?: string;
}

export function ClassRegistry(props: ClassRegistryProps): JSX.Element {
  const {
    classes,
    onUpsertClass,
    onDeleteClass,
    onBulkImport,
    onAddToPlan,
    classDimensionExists = false,
    planClassDimension = null,
    testId = "rater-class-registry",
  } = props;

  const [query, setQuery] = useState("");
  const [family, setFamily] = useState("");
  const [detailCode, setDetailCode] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  const [drawer, setDrawer] = useState<{
    open: boolean;
    mode: "add" | "edit";
    draft: ClassDraft;
  }>({ open: false, mode: "add", draft: emptyDraft() });
  const [drawerError, setDrawerError] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);

  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [adding, setAdding] = useState(false);

  const existingCodes = useMemo(
    () => new Set(classes.map((c) => c.class_code)),
    [classes],
  );

  const families = useMemo(() => {
    const set = new Set<string>();
    for (const c of classes) if (c.family) set.add(c.family);
    return Array.from(set).sort();
  }, [classes]);

  const filtered = useMemo(() => {
    return classes.filter((c) => {
      if (family && c.family !== family) return false;
      if (query) {
        const q = query.toLowerCase();
        const hay = `${c.class_code} ${c.display_name} ${c.family ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [classes, query, family]);

  const detail = useMemo(
    () => classes.find((c) => c.class_code === detailCode) ?? null,
    [classes, detailCode],
  );

  // ── selection ────────────────────────────────────────────────────
  const toggleSelect = (code: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };
  const selectAllFiltered = (): void =>
    setSelected(new Set(filtered.map((c) => c.class_code)));
  const clearSelection = (): void => setSelected(new Set());

  // ── drawer (add / edit) ──────────────────────────────────────────
  const openAdd = (): void => {
    setDrawerError(undefined);
    setDrawer({ open: true, mode: "add", draft: emptyDraft() });
  };
  const openEdit = (rec: ClassRegistryRecord): void => {
    setDrawerError(undefined);
    setDrawer({ open: true, mode: "edit", draft: recordToDraft(rec) });
  };
  const closeDrawer = (): void => setDrawer((d) => ({ ...d, open: false }));

  const saveDraft = async (): Promise<void> => {
    setDrawerError(undefined);
    setSaving(true);
    try {
      await onUpsertClass(drawer.draft);
      setDetailCode(drawer.draft.class_code);
      closeDrawer();
    } catch (e) {
      setDrawerError(e instanceof Error ? e.message : "Couldn't save the class.");
    } finally {
      setSaving(false);
    }
  };

  const deleteDraft = async (): Promise<void> => {
    setSaving(true);
    try {
      await onDeleteClass(drawer.draft.class_code);
      if (detailCode === drawer.draft.class_code) setDetailCode(null);
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(drawer.draft.class_code);
        return next;
      });
      closeDrawer();
    } catch (e) {
      setDrawerError(e instanceof Error ? e.message : "Couldn't delete the class.");
    } finally {
      setSaving(false);
    }
  };

  // ── import ───────────────────────────────────────────────────────
  const runImport = async (
    rows: ClassDraft[],
    mode: "merge" | "replace",
  ): Promise<void> => {
    setImporting(true);
    try {
      await onBulkImport(rows, mode);
      setImportOpen(false);
    } finally {
      setImporting(false);
    }
  };

  // ── add to plan ──────────────────────────────────────────────────
  const addToPlan = async (): Promise<void> => {
    if (selected.size === 0) return;
    setAdding(true);
    try {
      await onAddToPlan([...selected]);
      clearSelection();
    } finally {
      setAdding(false);
    }
  };

  const isEmpty = classes.length === 0;

  return (
    <div className="rater-class-registry" data-testid={testId} role="region" aria-label="Class registry">
      {/* ── master column ── */}
      <div className="rater-class-registry__master">
        <div className="rater-class-registry__toolbar">
          <div className="rater-class-registry__search-wrap">
            <Search size={14} aria-hidden className="rater-class-registry__search-icon" />
            <input
              type="search"
              className="rater-class-registry__search"
              placeholder="Search by code, name, or family…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search classes"
            />
          </div>
          <select
            className="rater-class-registry__select"
            value={family}
            onChange={(e) => setFamily(e.target.value)}
            aria-label="Filter by family"
          >
            <option value="">All families</option>
            {families.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
          <Button variant="ghost" size="sm" onClick={() => setImportOpen(true)} data-testid={`${testId}-import`}>
            <FileUp size={14} aria-hidden /> Import
          </Button>
          <Button variant="primary" size="sm" onClick={openAdd} data-testid={`${testId}-new`}>
            <Plus size={14} aria-hidden /> New class
          </Button>
        </div>

        <div className="rater-class-registry__meta" role="status" aria-live="polite">
          <span>
            {filtered.length === classes.length
              ? `${classes.length} ${classes.length === 1 ? "class" : "classes"}`
              : `${filtered.length} of ${classes.length}`}
          </span>
          {filtered.length > 0 && (
            <button
              type="button"
              className="rater-class-registry__select-all"
              onClick={
                selected.size === filtered.length ? clearSelection : selectAllFiltered
              }
            >
              {selected.size === filtered.length ? "Clear selection" : "Select all"}
            </button>
          )}
        </div>

        {isEmpty ? (
          <div className="rater-class-registry__empty" role="status">
            <div className="rater-class-registry__empty-hero" aria-hidden>
              <FileUp size={24} />
            </div>
            {/* FCA #30 (finding 147) — when the plan already carries a
                classification dimension (workbook builds create it
                directly), say so: "No classes yet" on a 30-class plan
                read as data loss. */}
            {planClassDimension ? (
              <>
                <div className="rater-class-registry__empty-title">
                  This registry is empty — the plan&rsquo;s classes aren&rsquo;t
                </div>
                <p className="rater-class-registry__empty-hint">
                  {planClassDimension.levelCount} class
                  {planClassDimension.levelCount === 1 ? "" : "es"} live on the
                  plan&rsquo;s <b>{planClassDimension.name}</b> dimension
                  (built from the workbook) — see the Dimensions tab. This
                  registry is a separate store for pasted class tables and
                  per-class attributes.
                </p>
              </>
            ) : (
              <>
                <div className="rater-class-registry__empty-title">No classes yet</div>
                <p className="rater-class-registry__empty-hint">
                  Paste a class table to load a filing&rsquo;s codes, or add one by hand.
                </p>
              </>
            )}
            <div className="rater-class-registry__empty-cta">
              <Button variant="primary" size="sm" onClick={() => setImportOpen(true)}>
                <FileUp size={14} aria-hidden /> Paste a class table
              </Button>
              <Button variant="ghost" size="sm" onClick={openAdd}>
                <Plus size={14} aria-hidden /> New class
              </Button>
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="rater-class-registry__empty" role="status">
            <div className="rater-class-registry__empty-title">No classes match your filters</div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setQuery("");
                setFamily("");
              }}
            >
              Clear filters
            </Button>
          </div>
        ) : (
          <ul className="rater-class-registry__list" aria-label="Classes">
            {filtered.map((c) => {
              const isDetail = c.class_code === detailCode;
              const isChecked = selected.has(c.class_code);
              return (
                <li
                  key={c.class_code}
                  className={
                    "rater-class-registry__row" +
                    (isDetail ? " rater-class-registry__row--active" : "") +
                    (isChecked ? " rater-class-registry__row--checked" : "")
                  }
                >
                  <Checkbox
                    className="rater-class-registry__check"
                    checked={isChecked}
                    onChange={() => toggleSelect(c.class_code)}
                    aria-label={`Select ${c.class_code} ${c.display_name}`}
                    data-testid={`${testId}-check-${c.class_code}`}
                  />
                  <button
                    type="button"
                    className="rater-class-registry__row-body"
                    onClick={() => setDetailCode(c.class_code)}
                    aria-pressed={isDetail}
                  >
                    <span className="rater-class-registry__code">{c.class_code}</span>
                    <span className="rater-class-registry__name" title={c.display_name}>
                      {c.display_name}
                    </span>
                    {c.source === "custom" && (
                      <span className="rater-class-registry__badge rater-class-registry__badge--custom">
                        Custom
                      </span>
                    )}
                    <span className="rater-class-registry__fam" title={c.family ?? ""}>
                      {c.family ?? ""}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {selected.size > 0 && (
          <div className="rater-class-registry__addbar" role="region" aria-label="Add to plan" data-testid={`${testId}-addbar`}>
            <span className="rater-class-registry__addbar-count">
              {selected.size} selected
            </span>
            <button
              type="button"
              className="rater-class-registry__addbar-clear"
              onClick={clearSelection}
            >
              Clear
            </button>
            <div className="rater-class-registry__footer-spacer" />
            <Button
              variant="primary"
              size="sm"
              onClick={addToPlan}
              loading={adding}
              data-testid={`${testId}-addtoplan`}
            >
              {classDimensionExists
                ? `Update plan dimension (${selected.size})`
                : `Add ${selected.size} to plan`}
            </Button>
          </div>
        )}
      </div>

      {/* ── detail column ── */}
      <div className="rater-class-registry__detail">
        {detail ? (
          <ClassDetail record={detail} onEdit={() => openEdit(detail)} />
        ) : (
          <div className="rater-class-registry__detail-empty" role="status">
            <div className="rater-class-registry__empty-title">Pick a class to see details</div>
            <p className="rater-class-registry__empty-hint">
              The detail pane shows the family, NAICS, exposure bases, and the
              derived rating attributes that drive the structural dimensions.
            </p>
          </div>
        )}
      </div>

      <ClassEditDrawer
        open={drawer.open}
        mode={drawer.mode}
        draft={drawer.draft}
        onDraftChange={(next) => setDrawer((d) => ({ ...d, draft: next }))}
        onSave={saveDraft}
        onCancel={closeDrawer}
        {...(drawer.mode === "edit" ? { onDelete: deleteDraft } : {})}
        saving={saving}
        {...(drawerError ? { errorMessage: drawerError } : {})}
        existingCodes={existingCodes}
      />
      <ClassBulkImportOverlay
        open={importOpen}
        onCancel={() => setImportOpen(false)}
        onImport={runImport}
        importing={importing}
      />
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────
// Detail pane — code/name/source + meta + the derived attributes table.
// ───────────────────────────────────────────────────────────────────

function ClassDetail(props: {
  record: ClassRegistryRecord;
  onEdit: () => void;
}): JSX.Element {
  const { record: c, onEdit } = props;
  const attrs = Object.entries(c.attributes ?? {});
  return (
    <div className="rater-class-registry__card" data-testid="rater-class-registry-detail">
      <header className="rater-class-registry__card-head">
        <div className="rater-class-registry__card-id">
          <span className="rater-class-registry__card-code">{c.class_code}</span>
          <span
            className={
              "rater-class-registry__badge rater-class-registry__badge--" +
              (c.source === "custom" ? "custom" : "iso")
            }
          >
            {c.source === "custom" ? "Custom" : "ISO"}
          </span>
        </div>
        <Button variant="ghost" size="sm" onClick={onEdit} data-testid="rater-class-registry-edit">
          <Pencil size={14} aria-hidden /> Edit
        </Button>
      </header>
      <h2 className="rater-class-registry__card-name">{c.display_name}</h2>

      <dl className="rater-class-registry__meta-grid">
        <Meta label="Family" value={c.family || "—"} />
        <Meta label="NAICS" value={c.naics_code || "—"} mono />
        <Meta label="SIC" value={c.sic_code || "—"} mono />
        <Meta
          label="Eligible"
          value={c.eligible_for.length > 0 ? c.eligible_for.join(", ") : "—"}
        />
      </dl>

      <section className="rater-class-registry__attrs">
        <div className="rater-class-registry__attrs-label">Derived rating attributes</div>
        {attrs.length === 0 ? (
          <p className="rater-class-registry__attrs-empty">
            None. These drive the rate-number / class-group / exposure-base
            structural dimensions — add them in Edit or via import.
          </p>
        ) : (
          <table className="rater-class-registry__attrs-table">
            <tbody>
              {attrs.map(([k, v]) => (
                <tr key={k}>
                  <th scope="row">{k}</th>
                  <td>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {c.exposure_bases && c.exposure_bases.length > 0 && (
        <section className="rater-class-registry__section">
          <div className="rater-class-registry__attrs-label">Exposure bases</div>
          <ul className="rater-class-registry__exp">
            {c.exposure_bases.map((e, i) => (
              <li key={`${e.code}-${i}`}>
                {e.custom_label ? `${e.code} (${e.custom_label})` : e.code}
              </li>
            ))}
          </ul>
        </section>
      )}

      {c.description && (
        <section className="rater-class-registry__section">
          <div className="rater-class-registry__attrs-label">Description</div>
          <p className="rater-class-registry__desc">{c.description}</p>
        </section>
      )}

      {c.citation_rule && (
        <p className="rater-class-registry__cite">
          {c.citation_rule}
          {c.citation_page ? ` · ${c.citation_page}` : ""}
        </p>
      )}
    </div>
  );
}

function Meta(props: { label: string; value: string; mono?: boolean }): JSX.Element {
  return (
    <div className="rater-class-registry__meta-item">
      <dt className="rater-class-registry__meta-label">{props.label}</dt>
      <dd
        className={
          "rater-class-registry__meta-value" +
          (props.mono ? " rater-class-registry__meta-value--mono" : "")
        }
      >
        {props.value}
      </dd>
    </div>
  );
}
