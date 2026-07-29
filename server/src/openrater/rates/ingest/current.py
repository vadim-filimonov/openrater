# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Current-state workbook export — the FCA #16 follow-up.

The default export serves the EXACT build-time bytes (owner O1: the
canonical container comes back out, hash-identical). This module
produces the `?current=true` variant: the SAME container with the live
plan state written into the tracked cells, so in-app repairs physically
travel instead of merely being stamped as missing.

Surgical by construction: only the sheet XML parts that carry a rewrite
are re-serialized; every other zip entry — prose sheets, styles,
themes, doc properties — is copied byte-identical. The diff between a
build export and a current export is exactly the touched sheets.

Two tracked classes travel (the same two the divergence machinery
itemizes):

  · factor-table cells from `plan_factor_table_cells` — addressing
    mirrors `_itemize_cell_edits` (1-D sheets key by the level_id row,
    grids by "row::col");
  · gates!value cells from the live `eligibility.gate` stage config —
    matched by rule_id, conditions in suffix order ("", "_2", "_3").

Anything the rewriter cannot place in the workbook's structure (a live
cell whose level has no sheet row, a table the workbook never had, a
rule whose variable/op moved, a removed rule) is NOT silently dropped —
it comes back named in `unapplied`, and the route/MCP surface it.
"""

from __future__ import annotations

import hashlib
import io
import json
import re
import zipfile
from dataclasses import dataclass, field
from typing import Any
from xml.etree import ElementTree as ET

from openpyxl.utils import column_index_from_string

from openrater.rates.ingest.model import FactorTable, ParsedWorkbook
from openrater.rates.ingest.parser import parse_workbook

_MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
_REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
_PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
_DEFAULT_KEY = "__default__"
_COORD_RE = re.compile(r"^([A-Za-z]+)(\d+)$")


@dataclass
class CurrentWorkbook:
    """The rewritten container + the honest ledger of what moved."""

    data: bytes
    sha256: str
    #: Human lines, one per written cell: "ft.x!B9: 1.0 -> 0.85".
    rewrites: list[str] = field(default_factory=list)
    #: Live state with no workbook address — named, never dropped.
    unapplied: list[str] = field(default_factory=list)
    changed_sheets: list[str] = field(default_factory=list)


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _same_scalar(a: Any, b: Any) -> bool:
    """The cell itemizer's equality: numeric when both sides parse
    (1 == 1.0 == "1"), verbatim otherwise. Bools never equal numbers —
    a gate flipping true -> 1 is a type change, not a no-op."""
    if isinstance(a, bool) != isinstance(b, bool):
        return False
    try:
        return a is not None and b is not None and float(a) == float(b)
    except (TypeError, ValueError):
        return a == b


def _same_value(a: Any, b: Any) -> bool:
    if isinstance(a, (list, tuple)) or isinstance(b, (list, tuple)):
        if not isinstance(a, (list, tuple)) or not isinstance(b, (list, tuple)):
            return False
        return len(a) == len(b) and all(
            _same_scalar(x, y) for x, y in zip(a, b, strict=True)
        )
    return _same_scalar(a, b)


def _num_text(v: float) -> str:
    """A REAL back to a cell literal: integral floats write as ints
    (the way openpyxl writes them), everything else as the shortest
    round-trip repr — never a precision-mangling format spec."""
    f = float(v)
    return str(int(f)) if f.is_integer() else repr(f)


def _fmt(v: Any) -> str:
    """A value for the human rewrite/unapplied lines."""
    if v is None:
        return "(blank)"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (list, tuple)):
        return "[" + ", ".join(_fmt(x) for x in v) + "]"
    return str(v)


# ---------------------------------------------------------------------------
# Factor-table cells (class 1)
# ---------------------------------------------------------------------------


def _live_factor_cells(db: Any, rating_plan_id: str) -> dict[str, dict[str, Any]]:
    """slug -> cell_key -> value, from the surface the editor writes —
    the same query `_itemize_cell_edits` runs."""
    conn = db.connection()
    try:
        rows = conn.execute(
            "SELECT t.slug AS slug, c.cell_key AS cell_key, c.value AS value "
            "FROM plan_factor_table_cells c "
            "JOIN plan_factor_tables t "
            "  ON t.rating_plan_id = c.rating_plan_id AND t.table_id = c.table_id "
            "WHERE c.rating_plan_id = ?",
            (rating_plan_id,),
        ).fetchall()
    finally:
        conn.close()
    live: dict[str, dict[str, Any]] = {}
    for r in rows:
        live.setdefault(str(r["slug"]), {})[str(r["cell_key"])] = r["value"]
    return live


def _ft_coordinates(ft: FactorTable) -> dict[str, str | None]:
    """cell_key -> sheet coordinate for every ADDRESSABLE cell slot,
    present or blank. 1-D keys by the level_id row (the factor column
    inferred from any populated row); 2-D keys "row::col" (row number
    from the row label's cell, column letter from the col label's).
    A key that cannot be addressed maps to None."""
    coords: dict[str, str | None] = {}
    if ft.grid or ft.col_labels:
        row_num: dict[str, str] = {}
        for rl in ft.row_labels:
            m = _COORD_RE.match(rl.cell)
            if m:
                row_num[str(rl.value)] = m.group(2)
        col_letter: dict[str, str] = {}
        for cl in ft.col_labels:
            m = _COORD_RE.match(cl.cell)
            if m:
                col_letter[str(cl.value)] = m.group(1)
        for rk, rn in row_num.items():
            for ck, cl_ in col_letter.items():
                coords[f"{rk}::{ck}"] = f"{cl_}{rn}"
        # Present cells carry their own coordinate — trust it over the
        # derived one (they agree unless the sheet is malformed).
        for gc in ft.grid:
            coords[f"{gc.row_key}::{gc.col_key}"] = gc.cell
    else:
        factor_col: str | None = None
        for row in ft.rows_1d:
            ref = row.ref("factor")
            if ref:
                m = _COORD_RE.match(ref)
                if m:
                    factor_col = m.group(1)
                    break
        for row in ft.rows_1d:
            key = str(row.get("level_id"))
            ref = row.ref("factor")
            if ref:
                coords[key] = ref
            elif factor_col is not None:
                coords[key] = f"{factor_col}{row.index}"
            else:
                coords[key] = None
    coords.pop(_DEFAULT_KEY, None)
    return coords


def _built_factor_values(ft: FactorTable) -> dict[str, Any]:
    """cell_key -> as-built value, the `_itemize_cell_edits` convention
    (grid rows key as "row::col"; __default__ is policy, never a cell)."""
    values: dict[str, Any] = {}
    if ft.grid or ft.col_labels:
        for gc in ft.grid:
            values[f"{gc.row_key}::{gc.col_key}"] = gc.factor
    else:
        for row in ft.rows_1d:
            values[str(row.get("level_id"))] = row.get("factor")
    values.pop(_DEFAULT_KEY, None)
    return values


def _collect_factor_writes(
    db: Any,
    rating_plan_id: str,
    parsed: ParsedWorkbook,
    writes: dict[str, dict[str, Any]],
    rewrites: list[str],
    unapplied: list[str],
) -> None:
    live = _live_factor_cells(db, rating_plan_id)
    sheet_slugs: set[str] = set()
    for ft in parsed.factor_tables:
        sheet_slugs.add(ft.slug)
        built = _built_factor_values(ft)
        coords = _ft_coordinates(ft)
        table_live = live.get(ft.slug, {})
        for key in sorted(set(built) | set(table_live)):
            wv = built.get(key)
            lv = table_live.get(key)
            if key in built and key in table_live:
                if _same_scalar(wv, lv):
                    continue
                target = coords.get(key)
                new_value: Any = float(lv)
            elif key in table_live:  # added in-app
                target = coords.get(key)
                new_value = float(lv)
            else:  # deleted in-app -> blank the cell
                target = coords.get(key)
                new_value = None
            if target is None:
                unapplied.append(
                    f"{ft.sheet}: cell '{key}' = {_fmt(lv)} has no "
                    "addressable slot in the sheet (its level/row was "
                    "added in-app) — it lives only in the app."
                )
                continue
            writes.setdefault(ft.sheet, {})[target] = new_value
            rewrites.append(
                f"{ft.sheet}!{target} ({key}): {_fmt(wv)} -> {_fmt(new_value)}"
            )
    for slug in sorted(set(live) - sheet_slugs):
        n = len(live[slug])
        unapplied.append(
            f"factor table '{slug}' ({n} cell{'s' if n != 1 else ''}) "
            "exists in-app but has no ft.* sheet in this workbook — "
            "it lives only in the app."
        )


# ---------------------------------------------------------------------------
# gates!value cells (class 2)
# ---------------------------------------------------------------------------


def _live_gate_rules(
    db: Any, rating_plan_id: str
) -> dict[str, list[dict[str, Any]]]:
    """rule_id -> ordered condition dicts [{variable, op, value}, ...]
    from every live eligibility.gate stage, sequence order. A single-
    comparator rule normalizes to a one-condition list — the inverse of
    the builder's `rule.update(conditions[0])` flattening."""
    conn = db.connection()
    try:
        rows = conn.execute(
            "SELECT config_json FROM rating_plan_stages "
            "WHERE rating_plan_id = ? AND stage_kind = 'eligibility.gate' "
            "ORDER BY sequence",
            (rating_plan_id,),
        ).fetchall()
    finally:
        conn.close()
    out: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        try:
            cfg = json.loads(row["config_json"] or "{}")
        except ValueError:
            continue
        for rule in cfg.get("rules") or []:
            if not isinstance(rule, dict):
                continue
            rule_id = str(rule.get("rule_id") or "")
            if not rule_id or rule_id in out:
                continue
            conds = rule.get("conditions")
            if isinstance(conds, list) and conds:
                out[rule_id] = [
                    {
                        "variable": c.get("variable"),
                        "op": c.get("op"),
                        "value": c.get("value"),
                    }
                    for c in conds
                    if isinstance(c, dict)
                ]
            else:
                out[rule_id] = [
                    {
                        "variable": rule.get("variable"),
                        "op": rule.get("op"),
                        "value": rule.get("value"),
                    }
                ]
    return out


def _gate_cell_literal(value: Any) -> tuple[Any, str | None]:
    """A live gate value back to a gates-sheet cell literal — the
    inverse of the builder's `_gate_value`/`_gate_scalar_typed`.
    Booleans write the spec §2.1 spellings; lists write the in/nin
    comma grammar. Returns (cell_value, refusal) — refusal is the named
    reason a value cannot round-trip through the sheet grammar."""
    if value is None:
        return None, None
    if isinstance(value, bool):
        return "true" if value else "false", None
    if isinstance(value, (int, float)):
        return value, None
    if isinstance(value, (list, tuple)):
        parts: list[str] = []
        for item in value:
            if isinstance(item, bool):
                parts.append("true" if item else "false")
            else:
                parts.append(str(item))
        if any("," in p for p in parts):
            return None, (
                "a list member contains a comma, which the sheet's "
                "comma-separated in/nin grammar cannot carry"
            )
        return ", ".join(parts), None
    return str(value), None


def _collect_gate_writes(
    db: Any,
    rating_plan_id: str,
    parsed: ParsedWorkbook,
    writes: dict[str, dict[str, Any]],
    rewrites: list[str],
    unapplied: list[str],
) -> None:
    if parsed.gates is None:
        return
    # The builder types gate literals against the bound input's declared
    # data_type — compare through the same coercion so "5000000" vs
    # 5000000 is a no-op, not a rewrite.
    from openrater.rates.ingest.builder import _gate_value

    input_types: dict[str, str] = {}
    if parsed.inputs is not None:
        for row in parsed.inputs.rows:
            name, dt = row.get("name"), row.get("data_type")
            if name is not None and dt is not None:
                input_types[str(name)] = str(dt)

    live = _live_gate_rules(db, rating_plan_id)
    sheet = parsed.gates.sheet
    seen_rule_ids: set[str] = set()
    for row in parsed.gates.rows:
        raw_rule_id = row.get("rule_id")
        if raw_rule_id is None:
            continue
        rule_id = str(raw_rule_id)
        if rule_id == _DEFAULT_KEY:
            continue
        seen_rule_ids.add(rule_id)
        live_conds = live.get(rule_id)
        if live_conds is None:
            unapplied.append(
                f"{sheet}: rule '{rule_id}' no longer exists in-app "
                "(removed or renamed) — its row still carries the "
                "as-built values."
            )
            continue
        wb_suffixes = [
            s for s in ("", "_2", "_3") if row.get(f"variable{s}") is not None
        ]
        if len(wb_suffixes) != len(live_conds):
            unapplied.append(
                f"{sheet}: rule '{rule_id}' changed shape in-app "
                f"({len(live_conds)} condition"
                f"{'s' if len(live_conds) != 1 else ''} vs "
                f"{len(wb_suffixes)} in the workbook) — the row keeps "
                "the as-built conditions."
            )
            continue
        for suffix, cond in zip(wb_suffixes, live_conds, strict=True):
            wb_var = str(row.get(f"variable{suffix}"))
            wb_op = str(row.get(f"op{suffix}"))
            if str(cond.get("variable")) != wb_var or str(cond.get("op")) != wb_op:
                unapplied.append(
                    f"{sheet}: rule '{rule_id}' condition{suffix or ''} "
                    f"changed comparator in-app ({wb_var} {wb_op} -> "
                    f"{cond.get('variable')} {cond.get('op')}) — the row "
                    "keeps the as-built comparator and value."
                )
                continue
            wb_typed = _gate_value(
                wb_op, row.get(f"value{suffix}"), input_types.get(wb_var)
            )
            live_value = cond.get("value")
            if _same_value(wb_typed, live_value):
                continue
            target = row.ref(f"value{suffix}")
            if target is None:
                unapplied.append(
                    f"{sheet}: rule '{rule_id}' value{suffix} cell is "
                    "blank in the workbook and its column cannot be "
                    "located — the live value lives only in the app."
                )
                continue
            cell_value, refusal = _gate_cell_literal(live_value)
            if refusal is not None:
                unapplied.append(
                    f"{sheet}: rule '{rule_id}' value{suffix} — {refusal}."
                )
                continue
            writes.setdefault(sheet, {})[target] = cell_value
            rewrites.append(
                f"{sheet}!{target} (rule '{rule_id}' value{suffix}): "
                f"{_fmt(row.get(f'value{suffix}'))} -> {_fmt(live_value)}"
            )
    for rule_id in sorted(set(live) - seen_rule_ids):
        unapplied.append(
            f"{sheet}: rule '{rule_id}' was added in-app and has no row "
            "in this workbook — it lives only in the app."
        )


# ---------------------------------------------------------------------------
# The surgical container patch
# ---------------------------------------------------------------------------


def _sheet_paths(zf: zipfile.ZipFile) -> dict[str, str]:
    """Sheet name -> zip entry path, via workbook.xml + its rels."""
    wb_root = ET.fromstring(zf.read("xl/workbook.xml"))
    rels_root = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
    targets: dict[str, str] = {}
    for rel in rels_root.findall(f"{{{_PKG_REL_NS}}}Relationship"):
        rid, target = rel.get("Id"), rel.get("Target")
        if rid and target:
            targets[rid] = target
    paths: dict[str, str] = {}
    sheets = wb_root.find(f"{{{_MAIN_NS}}}sheets")
    if sheets is None:
        return paths
    for sheet in sheets.findall(f"{{{_MAIN_NS}}}sheet"):
        name = sheet.get("name")
        rid = sheet.get(f"{{{_REL_NS}}}id")
        target = targets.get(rid or "")
        if not name or not target:
            continue
        paths[name] = target.lstrip("/") if target.startswith("/") else f"xl/{target}"
    return paths


def _set_cell(cell: ET.Element, value: Any) -> None:
    """Write a value into a `<c>` element in place: numbers as `<v>`,
    strings as inline strings (never touching sharedStrings.xml), None
    as a blank cell. The style attribute survives; `t` is rewritten."""
    for child in list(cell):
        cell.remove(child)
    cell.attrib.pop("t", None)
    if value is None:
        return
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        v = ET.SubElement(cell, f"{{{_MAIN_NS}}}v")
        v.text = _num_text(value) if isinstance(value, float) else str(value)
        return
    cell.set("t", "inlineStr")
    is_el = ET.SubElement(cell, f"{{{_MAIN_NS}}}is")
    t_el = ET.SubElement(is_el, f"{{{_MAIN_NS}}}t")
    text = str(value)
    if text != text.strip():
        t_el.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
    t_el.text = text


def _patch_sheet_xml(
    xml: bytes, cell_writes: dict[str, Any]
) -> tuple[bytes, list[str]]:
    """Rewrite the given coordinates inside one worksheet part.
    Returns (new_xml, failed_coords) — a coordinate whose row element
    does not exist cannot be placed (the caller only targets rows that
    hold a key cell, so this is a malformed-container guard, not a
    normal path)."""
    ET.register_namespace("", _MAIN_NS)
    ET.register_namespace("r", _REL_NS)
    root = ET.fromstring(xml)
    sheet_data = root.find(f"{{{_MAIN_NS}}}sheetData")
    failed: list[str] = []
    if sheet_data is None:
        return xml, sorted(cell_writes)
    rows_by_num: dict[str, ET.Element] = {}
    implicit = 0
    for row_el in sheet_data.findall(f"{{{_MAIN_NS}}}row"):
        r = row_el.get("r")
        if r is None:
            implicit += 1
            r = str(implicit)
        else:
            implicit = int(r)
        rows_by_num[r] = row_el
    for coord in sorted(cell_writes):
        m = _COORD_RE.match(coord)
        if m is None:
            failed.append(coord)
            continue
        col_letters, row_num = m.group(1).upper(), m.group(2)
        row_el = rows_by_num.get(row_num)
        if row_el is None:
            failed.append(coord)
            continue
        target_cell: ET.Element | None = None
        for cell_el in row_el.findall(f"{{{_MAIN_NS}}}c"):
            if cell_el.get("r") == coord:
                target_cell = cell_el
                break
        if target_cell is None:
            target_cell = ET.Element(f"{{{_MAIN_NS}}}c", {"r": coord})
            col_idx = column_index_from_string(col_letters)
            insert_at = len(list(row_el))
            for i, sibling in enumerate(row_el):
                sib_ref = sibling.get("r") or ""
                sm = _COORD_RE.match(sib_ref)
                if sm and column_index_from_string(sm.group(1).upper()) > col_idx:
                    insert_at = i
                    break
            row_el.insert(insert_at, target_cell)
        _set_cell(target_cell, cell_writes[coord])
    return (
        ET.tostring(root, encoding="UTF-8", xml_declaration=True),
        failed,
    )


def _rebuild_container(blob: bytes, patched: dict[str, bytes]) -> bytes:
    """The original zip, entry for entry, in order — every entry not in
    `patched` copied with its own metadata so its bytes stay identical."""
    out_buf = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(blob)) as src, zipfile.ZipFile(
        out_buf, "w"
    ) as out:
        for info in src.infolist():
            data = patched.get(info.filename)
            out.writestr(info, src.read(info.filename) if data is None else data)
    return out_buf.getvalue()


# ---------------------------------------------------------------------------
# The entry point
# ---------------------------------------------------------------------------


def rewrite_workbook_to_current(
    db: Any, rating_plan_id: str, blob: bytes
) -> CurrentWorkbook:
    """The as-built container with the live plan state written into the
    tracked cells. Zero divergence returns the blob unchanged (the
    build bytes ARE current); otherwise only the touched sheets'
    entries differ from the build export."""
    parsed, _ = parse_workbook(blob)
    writes: dict[str, dict[str, Any]] = {}
    rewrites: list[str] = []
    unapplied: list[str] = []
    _collect_factor_writes(
        db, rating_plan_id, parsed, writes, rewrites, unapplied
    )
    _collect_gate_writes(db, rating_plan_id, parsed, writes, rewrites, unapplied)
    if not writes:
        return CurrentWorkbook(
            data=blob, sha256=_sha256(blob), unapplied=unapplied
        )
    with zipfile.ZipFile(io.BytesIO(blob)) as zf:
        paths = _sheet_paths(zf)
        patched: dict[str, bytes] = {}
        changed_sheets: list[str] = []
        for sheet_name in sorted(writes):
            path = paths.get(sheet_name)
            if path is None or path not in zf.namelist():
                unapplied.append(
                    f"{sheet_name}: worksheet entry not found in the "
                    "container — its rewrites could not be applied."
                )
                continue
            new_xml, failed = _patch_sheet_xml(zf.read(path), writes[sheet_name])
            for coord in failed:
                unapplied.append(
                    f"{sheet_name}!{coord}: the row element is missing "
                    "from the sheet XML — the rewrite could not be placed."
                )
            patched[path] = new_xml
            changed_sheets.append(sheet_name)
    data = _rebuild_container(blob, patched) if patched else blob
    return CurrentWorkbook(
        data=data,
        sha256=_sha256(data),
        rewrites=rewrites,
        unapplied=unapplied,
        changed_sheets=changed_sheets,
    )


def current_filename(filename: str) -> str:
    """The '-current' filename: never claims to be the build container."""
    if filename.lower().endswith(".xlsx"):
        return filename[: -len(".xlsx")] + "-current.xlsx"
    return filename + "-current"
