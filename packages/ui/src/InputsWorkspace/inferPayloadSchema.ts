/**
 * inferPayloadSchema — Brief 38 PR 38.7 webhook payload analysis.
 *
 * Pure function. Walks a sample response object (or array of
 * objects) and emits a flat list of leaf field descriptors with
 * inferred dtypes — the same shape `Plan.input_mapping.source` (PR
 * 38.1) persists as `payload_schema.fields[]`.
 *
 * Walks nested objects via dot-path keys ("policy.class_code",
 * "exposure.tiv.bld"). Arrays are NOT recursed into (we emit one
 * field for the array property itself; the user can drill in via
 * a different mechanism if needed).
 *
 * Dtype inference mirrors parseCsv (PR 38.5) for consistency:
 *   - date wins over number for ISO 8601 strings
 *   - number for finite numbers
 *   - boolean for true/false
 *   - string everything else
 *
 * Pure data in / pure data out. No I/O.
 */

import type { MatchDtype } from "./autoMatch";

// ─────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────

/**
 * One leaf field in an inferred schema. Mirrors the substrate shape
 * from PR 38.1 (`payload_schema.fields[]`).
 */
export interface PayloadSchemaField {
  readonly name: string;
  readonly dtype: MatchDtype;
}

export interface InferPayloadSchemaOptions {
  /**
   * Optional JSONPath-lite root selector ("$.data[0]" or
   * "data.records[0]"). When provided, inference starts at that
   * sub-tree instead of the whole sample. Default: undefined.
   */
  readonly rootPath?: string;
  /**
   * Max depth to descend into nested objects. Default 5 — typical
   * insurance webhook payloads nest 2-4 levels deep. Deeper nesting
   * usually indicates the user should pick a deeper root path.
   */
  readonly maxDepth?: number;
  /**
   * When true, arrays at leaf positions are flagged as a separate
   * dtype (the v1 substrate doesn't have array dtypes, so we treat
   * them as "string" for now). Default false.
   */
  readonly treatArraysAsLeaves?: boolean;
}

export interface InferPayloadSchemaResult {
  /** Inferred fields, in document order. */
  readonly fields: readonly PayloadSchemaField[];
  /** Non-blocking warnings (e.g., reached max depth, root path missed). */
  readonly warnings: readonly InferPayloadSchemaWarning[];
}

export interface InferPayloadSchemaWarning {
  readonly kind: "max_depth_reached" | "root_path_missed" | "array_at_root" | "empty_sample";
  readonly message: string;
  readonly path?: string;
}

const DEFAULT_MAX_DEPTH = 5;

// ─────────────────────────────────────────────────────────────────
// JSONPath-lite resolver
// ─────────────────────────────────────────────────────────────────

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T[0-9:.+\-Z]+)?$/;

/**
 * Resolve a simple JSONPath-lite expression against the sample.
 * Supports:
 *   - "$.foo.bar"     — dot navigation from root
 *   - "$.foo[0]"      — array index
 *   - "foo.bar"       — leading "$." optional
 *
 * NOT supported (returns null with a warning):
 *   - Filter expressions ("$.foo[?(@.bar > 1)]")
 *   - Recursive descent ("$..foo")
 *   - Slices ("$.foo[1:3]")
 */
function resolvePath(sample: unknown, path: string): unknown {
  let value: unknown = sample;
  let body = path.trim();
  if (body.startsWith("$.")) body = body.slice(2);
  else if (body.startsWith("$")) body = body.slice(1);
  if (body === "") return value;
  // Split into segments: foo.bar[0].baz → ["foo", "bar", 0, "baz"]
  const segments: (string | number)[] = [];
  const re = /([^.[\]]+)|\[(\d+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    if (m[1] !== undefined) segments.push(m[1]);
    else if (m[2] !== undefined) segments.push(Number(m[2]));
  }
  for (const seg of segments) {
    if (value == null) return undefined;
    if (typeof seg === "number") {
      if (!Array.isArray(value)) return undefined;
      value = value[seg];
    } else {
      if (typeof value !== "object" || Array.isArray(value)) return undefined;
      value = (value as Record<string, unknown>)[seg];
    }
  }
  return value;
}

// ─────────────────────────────────────────────────────────────────
// Dtype inference
// ─────────────────────────────────────────────────────────────────

function inferDtype(value: unknown): MatchDtype {
  if (value == null) return "string";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return Number.isFinite(value) ? "number" : "string";
  if (typeof value === "string") {
    if (ISO_DATE_RE.test(value)) return "date";
    return "string";
  }
  // Array, object, etc. → string fallback (the v1 substrate doesn't
  // have richer dtypes for these).
  return "string";
}

// ─────────────────────────────────────────────────────────────────
// Recursive walk
// ─────────────────────────────────────────────────────────────────

function walk(
  obj: unknown,
  prefix: string,
  depth: number,
  maxDepth: number,
  fields: PayloadSchemaField[],
  warnings: InferPayloadSchemaWarning[],
  treatArraysAsLeaves: boolean,
): void {
  if (depth > maxDepth) {
    warnings.push({
      kind: "max_depth_reached",
      message: `Stopped descent at ${prefix} (max depth ${maxDepth}).`,
      path: prefix,
    });
    return;
  }
  if (obj == null) {
    fields.push({ name: prefix || "(root)", dtype: "string" });
    return;
  }
  if (Array.isArray(obj)) {
    if (treatArraysAsLeaves) {
      fields.push({ name: prefix || "(root)", dtype: "string" });
      return;
    }
    // Recurse into the first element (best-effort).
    if (obj.length === 0) {
      fields.push({ name: prefix || "(root)", dtype: "string" });
      return;
    }
    // Don't add a field for the array; recurse into [0]. The dotted
    // name does NOT include the index — keep paths clean.
    walk(obj[0], prefix, depth, maxDepth, fields, warnings, treatArraysAsLeaves);
    return;
  }
  if (typeof obj === "object") {
    const entries = Object.entries(obj as Record<string, unknown>);
    for (const [k, v] of entries) {
      const childPath = prefix ? `${prefix}.${k}` : k;
      if (v != null && typeof v === "object" && !Array.isArray(v)) {
        walk(v, childPath, depth + 1, maxDepth, fields, warnings, treatArraysAsLeaves);
      } else if (Array.isArray(v) && !treatArraysAsLeaves) {
        // Arrays — descend into first element, no path index.
        if (v.length === 0) {
          fields.push({ name: childPath, dtype: "string" });
        } else {
          walk(v[0], childPath, depth + 1, maxDepth, fields, warnings, treatArraysAsLeaves);
        }
      } else {
        fields.push({ name: childPath, dtype: inferDtype(v) });
      }
    }
    return;
  }
  // Primitive at root — single field at the prefix.
  fields.push({ name: prefix || "(root)", dtype: inferDtype(obj) });
}

// ─────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────

/**
 * Infer a payload schema from a sample response.
 *
 * @param sample The decoded response body — typically the result of
 *   `JSON.parse(responseText)`. Can be an object, array, or
 *   primitive (the last produces a single field).
 * @param options JSONPath root + depth limit + array handling.
 */
export function inferPayloadSchema(
  sample: unknown,
  options: InferPayloadSchemaOptions = {},
): InferPayloadSchemaResult {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const treatArraysAsLeaves = options.treatArraysAsLeaves ?? false;
  const fields: PayloadSchemaField[] = [];
  const warnings: InferPayloadSchemaWarning[] = [];

  let root = sample;
  if (options.rootPath) {
    const resolved = resolvePath(sample, options.rootPath);
    if (resolved === undefined) {
      warnings.push({
        kind: "root_path_missed",
        message: `Path "${options.rootPath}" did not resolve in the sample.`,
        path: options.rootPath,
      });
      // Fall back to the whole sample so we still produce something
      // useful instead of an empty schema.
    } else {
      root = resolved;
    }
  }

  if (root == null || (Array.isArray(root) && root.length === 0)) {
    warnings.push({
      kind: "empty_sample",
      message: "Sample is empty after root resolution.",
    });
    return { fields, warnings };
  }

  if (Array.isArray(root) && !options.rootPath) {
    warnings.push({
      kind: "array_at_root",
      message:
        "Sample is an array; inferring from the first element. Set rootPath (e.g., $.data[0]) for a stable schema.",
    });
  }

  walk(root, "", 0, maxDepth, fields, warnings, treatArraysAsLeaves);
  return { fields, warnings };
}
