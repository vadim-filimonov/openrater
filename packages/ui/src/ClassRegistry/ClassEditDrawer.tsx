/**
 * <ClassEditDrawer> — create / edit one class (Brief 51).
 *
 * The standard edit drawer (node-design-principle P-N8): same chrome,
 * title / body / footer, save-cancel-delete in the same places. The only
 * novel field group is the DERIVED RATING ATTRIBUTES editor — opaque
 * key/value pairs (prop_rate_number → 09, …) that feed the structural
 * dimensions a factor table keys off (ADR-0035).
 *
 * Attribute rows are held in local state keyed by a STABLE id so renaming
 * a key doesn't remount the row (which would drop input focus). The
 * serialized, non-empty-keyed Record is pushed up through onDraftChange.
 */

import { useEffect, useState, type ReactNode } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button, Drawer } from "@openrater/design-system";
import type { ClassDraft } from "./types";
import "./ClassEditDrawer.css";

export interface ClassEditDrawerProps {
  readonly open: boolean;
  readonly mode: "add" | "edit";
  readonly draft: ClassDraft;
  readonly onDraftChange: (next: ClassDraft) => void;
  readonly onSave: () => void;
  readonly onCancel: () => void;
  /** Edit mode only — when omitted, no Delete button renders. */
  readonly onDelete?: () => void;
  readonly saving?: boolean;
  readonly errorMessage?: string;
  /** Class codes already present — drives the add-mode overwrite warning. */
  readonly existingCodes?: ReadonlySet<string>;
  readonly testId?: string;
}

interface AttrRow {
  readonly id: number;
  readonly key: string;
  readonly value: string;
}

let attrRowSeq = 0;

export function ClassEditDrawer(props: ClassEditDrawerProps): JSX.Element {
  const {
    open,
    mode,
    draft,
    onDraftChange,
    onSave,
    onCancel,
    onDelete,
    saving = false,
    errorMessage,
    existingCodes,
    testId = "rater-class-edit-drawer",
  } = props;

  const codeLocked = mode === "edit";
  const trimmedCode = draft.class_code.trim();
  const codeCollision =
    mode === "add" && trimmedCode !== "" && Boolean(existingCodes?.has(trimmedCode));
  const canSave =
    trimmedCode !== "" && draft.display_name.trim() !== "" && !saving;

  const set = <K extends keyof ClassDraft>(key: K, value: ClassDraft[K]): void =>
    onDraftChange({ ...draft, [key]: value });

  // ── Derived-attribute rows (local, stable-id keyed) ──────────────
  const [attrRows, setAttrRows] = useState<AttrRow[]>([]);

  // Re-seed when the drawer opens or the edited class changes.
  useEffect(() => {
    setAttrRows(
      Object.entries(draft.attributes).map(([key, value]) => ({
        id: attrRowSeq++,
        key,
        value,
      })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, draft.class_code]);

  const commitAttrs = (rows: AttrRow[]): void => {
    setAttrRows(rows);
    const rec: Record<string, string> = {};
    for (const r of rows) {
      const k = r.key.trim();
      if (k !== "") rec[k] = r.value;
    }
    onDraftChange({ ...draft, attributes: rec });
  };

  const addAttr = (): void =>
    commitAttrs([...attrRows, { id: attrRowSeq++, key: "", value: "" }]);
  const updateAttr = (id: number, patch: Partial<AttrRow>): void =>
    commitAttrs(attrRows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const removeAttr = (id: number): void =>
    commitAttrs(attrRows.filter((r) => r.id !== id));

  return (
    <Drawer
      open={open}
      onClose={onCancel}
      title={mode === "add" ? "Add class" : "Edit class"}
      subtitle={mode === "add" ? "New class" : `Class ${draft.class_code}`}
    >
      <Drawer.Body>
        {errorMessage && (
          <div
            className="rater-class-edit-drawer__error"
            role="alert"
            data-testid={`${testId}-error`}
          >
            {errorMessage}
          </div>
        )}
        <div className="rater-class-edit-drawer__grid">
          <Field label="Class code" hint={codeLocked ? "Locked after creation." : "The filed classification code (e.g. 53983)."}>
            <input
              className="rater-class-edit-drawer__input rater-class-edit-drawer__input--mono"
              value={draft.class_code}
              disabled={codeLocked}
              onChange={(e) => set("class_code", e.target.value)}
              placeholder="53983"
              aria-label="Class code"
              data-testid={`${testId}-class-code`}
            />
            {codeCollision && (
              <p className="rater-class-edit-drawer__warn">
                A class with this code already exists — saving overwrites it.
              </p>
            )}
          </Field>

          <Field label="Display name">
            <input
              className="rater-class-edit-drawer__input"
              value={draft.display_name}
              onChange={(e) => set("display_name", e.target.value)}
              placeholder="Army/Navy Retail"
              aria-label="Display name"
              data-testid={`${testId}-display-name`}
            />
          </Field>

          <Field label="Family" hint="Industry group — drives the family filter.">
            <input
              className="rater-class-edit-drawer__input"
              value={draft.family}
              onChange={(e) => set("family", e.target.value)}
              placeholder="Retail"
              aria-label="Family"
            />
          </Field>

          <Field label="Eligible products" hint="Comma-separated (e.g. bop, property).">
            <input
              className="rater-class-edit-drawer__input"
              value={draft.eligible_for.join(", ")}
              onChange={(e) =>
                set(
                  "eligible_for",
                  e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                )
              }
              placeholder="bop"
              aria-label="Eligible products"
            />
          </Field>

          <Field label="NAICS">
            <input
              className="rater-class-edit-drawer__input rater-class-edit-drawer__input--mono"
              value={draft.naics_code ?? ""}
              onChange={(e) => set("naics_code", e.target.value || undefined)}
              placeholder="452990"
              aria-label="NAICS code"
            />
          </Field>

          <Field label="SIC">
            <input
              className="rater-class-edit-drawer__input rater-class-edit-drawer__input--mono"
              value={draft.sic_code ?? ""}
              onChange={(e) => set("sic_code", e.target.value || undefined)}
              placeholder="5311"
              aria-label="SIC code"
            />
          </Field>

          <Field label="Source" hint="ISO = filed; custom = carrier-authored.">
            <select
              className="rater-class-edit-drawer__input"
              value={draft.source}
              onChange={(e) => set("source", e.target.value as "iso" | "custom")}
              aria-label="Source"
            >
              <option value="custom">Custom (carrier-authored)</option>
              <option value="iso">ISO (filed)</option>
            </select>
          </Field>

          <Field label="Description" full>
            <textarea
              className="rater-class-edit-drawer__textarea"
              value={draft.description ?? ""}
              onChange={(e) => set("description", e.target.value || undefined)}
              placeholder="Long-form description from the manual…"
              aria-label="Description"
              rows={2}
            />
          </Field>

          {/* ── Derived rating attributes ───────────────────────── */}
          <div className="rater-class-edit-drawer__attrs" data-testid={`${testId}-attributes`}>
            <div className="rater-class-edit-drawer__attrs-head">
              <span className="rater-class-edit-drawer__label">Derived rating attributes</span>
              <Button variant="ghost" size="xs" onClick={addAttr}>
                <Plus size={13} aria-hidden /> Add attribute
              </Button>
            </div>
            <p className="rater-class-edit-drawer__hint">
              e.g. <code>prop_rate_number → 09</code>. These drive the structural
              dimensions a factor table keys off.
            </p>
            {attrRows.length === 0 ? (
              <p className="rater-class-edit-drawer__attrs-empty">No derived attributes yet.</p>
            ) : (
              <div className="rater-class-edit-drawer__attr-rows">
                {attrRows.map((r) => (
                  <div className="rater-class-edit-drawer__attr-row" key={r.id}>
                    <input
                      className="rater-class-edit-drawer__input rater-class-edit-drawer__input--mono"
                      value={r.key}
                      onChange={(e) => updateAttr(r.id, { key: e.target.value })}
                      placeholder="prop_rate_number"
                      aria-label="Attribute key"
                    />
                    <input
                      className="rater-class-edit-drawer__input rater-class-edit-drawer__input--mono"
                      value={r.value}
                      onChange={(e) => updateAttr(r.id, { value: e.target.value })}
                      placeholder="09"
                      aria-label={`Value for ${r.key || "attribute"}`}
                    />
                    <button
                      type="button"
                      className="rater-class-edit-drawer__attr-del"
                      onClick={() => removeAttr(r.id)}
                      aria-label={`Remove ${r.key || "attribute"}`}
                    >
                      <Trash2 size={14} aria-hidden />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </Drawer.Body>
      <Drawer.Footer>
        {mode === "edit" && onDelete && (
          <Button variant="danger-text" onClick={onDelete} disabled={saving}>
            Delete
          </Button>
        )}
        <div className="rater-class-edit-drawer__footer-spacer" />
        <Button variant="ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button variant="primary" onClick={onSave} disabled={!canSave} loading={saving}>
          {mode === "add" ? "Add class" : "Save"}
        </Button>
      </Drawer.Footer>
    </Drawer>
  );
}

function Field(props: {
  label: string;
  hint?: string;
  full?: boolean;
  children: ReactNode;
}): JSX.Element {
  return (
    <div
      className={
        "rater-class-edit-drawer__field" +
        (props.full ? " rater-class-edit-drawer__field--full" : "")
      }
    >
      <label className="rater-class-edit-drawer__label">{props.label}</label>
      {props.children}
      {props.hint && <p className="rater-class-edit-drawer__hint">{props.hint}</p>}
    </div>
  );
}
