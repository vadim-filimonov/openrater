/**
 * <FinalAdjustmentsEditor> — author the plan's Final-adjustments tail
 * (Brief 62.4 R1; the owner-locked label is "Final adjustments").
 *
 * The ONE after-rating surface on the plan: an ordered list of
 * `PolicyAdjustment` rows (62.1's union) — schedule rating (IRPM) →
 * package mods → endorsements → the minimum-premium floor — applied to the
 * aggregated premium in order. The floor is pinned last (a floor that
 * isn't last is almost always a bug → a warning). The schedule-rating row
 * carries the 62.2 IRPM source (literal / column / connector; the model
 * source is retired — Detachment Brief 1 §4 S1 — scores arrive as
 * declared inputs read by the `column` source).
 *
 * Controlled + pure: takes `adjustments` + `onChange`. No premium math, no
 * product branch, no I/O. Matches mockup F3/F4. The mount into the plan's
 * Final-Adjustments section is 62.4 PR3b.
 */

import { useState } from "react";
import { Plus, Trash2, ArrowUp, ArrowDown, AlertTriangle } from "lucide-react";
import type { AdjustmentKind, IrpmSourceSpec, PolicyAdjustment } from "@openrater/contracts";
import "./FinalAdjustmentsEditor.css";

/** An API Lab connector the IRPM `connector` source can bind to (Brief 62.6). */
export interface ConnectorOption {
  readonly connectorId: string;
  readonly version: string;
  readonly displayName: string;
}

export interface FinalAdjustmentsEditorProps {
  readonly adjustments: readonly PolicyAdjustment[];
  readonly onChange: (next: readonly PolicyAdjustment[]) => void;
  /** Declared input fields — the IRPM `column` picker + `when` guard fields. */
  readonly inputFields?: readonly string[];
  /** API Lab connectors the IRPM `connector` source can bind (Brief 62.6).
   *  When empty/omitted, the "Connector" segment stays disabled. */
  readonly connectors?: readonly ConnectorOption[];
  readonly title?: string;
  /** ADR-0055 — a non-DRAFT plan's tail is immutable (the API 409s the
   *  PUT). Read-only renders the ordered rows + effect summaries with no
   *  edit affordances (no add / move / delete / expand). */
  readonly readOnly?: boolean;
}

const KIND_MOD: Record<AdjustmentKind, string> = {
  schedule_rating: "sched",
  package_factor: "pkg",
  endorsement: "endo",
  minimum_premium: "min",
};
const KIND_CHIP: Record<AdjustmentKind, string> = {
  schedule_rating: "schedule",
  package_factor: "package",
  endorsement: "endorsement",
  minimum_premium: "minimum",
};

let _seq = 0;
function nextId(kind: AdjustmentKind): string {
  _seq += 1;
  return `${kind}_${_seq}`;
}

function buildDefault(kind: AdjustmentKind): PolicyAdjustment {
  switch (kind) {
    case "schedule_rating":
      return { kind, id: nextId(kind), display_name: "Schedule rating", cap_pct: 25, source: { from: "literal", total: 0 } };
    case "package_factor":
      return { kind, id: nextId(kind), display_name: "Package factor", factor: 1 };
    case "endorsement":
      return { kind, id: nextId(kind), display_name: "Endorsement", effect: { kind: "flat", amount: 0 } };
    case "minimum_premium":
      return { kind, id: nextId(kind), floor: 0 };
  }
}

/** The one-line effect summary shown on a collapsed row. */
function effectSummary(adj: PolicyAdjustment): string {
  switch (adj.kind) {
    case "schedule_rating":
      return adj.source.from === "column" ? "column" : adj.source.from === "literal" ? `${adj.source.total ?? 0}%` : adj.source.from;
    case "package_factor":
      return `× ${adj.factor}`;
    case "endorsement":
      return adj.effect.kind === "flat" ? `+ $${adj.effect.amount}` : `× ${adj.effect.factor}`;
    case "minimum_premium":
      return `floor $${adj.floor}`;
  }
}

function whenNote(adj: PolicyAdjustment): string | null {
  if ((adj.kind === "package_factor" || adj.kind === "endorsement") && adj.when) {
    return `when ${adj.when.field}`;
  }
  if (adj.kind === "schedule_rating") return `cap ±${adj.cap_pct}%`;
  return null;
}

export function FinalAdjustmentsEditor({
  adjustments,
  onChange,
  inputFields = [],
  connectors = [],
  title = "Final adjustments",
  readOnly = false,
}: FinalAdjustmentsEditorProps) {
  const [openId, setOpenId] = useState<string | null>(null);

  const update = (id: string, next: PolicyAdjustment) =>
    onChange(adjustments.map((a) => (a.id === id ? next : a)));
  const remove = (id: string) => onChange(adjustments.filter((a) => a.id !== id));
  const add = (kind: AdjustmentKind) => {
    const created = buildDefault(kind);
    onChange([...adjustments, created]);
    setOpenId(created.id);
  };
  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= adjustments.length) return;
    const next = [...adjustments];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item!);
    onChange(next);
  };

  // The floor should sit last; warn when any minimum_premium is not last.
  const lastIndex = adjustments.length - 1;
  const floorOutOfPlace = adjustments.some(
    (a, i) => a.kind === "minimum_premium" && i !== lastIndex,
  );

  return (
    <section className="rater-fae" aria-label={title}>
      <header className="rater-fae__head">
        <h3 className="rater-fae__title">{title}</h3>
        <span className="rater-fae__hint">applied to the aggregated premium, in order</span>
      </header>

      {adjustments.length === 0 ? (
        <p className="rater-fae__empty">
          {readOnly
            ? "No after-rating adjustments on this version."
            : "No after-rating adjustments yet. Add schedule rating (IRPM), package mods, endorsements, or a minimum-premium floor."}
        </p>
      ) : (
        <ul className="rater-fae__list">
          {adjustments.map((adj, i) => {
            const pinned = adj.kind === "minimum_premium";
            const note = whenNote(adj);
            const isOpen = !readOnly && openId === adj.id;
            const name =
              adj.kind === "minimum_premium"
                ? "Minimum premium"
                : adj.display_name;
            return (
              <li key={adj.id} className={`rater-fae__row${pinned ? " rater-fae__row--pinned" : ""}`}>
                <div className="rater-fae__row-head">
                  <span className={`rater-fae__chip rater-fae__chip--${KIND_MOD[adj.kind]}`}>
                    {KIND_CHIP[adj.kind]}
                  </span>
                  {readOnly ? (
                    <span className="rater-fae__name">{name}</span>
                  ) : (
                    <button
                      type="button"
                      className="rater-fae__name"
                      onClick={() => setOpenId(isOpen ? null : adj.id)}
                      aria-expanded={isOpen}
                    >
                      {name}
                    </button>
                  )}
                  {note ? <span className="rater-fae__when">{note}</span> : null}
                  <span className="rater-fae__eff">{effectSummary(adj)}</span>
                  {!readOnly ? (
                    <span className="rater-fae__row-actions">
                      <button type="button" className="rater-fae__icon" aria-label={`Move ${adj.id} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                        <ArrowUp size={13} />
                      </button>
                      <button type="button" className="rater-fae__icon" aria-label={`Move ${adj.id} down`} disabled={i === lastIndex} onClick={() => move(i, 1)}>
                        <ArrowDown size={13} />
                      </button>
                      <button type="button" className="rater-fae__icon rater-fae__icon--danger" aria-label={`Remove ${adj.id}`} onClick={() => remove(adj.id)}>
                        <Trash2 size={13} />
                      </button>
                    </span>
                  ) : null}
                </div>
                {isOpen ? (
                  <AdjustmentForm adj={adj} inputFields={inputFields} connectors={connectors} onChange={(next) => update(adj.id, next)} />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {floorOutOfPlace ? (
        <p className="rater-fae__warn">
          <AlertTriangle size={13} />
          The minimum-premium floor almost always applies last — move it below
          the other steps unless your filing says otherwise.
        </p>
      ) : null}

      {!readOnly ? (
        <div className="rater-fae__add">
          {(["package_factor", "endorsement", "schedule_rating", "minimum_premium"] as const).map((kind) => (
            <button key={kind} type="button" className="rater-fae__add-opt" onClick={() => add(kind)}>
              <Plus size={12} /> {KIND_CHIP[kind]}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

// ── Per-kind inline form ─────────────────────────────────────────────

interface AdjustmentFormProps {
  readonly adj: PolicyAdjustment;
  readonly inputFields: readonly string[];
  readonly connectors: readonly ConnectorOption[];
  readonly onChange: (next: PolicyAdjustment) => void;
}

function num(value: string, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function AdjustmentForm({ adj, inputFields, connectors, onChange }: AdjustmentFormProps) {
  return (
    <div className="rater-fae__form">
      {adj.kind !== "minimum_premium" ? (
        <label className="rater-fae__field">
          <span>Name</span>
          <input value={adj.display_name} onChange={(e) => onChange({ ...adj, display_name: e.target.value })} />
        </label>
      ) : null}

      {adj.kind === "schedule_rating" ? (
        <>
          <label className="rater-fae__field">
            <span>Cap ±%</span>
            <input type="number" value={adj.cap_pct} onChange={(e) => onChange({ ...adj, cap_pct: num(e.target.value, adj.cap_pct) })} />
          </label>
          <IrpmSourcePicker source={adj.source} inputFields={inputFields} connectors={connectors} onChange={(source) => onChange({ ...adj, source })} />
        </>
      ) : null}

      {adj.kind === "package_factor" ? (
        <>
          <label className="rater-fae__field">
            <span>Factor</span>
            <input type="number" step="0.01" value={adj.factor} onChange={(e) => onChange({ ...adj, factor: num(e.target.value, adj.factor) })} />
          </label>
          <GuardField when={adj.when} inputFields={inputFields} onChange={(when) => onChange({ ...adj, ...(when ? { when } : {}) })} onClear={() => { const { when: _w, ...rest } = adj; onChange(rest); }} />
        </>
      ) : null}

      {adj.kind === "endorsement" ? (
        <>
          <label className="rater-fae__field">
            <span>Effect</span>
            <select
              value={adj.effect.kind}
              onChange={(e) =>
                onChange({ ...adj, effect: e.target.value === "flat" ? { kind: "flat", amount: 0 } : { kind: "factor", factor: 1 } })
              }
            >
              <option value="flat">flat $</option>
              <option value="factor">× factor</option>
            </select>
          </label>
          <label className="rater-fae__field">
            <span>{adj.effect.kind === "flat" ? "Amount $" : "Factor"}</span>
            {adj.effect.kind === "flat" ? (
              <input type="number" value={adj.effect.amount} onChange={(e) => onChange({ ...adj, effect: { kind: "flat", amount: num(e.target.value, adj.effect.kind === "flat" ? adj.effect.amount : 0) } })} />
            ) : (
              <input type="number" step="0.01" value={adj.effect.factor} onChange={(e) => onChange({ ...adj, effect: { kind: "factor", factor: num(e.target.value, adj.effect.kind === "factor" ? adj.effect.factor : 1) } })} />
            )}
          </label>
        </>
      ) : null}

      {adj.kind === "minimum_premium" ? (
        <label className="rater-fae__field">
          <span>Floor $</span>
          <input type="number" value={adj.floor} onChange={(e) => onChange({ ...adj, floor: num(e.target.value, adj.floor) })} />
        </label>
      ) : null}
    </div>
  );
}

// ── IRPM source picker (62.2) ────────────────────────────────────────

interface IrpmSourcePickerProps {
  readonly source: IrpmSourceSpec;
  readonly inputFields: readonly string[];
  readonly connectors: readonly ConnectorOption[];
  readonly onChange: (next: IrpmSourceSpec) => void;
}

function IrpmSourcePicker({ source, inputFields, connectors, onChange }: IrpmSourcePickerProps) {
  // The `connector` segment is live once connectors are supplied (62.6).
  // The model segment is retired (S1) — scores are declared inputs.
  const segments: ReadonlyArray<{
    from: IrpmSourceSpec["from"];
    label: string;
    hint: string;
    disabled?: boolean;
  }> = [
    { from: "literal", label: "Literal", hint: "One fixed net % for every insured." },
    { from: "column", label: "Column", hint: "Per-insured, from a declared input." },
    {
      from: "connector",
      label: "Connector",
      hint: connectors.length ? "A live API Lab connector → net." : "Author a connector in API Lab first.",
      disabled: connectors.length === 0,
    },
  ];
  const pick = (from: IrpmSourceSpec["from"]) => {
    if (from === "literal") onChange({ from: "literal", total: 0 });
    else if (from === "column") onChange({ from: "column", column: inputFields[0] ?? "" });
    else if (from === "connector" && connectors[0]) {
      onChange({ from: "connector", connector_id: connectors[0].connectorId, version: connectors[0].version });
    }
  };
  return (
    <div className="rater-fae__source">
      <div className="rater-fae__seg-row">
        {segments.map((seg) => (
          <button
            key={seg.from}
            type="button"
            className={`rater-fae__seg${source.from === seg.from ? " is-on" : ""}${seg.disabled ? " is-off" : ""}`}
            disabled={seg.disabled}
            onClick={() => pick(seg.from)}
            title={seg.hint}
          >
            <span className="rater-fae__seg-label">{seg.label}</span>
            <span className="rater-fae__seg-hint">{seg.hint}</span>
          </button>
        ))}
      </div>
      {source.from === "literal" ? (
        <label className="rater-fae__field">
          <span>Net %</span>
          <input type="number" value={source.total ?? 0} onChange={(e) => onChange({ from: "literal", total: num(e.target.value, source.total ?? 0) })} />
        </label>
      ) : null}
      {source.from === "column" ? (
        <label className="rater-fae__field">
          <span>Input column</span>
          <select value={source.column ?? ""} onChange={(e) => onChange({ from: "column", column: e.target.value })}>
            {(source.column && !inputFields.includes(source.column) ? [source.column, ...inputFields] : inputFields).map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
            {inputFields.length === 0 ? <option value="">(no declared inputs)</option> : null}
          </select>
        </label>
      ) : null}
      {source.from === "connector" ? (
        <label className="rater-fae__field">
          <span>Connector · version</span>
          <select
            value={`${source.connector_id}@${source.version}`}
            onChange={(e) => {
              const at = e.target.value.lastIndexOf("@");
              onChange({
                from: "connector",
                connector_id: e.target.value.slice(0, at),
                version: e.target.value.slice(at + 1),
              });
            }}
          >
            {connectors.map((c) => (
              <option key={`${c.connectorId}@${c.version}`} value={`${c.connectorId}@${c.version}`}>
                {c.displayName} · {c.version}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </div>
  );
}

// ── Guard (when) field — reuses the gate vocabulary ──────────────────

interface GuardFieldProps {
  readonly when: { readonly field: string; readonly op: string; readonly value: unknown } | undefined;
  readonly inputFields: readonly string[];
  readonly onChange: (when: { field: string; op: "eq"; value: boolean }) => void;
  readonly onClear: () => void;
}

function GuardField({ when, inputFields, onChange, onClear }: GuardFieldProps) {
  if (!when) {
    return (
      <button
        type="button"
        className="rater-fae__guard-add"
        disabled={inputFields.length === 0}
        onClick={() => onChange({ field: inputFields[0] ?? "", op: "eq", value: true })}
      >
        + Apply only when…
      </button>
    );
  }
  return (
    <div className="rater-fae__guard">
      <span>when</span>
      <select value={when.field} onChange={(e) => onChange({ field: e.target.value, op: "eq", value: true })}>
        {(when.field && !inputFields.includes(when.field) ? [when.field, ...inputFields] : inputFields).map((f) => (
          <option key={f} value={f}>{f}</option>
        ))}
      </select>
      <span>is true</span>
      <button type="button" className="rater-fae__icon rater-fae__icon--danger" aria-label="Clear guard" onClick={onClear}>
        <Trash2 size={12} />
      </button>
    </div>
  );
}
