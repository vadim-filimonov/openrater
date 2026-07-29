/**
 * DictionaryTable — the declared-input dictionary, quietly editable.
 *
 * v2 ethos (P0.1): authoring without a busy editor drawer. The calm table
 * looks read-only; editing reveals itself on interaction —
 *   · click a field name → rename it inline (blur / Enter commits, Esc cancels)
 *   · click the type chip → change the type (a select; change commits)
 *   · hover a row → a delete appears (two-click "Remove" to confirm)
 *   · "+ Field" → a draft row (name + type); leaving it / Enter commits
 *
 * Only the two essentials (name + type) are surfaced; the rest of the rich
 * InputDictEntry (enum / unit / derived expr / citation …) is preserved on
 * edit and defaulted on add — hidden until there's a reason to show it.
 */

import { useState } from "react";
import { ListPlus, Plus, Trash2, X } from "lucide-react";
import { Button, EmptyState } from "@openrater/design-system";
import type { PrimitiveType } from "@openrater/contracts";
import type { InputDictEntry } from "../InputDictionary/types";
import "./inputs-v2.css";

/** User-facing type vocabulary (the technical kinds — factor/model/record —
 *  stay out of the picker; an existing exotic value is preserved + appended). */
const TYPE_OPTIONS: readonly { readonly value: PrimitiveType; readonly label: string }[] = [
  { value: "string", label: "Text" },
  { value: "float", label: "Number" },
  { value: "money", label: "Money $" },
  { value: "bool", label: "Yes / No" },
  { value: "date", label: "Date" },
  { value: "pct", label: "Percent" },
  { value: "class_code", label: "Class code" },
];

function typeLabel(t: string): string {
  switch (t) {
    case "money":
      return "Money $";
    case "bool":
      return "Yes / No";
    case "int":
    case "float":
      return "Number";
    case "date":
      return "Date";
    case "pct":
      return "Percent";
    case "class_code":
      return "Class code";
    default:
      return "Text";
  }
}

function typeClass(t: string): string {
  if (t === "money") return "rater-inputs2__type--money";
  if (t === "bool") return "rater-inputs2__type--bool";
  return "";
}

/** Display name → externalInputs key (the load-bearing slug). */
function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** A structure-required input that has not been declared yet (Brief 65
 *  §3.2 — the unified view-model's "required but undeclared" row state). */
export interface GhostInput {
  readonly slug: string;
  readonly name: string;
  /** Where the requirement comes from ("Class factor · Building chain"). */
  readonly requiredBy: string;
  readonly dtype: PrimitiveType;
}

export interface DictionaryTableProps {
  readonly inputs: readonly InputDictEntry[];
  /** When false the table is a pure read-only view (no edit/add/delete). */
  readonly editable: boolean;
  readonly onUpsert?: ((entry: InputDictEntry) => void) | undefined;
  readonly onDelete?: ((id: string) => void) | undefined;
  /** A dictionary mutation is in flight — pause new authoring. */
  readonly busy?: boolean | undefined;
  /** One contextual bulk-declare action (P0.2) — declare missing structure
   *  fields, or declare-from-book columns. Shown quietly in the head. */
  readonly declare?:
    | {
        readonly count: number;
        readonly label: string;
        readonly onDeclare: () => void;
      }
    | undefined;
  /** Structure-required inputs not yet declared — rendered as ghost rows
   *  with a one-click Declare. */
  readonly ghosts?: readonly GhostInput[] | undefined;
  readonly onDeclareGhost?: ((ghost: GhostInput) => void) | undefined;
  /** Slugs the rating structure actually reads. When provided (and
   *  non-empty), declared rows outside it get a quiet "unused" hint. */
  readonly usedSlugs?: ReadonlySet<string> | undefined;
}

export function DictionaryTable({
  inputs,
  editable,
  onUpsert,
  onDelete,
  busy = false,
  declare,
  ghosts = [],
  onDeclareGhost,
  usedSlugs,
}: DictionaryTableProps): JSX.Element {
  const canAuthor = editable && typeof onUpsert === "function";

  const [editNameId, setEditNameId] = useState<string | null>(null);
  const [nameVal, setNameVal] = useState("");
  const [editTypeId, setEditTypeId] = useState<string | null>(null);
  const [adding, setAdding] = useState<{
    displayName: string;
    dataType: PrimitiveType;
  } | null>(null);
  const [armedDeleteId, setArmedDeleteId] = useState<string | null>(null);

  const beginName = (e: InputDictEntry): void => {
    setEditNameId(e.id);
    setNameVal(e.displayName);
  };
  const commitName = (e: InputDictEntry): void => {
    const v = nameVal.trim();
    if (onUpsert && v && v !== e.displayName) onUpsert({ ...e, displayName: v });
    setEditNameId(null);
  };
  const commitType = (e: InputDictEntry, t: PrimitiveType): void => {
    if (onUpsert && t !== e.dataType) onUpsert({ ...e, dataType: t });
    setEditTypeId(null);
  };
  const commitAdd = (): void => {
    if (!adding) return;
    const name = adding.displayName.trim();
    if (onUpsert && name) {
      onUpsert({
        id: "",
        fieldName: slugify(name),
        displayName: name,
        dataType: adding.dataType,
        source: "form",
        required: true,
      });
    }
    setAdding(null);
  };

  const showEmpty = inputs.length === 0 && ghosts.length === 0 && !adding;

  return (
    <>
      <div className="rater-inputs2__dict-head">
        <h3 className="rater-inputs2__sect-title">Plan inputs</h3>
        <div className="rater-inputs2__map-actions">
          <span className="rater-inputs2__dict-count">
            {inputs.length} input{inputs.length === 1 ? "" : "s"} declared
          </span>
          {canAuthor && declare ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={declare.onDeclare}
            >
              {declare.label}
            </Button>
          ) : null}
          {canAuthor ? (
            <Button
              variant="ghost"
              size="sm"
              icon={<Plus />}
              disabled={busy || adding !== null}
              onClick={() => setAdding({ displayName: "", dataType: "string" })}
            >
              Input
            </Button>
          ) : null}
        </div>
      </div>

      {showEmpty ? (
        <EmptyState
          icon={<ListPlus size={24} />}
          title="No inputs declared yet"
          description={`Declare the inputs your plan rates on — TIV, class code, construction.${
            canAuthor ? " Use “+ Input” to start." : ""
          }`}
        />
      ) : (
        <div className="rater-inputs2__tablewrap">
          <table className="rater-inputs2__table rater-inputs2__table--dict">
            <thead>
              <tr>
                <th>Field</th>
                <th>Type</th>
                <th aria-label="Row actions" />
              </tr>
            </thead>
            <tbody>
              {inputs.map((e) => (
                <tr
                  key={e.id}
                  onMouseLeave={() =>
                    setArmedDeleteId((id) => (id === e.id ? null : id))
                  }
                >
                  <td>
                    {editNameId === e.id ? (
                      <input
                        className="rater-inputs2__cell-input"
                        // eslint-disable-next-line jsx-a11y/no-autofocus
                        autoFocus
                        value={nameVal}
                        onChange={(ev) => setNameVal(ev.target.value)}
                        onBlur={() => commitName(e)}
                        onKeyDown={(ev) => {
                          if (ev.key === "Enter") commitName(e);
                          if (ev.key === "Escape") setEditNameId(null);
                        }}
                        aria-label="Field name"
                      />
                    ) : (
                      <button
                        type="button"
                        className={`rater-inputs2__fname-edit${
                          canAuthor ? "" : " is-static"
                        }`}
                        disabled={!canAuthor || busy}
                        onClick={() => canAuthor && beginName(e)}
                      >
                        {e.displayName}
                      </button>
                    )}
                    {/* MVP-012 — the slug line earns its row only when
                        it differs from the name (no slug-over-slug). */}
                    {e.fieldName !== e.displayName ||
                    (usedSlugs && usedSlugs.size > 0 && !usedSlugs.has(e.fieldName)) ? (
                      <div className="rater-inputs2__fslug">
                        {e.fieldName !== e.displayName ? e.fieldName : null}
                        {usedSlugs &&
                        usedSlugs.size > 0 &&
                        !usedSlugs.has(e.fieldName) ? (
                          <span
                            className="rater-inputs2__unused"
                            title="No rating step reads this input yet"
                          >
                            {" "}
                            · not used yet
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                  </td>
                  <td>
                    {editTypeId === e.id ? (
                      <select
                        className="rater-inputs2__select rater-inputs2__select--type"
                        // eslint-disable-next-line jsx-a11y/no-autofocus
                        autoFocus
                        value={e.dataType}
                        onChange={(ev) =>
                          commitType(e, ev.target.value as PrimitiveType)
                        }
                        onBlur={() => setEditTypeId(null)}
                        aria-label="Field type"
                      >
                        {TYPE_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                        {TYPE_OPTIONS.every((o) => o.value !== e.dataType) ? (
                          <option value={e.dataType}>
                            {typeLabel(e.dataType)}
                          </option>
                        ) : null}
                      </select>
                    ) : (
                      <button
                        type="button"
                        className={`rater-inputs2__type ${typeClass(e.dataType)}${
                          canAuthor ? " is-editable" : ""
                        }`}
                        disabled={!canAuthor || busy}
                        onClick={() => canAuthor && setEditTypeId(e.id)}
                      >
                        {typeLabel(e.dataType)}
                      </button>
                    )}
                  </td>
                  <td className="rater-inputs2__rowact">
                    {canAuthor && onDelete ? (
                      armedDeleteId === e.id ? (
                        <button
                          type="button"
                          className="rater-inputs2__del is-armed"
                          disabled={busy}
                          onClick={() => {
                            onDelete(e.id);
                            setArmedDeleteId(null);
                          }}
                        >
                          Remove
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="rater-inputs2__del"
                          disabled={busy}
                          onClick={() => setArmedDeleteId(e.id)}
                          aria-label={`Delete ${e.displayName}`}
                        >
                          <Trash2 size={14} aria-hidden />
                        </button>
                      )
                    ) : null}
                  </td>
                </tr>
              ))}

              {adding ? (
                <tr
                  className="rater-inputs2__draftrow"
                  onBlur={(ev) => {
                    // Commit when focus leaves the whole row (not when tabbing
                    // name → type inside it).
                    if (!ev.currentTarget.contains(ev.relatedTarget as Node)) {
                      commitAdd();
                    }
                  }}
                >
                  <td>
                    <input
                      className="rater-inputs2__cell-input"
                      // eslint-disable-next-line jsx-a11y/no-autofocus
                      autoFocus
                      placeholder="Field name"
                      value={adding.displayName}
                      onChange={(ev) =>
                        setAdding({ ...adding, displayName: ev.target.value })
                      }
                      onKeyDown={(ev) => {
                        if (ev.key === "Enter") commitAdd();
                        if (ev.key === "Escape") setAdding(null);
                      }}
                      aria-label="New field name"
                    />
                    {adding.displayName.trim() ? (
                      <div className="rater-inputs2__fslug">
                        {slugify(adding.displayName)}
                      </div>
                    ) : null}
                  </td>
                  <td>
                    <select
                      className="rater-inputs2__select rater-inputs2__select--type"
                      value={adding.dataType}
                      onChange={(ev) =>
                        setAdding({
                          ...adding,
                          dataType: ev.target.value as PrimitiveType,
                        })
                      }
                      aria-label="New field type"
                    >
                      {TYPE_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="rater-inputs2__rowact">
                    <button
                      type="button"
                      className="rater-inputs2__del"
                      onMouseDown={(ev) => ev.preventDefault()}
                      onClick={() => setAdding(null)}
                      aria-label="Discard new field"
                    >
                      <X size={14} aria-hidden />
                    </button>
                  </td>
                </tr>
              ) : null}

              {ghosts.map((g) => (
                <tr key={`ghost-${g.slug}`} className="rater-inputs2__ghostrow">
                  <td>
                    <div className="rater-inputs2__fname">{g.name}</div>
                    <div className="rater-inputs2__fslug">
                      {g.slug}
                      <span className="rater-inputs2__ghost-origin">
                        {" "}
                        · needed by {g.requiredBy}
                      </span>
                    </div>
                  </td>
                  <td>
                    <span className="rater-inputs2__type">{typeLabel(g.dtype)}</span>
                  </td>
                  <td className="rater-inputs2__rowact">
                    {canAuthor && onDeclareGhost ? (
                      <Button
                        variant="ghost"
                        size="xs"
                        disabled={busy}
                        onClick={() => onDeclareGhost(g)}
                      >
                        Declare
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
