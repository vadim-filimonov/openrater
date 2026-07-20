/**
 * <JsonTreePicker> — render an API response as an interactive tree; clicking a
 * node turns it into an output port (the dotted `json_path` is computed for you).
 * This is what makes the hardest part of a connector manifest no-code: nobody
 * hand-writes `result.address.postalAddress.postalCode`.
 *
 * Path convention matches the backend `extract()`: object keys joined by ".",
 * array indices as numeric segments (e.g. `result.items.0.name`).
 */

import { useState } from "react";
import { Check, ChevronDown, ChevronRight, Plus } from "lucide-react";

export interface JsonTreePickerProps {
  data: unknown;
  pickedPaths: ReadonlySet<string>;
  onPick: (path: string, value: unknown) => void;
}

function isContainer(v: unknown): v is Record<string, unknown> | unknown[] {
  return v !== null && typeof v === "object";
}

function entriesOf(v: unknown): Array<[string, unknown]> {
  if (Array.isArray(v)) return v.map((item, i) => [String(i), item] as [string, unknown]);
  if (v !== null && typeof v === "object") return Object.entries(v as Record<string, unknown>);
  return [];
}

function typeLabel(v: unknown): string {
  if (Array.isArray(v)) return `[${v.length}]`;
  if (v !== null && typeof v === "object") return `{${Object.keys(v).length}}`;
  return "";
}

function valuePreview(v: unknown): string {
  if (v === null) return "null";
  if (typeof v === "string") return v.length > 48 ? `"${v.slice(0, 48)}…"` : `"${v}"`;
  if (typeof v === "boolean" || typeof v === "number") return String(v);
  return "";
}

interface NodeProps {
  nodeKey: string;
  value: unknown;
  path: string;
  depth: number;
  pickedPaths: ReadonlySet<string>;
  onPick: (path: string, value: unknown) => void;
}

function Node({ nodeKey, value, path, depth, pickedPaths, onPick }: NodeProps): JSX.Element {
  const container = isContainer(value);
  const [open, setOpen] = useState(depth < 2);
  const picked = pickedPaths.has(path);
  return (
    <div className="jtree__node">
      <div className="jtree__row" style={{ paddingLeft: `${depth * 14}px` }}>
        <button
          type="button"
          className="jtree__caret"
          onClick={() => container && setOpen((o) => !o)}
          aria-label={container ? (open ? "Collapse" : "Expand") : undefined}
          tabIndex={container ? 0 : -1}
        >
          {container ? open ? <ChevronDown size={12} /> : <ChevronRight size={12} /> : null}
        </button>
        <span className="jtree__key">{nodeKey}</span>
        {container ? (
          <span className="jtree__type">{typeLabel(value)}</span>
        ) : (
          <span className="jtree__value">{valuePreview(value)}</span>
        )}
        <button
          type="button"
          className={"jtree__use" + (picked ? " jtree__use--picked" : "")}
          onClick={() => onPick(path, value)}
          title={picked ? "Already an output" : `Use ${path} as an output`}
        >
          {picked ? <Check size={12} /> : <Plus size={12} />}
          {picked ? "added" : "use"}
        </button>
      </div>
      {container && open ? (
        <div className="jtree__children">
          {entriesOf(value).map(([ck, cv]) => (
            <Node
              key={ck}
              nodeKey={ck}
              value={cv}
              path={path ? `${path}.${ck}` : ck}
              depth={depth + 1}
              pickedPaths={pickedPaths}
              onPick={onPick}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function JsonTreePicker({ data, pickedPaths, onPick }: JsonTreePickerProps): JSX.Element {
  const entries = entriesOf(data);
  if (entries.length === 0) {
    return <div className="jtree__empty">No fields in the response yet — run a test call first.</div>;
  }
  return (
    <div className="jtree">
      {entries.map(([k, v]) => (
        <Node
          key={k}
          nodeKey={k}
          value={v}
          path={k}
          depth={0}
          pickedPaths={pickedPaths}
          onPick={onPick}
        />
      ))}
    </div>
  );
}
