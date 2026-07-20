/**
 * <InputEditorDrawer> — Brief 61 D4.
 *
 * The focused, right-side editor for ONE declared input. Replaces
 * Brief 52's inline expand-in-place form (rejected by the owner as
 * cramped / confusing). Uses the studio's standard <Drawer> primitive
 * so an `input_node` is edited exactly like every other node (P-N8):
 * one learnable edit surface across all 18 kinds.
 *
 * Controlled-ish: holds a local draft while open, commits on Save via
 * `onSave`. The parent owns persistence (input_node stage CRUD) + the
 * open/close state. Validation is inline (P-N6): blank/duplicate
 * fieldName, default ∉ allowedValues, derived-without-source.
 *
 * Schema only — the per-upload binding (← mapped column) lives inline
 * in the table row, not here (Brief 61: "edit the definition" in the
 * drawer, "bind this upload's column" in the row).
 */

import { useEffect, useMemo, useState } from "react";
import { Button, Drawer, Input, Segmented } from "@openrater/design-system";
import type { ComputedExpr, PrimitiveType } from "@openrater/contracts";
import { Trash2 } from "lucide-react";

import { ComputedExprEditor } from "../ComputedExprEditor";

import {
  DATA_TYPE_GROUPS,
  SOURCE_LABEL,
  SOURCE_OPTIONS,
  fieldNameToStageId,
  humanizeFieldName,
  isDeclarableFieldName,
  isNumericType,
  type InputDictEntry,
  type InputSourceKindValue,
} from "./types";
import "./InputEditorDrawer.css";

export interface InputEditorDrawerProps {
  /** Open state. */
  readonly open: boolean;
  /** "add" shows a blank draft + "Add input" CTA; "edit" prefills. */
  readonly mode: "add" | "edit";
  /** The entry being edited (ignored for "add"). */
  readonly entry?: InputDictEntry | null;
  /**
   * All declared fieldNames EXCEPT the one being edited — used for the
   * duplicate-name check. The parent passes the current dictionary's
   * fieldNames minus `entry.fieldName`.
   */
  readonly otherFieldNames: readonly string[];
  /** Commit. Parent persists to the input_node stage. */
  readonly onSave: (entry: InputDictEntry) => void;
  /** Close without committing. */
  readonly onClose: () => void;
  /** Delete (edit mode only). */
  readonly onDelete?: (id: string) => void;
  /** Mutation in flight — disables the form. */
  readonly busy?: boolean;
}

function blankEntry(): InputDictEntry {
  return {
    id: "",
    fieldName: "",
    displayName: "",
    dataType: "string",
    source: "form",
    required: true,
  };
}

interface DraftIssue {
  readonly field: keyof InputDictEntry;
  readonly message: string;
}

/** Inline validation for a single draft (mirrors validateDictionary). */
function validateDraft(
  draft: InputDictEntry,
  otherFieldNames: readonly string[],
): readonly DraftIssue[] {
  const issues: DraftIssue[] = [];
  const fn = draft.fieldName.trim();
  if (fn === "") {
    issues.push({ field: "fieldName", message: "Field name is required" });
  } else if (!isDeclarableFieldName(fn)) {
    issues.push({
      field: "fieldName",
      message: `"${fn}" isn't a field name — ':' marks a binding namespace (like literal:1), not an input`,
    });
  } else if (otherFieldNames.some((o) => o.trim() === fn)) {
    issues.push({
      field: "fieldName",
      message: `"${fn}" is already declared — field names must be unique`,
    });
  }
  if (
    draft.allowedValues &&
    draft.allowedValues.length > 0 &&
    draft.defaultValue !== undefined &&
    draft.defaultValue !== "" &&
    !draft.allowedValues.some((v) => String(v) === String(draft.defaultValue))
  ) {
    issues.push({
      field: "defaultValue",
      message: `Default "${draft.defaultValue}" is not one of the allowed values`,
    });
  }
  if (
    draft.source === "derived" &&
    (!draft.derivedFrom || draft.derivedFrom.trim() === "") &&
    !exprReferencesInput(draft.derivedExpr)
  ) {
    issues.push({
      field: "derivedFrom",
      message: "Set the upstream field — or build a computed expression",
    });
  }
  return issues;
}

/** True when a computed expression references at least one named input — i.e.
 *  it's a real derivation, not the trivial default constant. */
function exprReferencesInput(expr: ComputedExpr | undefined): boolean {
  if (!expr) return false;
  if (expr.kind === "input") return expr.name.trim() !== "";
  if (expr.kind === "op") {
    return exprReferencesInput(expr.left) || exprReferencesInput(expr.right);
  }
  return false;
}

export function InputEditorDrawer(props: InputEditorDrawerProps) {
  const { open, mode, entry, otherFieldNames, onSave, onClose, onDelete, busy = false } = props;

  const [draft, setDraft] = useState<InputDictEntry>(() => entry ?? blankEntry());

  // Re-seed the draft whenever we (re)open onto a different entry.
  useEffect(() => {
    if (open) setDraft(entry ? { ...entry } : blankEntry());
  }, [open, entry]);

  const issues = useMemo(
    () => validateDraft(draft, otherFieldNames),
    [draft, otherFieldNames],
  );
  const issueFor = (field: keyof InputDictEntry) =>
    issues.find((i) => i.field === field)?.message;
  const canSave = draft.fieldName.trim() !== "" && issues.length === 0;

  // exactOptionalPropertyTypes-safe patch: clearing a key DELETES it.
  const patch = (p: Partial<Record<keyof InputDictEntry, unknown>>) => {
    setDraft((prev) => {
      const next: Record<string, unknown> = { ...prev };
      for (const [k, v] of Object.entries(p)) {
        if (v === undefined) delete next[k];
        else next[k] = v;
      }
      return next as unknown as InputDictEntry;
    });
  };

  function commit() {
    const fieldName = draft.fieldName.trim();
    if (fieldName === "" || issues.length > 0) return;
    onSave({
      ...draft,
      id: draft.id || fieldNameToStageId(fieldName),
      fieldName,
      displayName: draft.displayName.trim() || humanizeFieldName(fieldName),
    });
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={mode === "add" ? "Add input" : "Edit input"}
      subtitle={draft.fieldName.trim() || (mode === "add" ? "New declared input" : "Declared input")}
      size="sm"
    >
      <Drawer.Body>
        <div className="rater-ied">
          <p className="rater-ied__section">Definition</p>

          <label className="rater-ied__field">
            <span className="rater-ied__label">Display name</span>
            <Input
              inputSize="sm"
              value={draft.displayName}
              placeholder="Requested limit"
              aria-label="Display name"
              onChange={(e) => patch({ displayName: e.target.value })}
            />
          </label>

          <label className="rater-ied__field">
            <span className="rater-ied__label">Field name</span>
            <Input
              inputSize="sm"
              value={draft.fieldName}
              placeholder="requested_limit"
              aria-label="Field name (the key your data maps to)"
              hasError={Boolean(issueFor("fieldName"))}
              onChange={(e) => patch({ fieldName: e.target.value })}
            />
            {issueFor("fieldName") ? (
              <span className="rater-ied__error">{issueFor("fieldName")}</span>
            ) : (
              <span className="rater-ied__hint">The key your CSV column / payload field maps to.</span>
            )}
          </label>

          <div className="rater-ied__row2">
            <label className="rater-ied__field">
              <span className="rater-ied__label">Type</span>
              <select
                className="rater-ied__select"
                value={draft.dataType}
                aria-label="Data type"
                onChange={(e) => patch({ dataType: e.target.value as PrimitiveType })}
              >
                {DATA_TYPE_GROUPS.map((grp) => (
                  <optgroup key={grp.label} label={grp.label}>
                    {grp.options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>

            <div className="rater-ied__field">
              <span className="rater-ied__label">Required</span>
              <Segmented
                size="sm"
                ariaLabel="Required"
                value={draft.required ? "required" : "optional"}
                onChange={(v) => patch({ required: v === "required" })}
                items={[
                  { value: "required", label: "Required" },
                  { value: "optional", label: "Optional" },
                ]}
              />
            </div>
          </div>

          <label className="rater-ied__field">
            <span className="rater-ied__label">Source</span>
            <select
              className="rater-ied__select"
              value={draft.source}
              aria-label="Source"
              onChange={(e) => patch({ source: e.target.value as InputSourceKindValue })}
            >
              {SOURCE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {SOURCE_LABEL[o.value]}
                </option>
              ))}
            </select>
          </label>

          {draft.source === "derived" ? (
            <>
              <label className="rater-ied__field">
                <span className="rater-ied__label">Derived from</span>
                <Input
                  inputSize="sm"
                  value={draft.derivedFrom ?? ""}
                  placeholder="upstream field name (optional if computed below)"
                  aria-label="Derived from (upstream field)"
                  hasError={Boolean(issueFor("derivedFrom"))}
                  onChange={(e) => patch({ derivedFrom: e.target.value || undefined })}
                />
                {issueFor("derivedFrom") ? (
                  <span className="rater-ied__error">{issueFor("derivedFrom")}</span>
                ) : null}
              </label>
              <div className="rater-ied__field">
                <span className="rater-ied__label">Computed expression</span>
                <ComputedExprEditor
                  value={
                    draft.derivedExpr ?? {
                      kind: "input",
                      name: otherFieldNames[0] ?? "",
                    }
                  }
                  availableFields={otherFieldNames}
                  onChange={(expr) => patch({ derivedExpr: expr })}
                />
              </div>
            </>
          ) : null}

          <p className="rater-ied__section">Details</p>

          <label className="rater-ied__field">
            <span className="rater-ied__label">Allowed values</span>
            <Input
              inputSize="sm"
              value={(draft.allowedValues ?? []).join(", ")}
              placeholder="comma-separated · leave blank for open"
              aria-label="Allowed values"
              onChange={(e) => {
                const vals = e.target.value
                  .split(",")
                  .map((s) => s.trim())
                  .filter((s) => s !== "");
                patch(vals.length > 0 ? { allowedValues: vals } : { allowedValues: undefined });
              }}
            />
          </label>

          <div className="rater-ied__row2">
            <label className="rater-ied__field">
              <span className="rater-ied__label">Unit</span>
              <Input
                inputSize="sm"
                value={draft.unit ?? ""}
                placeholder="USD"
                aria-label="Unit"
                onChange={(e) => patch({ unit: e.target.value || undefined })}
              />
            </label>
            <label className="rater-ied__field">
              <span className="rater-ied__label">Default</span>
              <DefaultValueControl
                entry={draft}
                hasError={Boolean(issueFor("defaultValue"))}
                onChange={(value) => patch({ defaultValue: value })}
              />
            </label>
          </div>
          {issueFor("defaultValue") ? (
            <span className="rater-ied__error">{issueFor("defaultValue")}</span>
          ) : null}

          <label className="rater-ied__field">
            <span className="rater-ied__label">Description</span>
            <Input
              inputSize="sm"
              value={draft.description ?? ""}
              placeholder="What this field means"
              aria-label="Description"
              onChange={(e) => patch({ description: e.target.value || undefined })}
            />
          </label>

          <label className="rater-ied__field">
            <span className="rater-ied__label">Citation</span>
            <Input
              inputSize="sm"
              value={draft.citation ?? ""}
              placeholder="Filing reference (optional)"
              aria-label="Citation"
              onChange={(e) => patch({ citation: e.target.value || undefined })}
            />
          </label>
        </div>
      </Drawer.Body>

      <Drawer.Footer>
        <div className="rater-ied__footer">
          {mode === "edit" && onDelete && draft.id ? (
            <Button
              variant="danger-text"
              size="sm"
              onClick={() => onDelete(draft.id)}
              disabled={busy}
            >
              <Trash2 size={14} aria-hidden /> Delete
            </Button>
          ) : (
            <span />
          )}
          <div className="rater-ied__footer-right">
            <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={commit} disabled={!canSave || busy}>
              {mode === "add" ? "Add input" : "Save"}
            </Button>
          </div>
        </div>
      </Drawer.Footer>
    </Drawer>
  );
}

// ─────────────────────────────────────────────────────────────────
// Type-aware default control (ported from Brief 52's editor)
// ─────────────────────────────────────────────────────────────────

function DefaultValueControl(props: {
  entry: InputDictEntry;
  hasError?: boolean;
  onChange: (value: string | undefined) => void;
}) {
  const { entry, hasError, onChange } = props;
  const value = entry.defaultValue ?? "";

  if (entry.allowedValues && entry.allowedValues.length > 0) {
    return (
      <select
        className="rater-ied__select"
        value={value}
        aria-label="Default value"
        onChange={(e) => onChange(e.target.value || undefined)}
      >
        <option value="">— none —</option>
        {entry.allowedValues.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </select>
    );
  }
  if (entry.dataType === "bool") {
    return (
      <select
        className="rater-ied__select"
        value={value}
        aria-label="Default value"
        onChange={(e) => onChange(e.target.value || undefined)}
      >
        <option value="">— none —</option>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    );
  }
  return (
    <Input
      inputSize="sm"
      type={isNumericType(entry.dataType) ? "number" : "text"}
      value={value}
      aria-label="Default value"
      hasError={hasError ?? false}
      trailing={entry.unit ? <span className="rater-ied__unit">{entry.unit}</span> : undefined}
      onChange={(e) => onChange(e.target.value || undefined)}
    />
  );
}
