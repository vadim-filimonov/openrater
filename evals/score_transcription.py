#!/usr/bin/env python3
# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""The transcription eval harness (v0) — score an ATTEMPT workbook
against the Meridian reference filing's GOLDEN workbook.

The product bet is "AI transcribes the filing; the platform is
deterministic". This scorer is the instrument for that bet: given a
workbook produced by a model reading
`docs/specs/examples/meridian-shopfront-bop/meridian_shopfront_bop_filing.pdf`,
it grades the transcription on four axes, deterministically, with no
model in the loop:

  1. check      — does the attempt pass the spec-v1.0 deterministic
                  check (the same one the build door runs)?
  2. cells      — factor-cell accuracy vs the golden: every 1-D level,
                  2-D matrix cell, and geo ZIP row, keyed and compared.
  3. examples   — worked-example fidelity: the filing states 8 fully
                  worked examples (Rule G.1); the attempt's test_cases
                  sheet must reproduce their inputs, totals, and tiers.
  4. gaps       — honesty: the filing contains TWO application-default
                  conventions (Rule A.4) that must be RECORDED as
                  gaps/assumptions, never silently approximated.

With `--api <url>` it additionally exercises the LIVE seam: build the
attempt through the server's ingest door, then quote the 8 worked
examples and compare premiums against the filing's stated totals
(premium parity — the money metric).

Usage:
    server/.venv/bin/python evals/score_transcription.py ATTEMPT.xlsx
        [--golden PATH] [--api http://127.0.0.1:8021] [--json OUT.json]

Exit code 0 = PASS (every axis at its bar), 1 = FAIL, 2 = usage error.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "server" / "src"))

from openrater.rates.ingest.model import ParsedWorkbook  # noqa: E402
from openrater.rates.ingest.service import check_workbook_with_model  # noqa: E402

GOLDEN_DEFAULT = (
    REPO
    / "docs/specs/examples/meridian-shopfront-bop/meridian_shopfront_bop.workbook.xlsx"
)

#: The filing's Rule A.4 conventions. Each must be CAPTURED, not
#: silently dropped — either recorded as a gaps/assumptions row (any
#: keyword in description/related/impact) OR encoded as the named
#: input's default_value with the filing's stated default. Both are
#: honest transcriptions; dropping the convention is the defect.
GAP_TOPICS: dict[str, dict[str, Any]] = {
    "sprinkler_default": {
        "keywords": ("sprinkler",),
        "input": "sprinklered",
        "default": False,
    },
    "years_in_business_default": {
        "keywords": ("years_in_business", "years in business", "tenure"),
        "input": "years_in_business",
        "default": 5,
    },
}

INPUT_FIELDS = (
    "class_code",
    "building_limit",
    "bpp_limit",
    "annual_gross_sales",
    "construction_class",
    "protection_class",
    "zip",
    "sprinklered",
    "years_in_business",
)


# ── Parsing ──────────────────────────────────────────────────────────


def parse(path: Path) -> tuple[Any, ParsedWorkbook]:
    result, model = check_workbook_with_model(
        path.read_bytes(), filename=path.name
    )
    return result, model


# ── Axis 1: the deterministic check ──────────────────────────────────


def score_check(result: Any) -> dict[str, Any]:
    return {
        "ok": result.ok,
        "errors": [f"{i.rule} {i.sheet or ''}!{i.cell or ''} {i.message}" for i in result.errors],
        "warning_count": len(result.warnings),
        "notice_count": len(result.notices),
    }


# ── Axis 2: factor-cell accuracy ─────────────────────────────────────


def _num(v: Any) -> float | None:
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    try:
        return float(str(v).strip())
    except (TypeError, ValueError):
        return None


def _values_equal(a: Any, b: Any) -> bool:
    na, nb = _num(a), _num(b)
    if na is not None and nb is not None:
        return math.isclose(na, nb, rel_tol=1e-9, abs_tol=1e-12)
    return str(a).strip() == str(b).strip()


def _geo_ref_joins(model: ParsedWorkbook) -> dict[str, dict[str, str]]:
    """Per dimension: the workbook's OWN declared territory_ref →
    level_id join (what the builder honors when it translates a geo
    sheet's territory_code into the level id factor tables rate by)."""
    joins: dict[str, dict[str, str]] = {}
    for r in model.dimension_levels.rows if model.dimension_levels else []:
        vals = {k: cv.value for k, cv in r.cells.items()}
        ref, level = vals.get("territory_ref"), vals.get("level_id")
        if ref is not None and level is not None:
            joins.setdefault(str(vals.get("dimension_slug")), {})[str(ref)] = str(
                level
            )
    return joins


def cell_inventory(model: ParsedWorkbook) -> dict[tuple[str, str], Any]:
    """Every ratable cell in the workbook, keyed (table, cell_key).
    Geo row values are canonicalized through the workbook's own
    ref→level join — the inventory holds the SEMANTIC territory id,
    exactly as the builder rates it."""
    inv: dict[tuple[str, str], Any] = {}
    for ft in model.factor_tables:
        for row in ft.rows_1d:
            level = row.cells.get("level_id")
            factor = row.cells.get("factor")
            if level is not None and factor is not None:
                inv[(ft.slug, str(level.value))] = factor.value
        for g in ft.grid:
            inv[(ft.slug, f"{g.row_key}::{g.col_key}")] = g.factor
    joins = _geo_ref_joins(model)
    for geo in model.geo_sheets:
        cols = geo.table.columns
        if not cols:
            continue
        join = joins.get(geo.slug, {})
        key_col, val_col = cols[0], cols[1] if len(cols) > 1 else cols[0]
        for row in geo.table.rows:
            k, v = row.cells.get(key_col), row.cells.get(val_col)
            if k is not None and v is not None:
                inv[(f"geo:{geo.slug}", str(k.value))] = join.get(
                    str(v.value), v.value
                )
    return inv


# ── Naming alignment ─────────────────────────────────────────────────
#
# Slugs, band level ids, and (some) input names are TRANSCRIBER
# choices — the filing states concepts and codes, not snake_case.
# Two faithful transcriptions may differ in every slug while agreeing
# on every number. The alignment layer maps the attempt's naming onto
# the golden's so the cell/example/live axes compare VALUES, never
# naming taste. Values are still compared exactly; only names are
# translated, and every tolerated rename is reported.


def _tokens(s: Any) -> set[str]:
    import re

    return {t for t in re.split(r"[^a-z0-9]+", str(s).lower()) if t}


_SYNONYMS = [
    {"prop", "property", "bldg"},
    {"liab", "liability"},
    {"constr", "construction"},
    {"prot", "protection"},
    {"terr", "territory"},
    {"spr", "sprinkler", "sprinklered"},
    {"rel", "relativity", "ilf", "factor", "factors"},
    {"sales", "gross"},
    {"class", "classification"},
    {"band", "bands", "banded", "limit"},
    {"yr", "year", "years"},
]


def _canon_tokens(s: Any) -> set[str]:
    out = set()
    for t in _tokens(s):
        for group in _SYNONYMS:
            if t in group:
                t = sorted(group)[0]
                break
        out.add(t)
    return out


def _tok_score(a: Any, b: Any) -> int:
    return len(_canon_tokens(a) & _canon_tokens(b))


def _best_map(
    golden_names: list[str], attempt_names: list[str]
) -> dict[str, str]:
    """Greedy 1:1 map golden→attempt: exact names first, then highest
    token overlap (ties broken by name; zero-overlap never maps)."""
    mapping: dict[str, str] = {}
    free_a = set(attempt_names)
    for g in golden_names:
        if g in free_a:
            mapping[g] = g
            free_a.discard(g)
    scored = sorted(
        (
            (-_tok_score(g, a), g, a)
            for g in golden_names
            if g not in mapping
            for a in free_a
            if _tok_score(g, a) > 0
        ),
    )
    for neg, g, a in scored:
        if g not in mapping and a in free_a:
            mapping[g] = a
            free_a.discard(a)
    return mapping


def _dim_rows(model: ParsedWorkbook) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for r in model.dimensions.rows if model.dimensions else []:
        vals = {k: cv.value for k, cv in r.cells.items()}
        slug = str(vals.get("slug", "")).strip()
        if slug:
            out[slug] = vals
    return out


def _levels_by_dim(model: ParsedWorkbook) -> dict[str, list[dict[str, Any]]]:
    out: dict[str, list[dict[str, Any]]] = {}
    for r in model.dimension_levels.rows if model.dimension_levels else []:
        vals = {k: cv.value for k, cv in r.cells.items()}
        out.setdefault(str(vals.get("dimension_slug", "")).strip(), []).append(vals)
    return out


class Alignment:
    """golden-name → attempt-name maps for dims, levels, tables, inputs."""

    def __init__(self, golden: ParsedWorkbook, attempt: ParsedWorkbook) -> None:
        g_dims, a_dims = _dim_rows(golden), _dim_rows(attempt)
        # Dimensions: only map within the same shape (banded↔banded …).
        self.dim_map: dict[str, str] = {}
        for shape in {str(v.get("shape")) for v in g_dims.values()}:
            gs = [s for s, v in g_dims.items() if str(v.get("shape")) == shape]
            as_ = [s for s, v in a_dims.items() if str(v.get("shape")) == shape]
            self.dim_map.update(_best_map(gs, as_))

        # Levels per dimension: banded align by their `min` bound
        # (the filing's band edges are canonical); categorical align
        # by exact id, then label tokens.
        g_lv, a_lv = _levels_by_dim(golden), _levels_by_dim(attempt)
        self.level_maps: dict[str, dict[str, str]] = {}
        for g_dim, a_dim in self.dim_map.items():
            grows, arows = g_lv.get(g_dim, []), a_lv.get(a_dim, [])
            lm: dict[str, str] = {}
            banded = any(_num(r.get("min")) is not None for r in grows)
            if banded:
                a_by_min = {
                    _num(r.get("min")): str(r.get("level_id"))
                    for r in arows
                    if _num(r.get("min")) is not None
                }
                for r in grows:
                    mn = _num(r.get("min"))
                    if mn in a_by_min:
                        lm[str(r.get("level_id"))] = a_by_min[mn]
            if not banded or not lm:
                lm.update(
                    _best_map(
                        [str(r.get("level_id")) for r in grows],
                        [str(r.get("level_id")) for r in arows],
                    )
                )
                # Unresolved categorical ids: try label tokens.
                a_free = {str(r.get("level_id")) for r in arows} - set(lm.values())
                for r in grows:
                    gid = str(r.get("level_id"))
                    if gid in lm:
                        continue
                    best = sorted(
                        (
                            (-_tok_score(r.get("label"), ar.get("label")), str(ar.get("level_id")))
                            for ar in arows
                            if str(ar.get("level_id")) in a_free
                            and _tok_score(r.get("label"), ar.get("label")) > 0
                        )
                    )
                    if best:
                        lm[gid] = best[0][1]
                        a_free.discard(best[0][1])
            self.level_maps[g_dim] = lm

        # Factor tables: group by (mapped row_dim, mapped col_dim),
        # disambiguate within a group by slug tokens (prop vs liab …).
        def keyed(fts, dim_translate):
            out: dict[tuple[str, str], list] = {}
            for f in fts:
                rd = dim_translate(str(f.meta_value("row_dimension") or ""))
                cd = dim_translate(str(f.meta_value("col_dimension") or ""))
                out.setdefault((rd, cd), []).append(f)
            return out

        g_groups = keyed(golden.factor_tables, lambda d: d)
        a_groups = keyed(attempt.factor_tables, lambda d: {
            v: k for k, v in self.dim_map.items()
        }.get(d, d))
        self.table_map: dict[str, str] = {}
        self.table_dims: dict[str, tuple[str, str]] = {}
        for key, gts in g_groups.items():
            ats = a_groups.get(key, [])
            m = _best_map([f.slug for f in gts], [f.slug for f in ats])
            self.table_map.update(m)
            for f in gts:
                self.table_dims[f.slug] = key

        # Geo sheets: mapped by their dimension-ish slug.
        self.geo_map = _best_map(
            [g.slug for g in golden.geo_sheets],
            [g.slug for g in attempt.geo_sheets],
        )

        # Inputs: exact + tokens (data types are few; tokens carry it).
        g_in = [
            str(r.cells["name"].value)
            for r in (golden.inputs.rows if golden.inputs else [])
        ]
        a_in = [
            str(r.cells["name"].value)
            for r in (attempt.inputs.rows if attempt.inputs else [])
        ]
        self.input_map = _best_map(g_in, a_in)

    def renames(self) -> dict[str, dict[str, str]]:
        strip = lambda m: {g: a for g, a in m.items() if g != a}
        return {
            "dimensions": strip(self.dim_map),
            "tables": strip(self.table_map),
            "inputs": strip(self.input_map),
            "levels": {
                d: {g: a for g, a in lm.items() if g != a}
                for d, lm in self.level_maps.items()
                if any(g != a for g, a in lm.items())
            },
        }

    def _level(self, g_dim: str, gid: str) -> str:
        return self.level_maps.get(g_dim, {}).get(gid, gid)

    def translate_golden_geo_value(self, geo_slug: str, value: Any) -> Any:
        """Geo row VALUES are level ids of the sheet's dimension (a geo
        sheet's slug names its dimension) — internal references, so
        they compare through the same level map as any level id."""
        return self.level_maps.get(geo_slug, {}).get(str(value), value)

    def translate_golden_key(self, table: str, key: str) -> tuple[str, str] | None:
        """(golden table, golden key) → (attempt table, attempt key)."""
        if table.startswith("geo:"):
            a = self.geo_map.get(table[4:])
            return (f"geo:{a}", key) if a else None
        a_table = self.table_map.get(table)
        if a_table is None:
            return None
        row_dim, col_dim = self.table_dims.get(table, ("", ""))
        if "::" in key:
            r, c = key.split("::", 1)
            return (a_table, f"{self._level(row_dim, r)}::{self._level(col_dim, c)}")
        return (a_table, self._level(row_dim, key))


def score_cells(
    golden: ParsedWorkbook,
    attempt: ParsedWorkbook,
    alignment: Alignment | None = None,
) -> dict[str, Any]:
    align = alignment or Alignment(golden, attempt)
    g, a = cell_inventory(golden), cell_inventory(attempt)
    wrong: list[dict[str, Any]] = []
    missing: list[str] = []
    consumed: set[tuple[str, str]] = set()
    for (t, k) in sorted(g.keys()):
        translated = align.translate_golden_key(t, k)
        if translated is None or translated not in a:
            missing.append(f"{t}:{k}")
            continue
        consumed.add(translated)
        gv = g[(t, k)]
        if t.startswith("geo:"):
            gv = align.translate_golden_geo_value(t[4:], gv)
        if not _values_equal(gv, a[translated]):
            wrong.append(
                {"table": t, "key": k, "golden": g[(t, k)], "attempt": a[translated]}
            )
    extra = sorted(f"{t}:{k}" for (t, k) in a.keys() - consumed)
    matched = len(g) - len(missing) - len(wrong)
    return {
        "golden_cells": len(g),
        "matched": matched,
        "accuracy": round(matched / len(g), 4) if g else 1.0,
        "wrong_value": wrong,
        "missing": missing,
        "extra": extra,
    }


# ── Axis 3: worked-example fidelity ──────────────────────────────────


def _cases(model: ParsedWorkbook) -> dict[str, dict[str, Any]]:
    if model.test_cases is None:
        return {}
    out: dict[str, dict[str, Any]] = {}
    for row in model.test_cases.rows:
        vals = {k: cv.value for k, cv in row.cells.items()}
        cid = str(vals.get("case_id", "")).strip()
        if cid:
            out[cid] = vals
    return out


def score_examples(
    golden: ParsedWorkbook,
    attempt: ParsedWorkbook,
    alignment: Alignment | None = None,
) -> dict[str, Any]:
    align = alignment or Alignment(golden, attempt)
    imap = align.input_map
    g, a = _cases(golden), _cases(attempt)
    findings: list[str] = []
    input_ok = total_ok = tier_ok = 0
    for cid, grow in sorted(g.items()):
        arow = a.get(cid)
        if arow is None:
            findings.append(f"{cid}: missing from attempt test_cases")
            continue
        bad_inputs = [
            f
            for f in INPUT_FIELDS
            if not _values_equal(grow.get(f), arow.get(imap.get(f, f)))
        ]
        if bad_inputs:
            findings.append(f"{cid}: inputs differ ({', '.join(bad_inputs)})")
        else:
            input_ok += 1
        gt, at = _num(grow.get("expected_total_premium")), _num(
            arow.get("expected_total_premium")
        )
        if gt is not None and at is not None and abs(gt - at) <= 0.5:
            total_ok += 1
        else:
            findings.append(
                f"{cid}: expected_total_premium {at} (filing states {gt})"
            )
        if str(grow.get("expected_tier", "")).strip() == str(
            arow.get("expected_tier", "")
        ).strip():
            tier_ok += 1
        else:
            findings.append(
                f"{cid}: expected_tier {arow.get('expected_tier')!r} "
                f"(filing states {grow.get('expected_tier')!r})"
            )
    extra = sorted(set(a) - set(g))
    if extra:
        findings.append(f"extra cases not in the filing: {', '.join(extra)}")
    return {
        "filing_cases": len(g),
        "transcribed": len(set(a) & set(g)),
        "inputs_faithful": input_ok,
        "totals_match": total_ok,
        "tiers_match": tier_ok,
        "findings": findings,
    }


# ── Axis 4: gap honesty ──────────────────────────────────────────────


def _bool_or_num(v: Any) -> Any:
    if isinstance(v, bool):
        return v
    s = str(v).strip().lower()
    if s in ("true", "yes"):
        return True
    if s in ("false", "no"):
        return False
    n = _num(v)
    return n if n is not None else s


def score_gaps(
    attempt: ParsedWorkbook, alignment: Alignment | None = None
) -> dict[str, Any]:
    imap = alignment.input_map if alignment else {}
    rows = attempt.gaps.rows if attempt.gaps is not None else []
    texts = [
        " ".join(
            str(cv.value).lower()
            for k, cv in row.cells.items()
            if k in ("description", "related", "impact")
        )
        for row in rows
    ]
    defaults = {
        str(r.cells["name"].value): r.cells.get("default_value")
        for r in (attempt.inputs.rows if attempt.inputs else [])
    }
    matched, via_default, missing = [], [], []
    for topic, spec in GAP_TOPICS.items():
        if any(any(kw in t for kw in spec["keywords"]) for t in texts):
            matched.append(topic)
            continue
        dv = defaults.get(imap.get(spec["input"], spec["input"]))
        if dv is not None and _bool_or_num(dv.value) == _bool_or_num(spec["default"]):
            matched.append(topic)
            via_default.append(topic)
            continue
        missing.append(topic)
    return {
        "recorded_rows": len(rows),
        "expected_topics": sorted(GAP_TOPICS),
        "matched_topics": matched,
        "captured_as_input_default": via_default,
        "missing_topics": missing,
    }


# ── Live seam: build + quote parity ──────────────────────────────────


def _http(method: str, url: str, body: bytes | None = None, ctype: str | None = None) -> Any:
    req = urllib.request.Request(url, data=body, method=method)
    if ctype:
        req.add_header("Content-Type", ctype)
    with urllib.request.urlopen(req, timeout=120) as res:
        return json.loads(res.read().decode("utf-8"))


XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def score_live(
    api: str,
    attempt_path: Path,
    golden: ParsedWorkbook,
    alignment: Alignment | None = None,
) -> dict[str, Any]:
    imap = alignment.input_map if alignment else {}
    api = api.rstrip("/")
    data = attempt_path.read_bytes()
    check = _http(
        "POST",
        f"{api}/api/v1/plans/ingest/check?filename={attempt_path.name}",
        data,
        XLSX_MIME,
    )
    already = (check.get("already_built") or {}).get("rating_plan_id")
    if already:
        plan_id = already
    else:
        try:
            build = _http(
                "POST",
                f"{api}/api/v1/plans/ingest?filename={attempt_path.name}",
                data,
                XLSX_MIME,
            )
        except urllib.error.HTTPError as exc:  # refusal is a result, not a crash
            detail = exc.read().decode("utf-8", "replace")[:500]
            return {"built": False, "refusal": f"HTTP {exc.code}: {detail}"}
        plan_id = build.get("rating_plan_id") or (build.get("plan") or {}).get(
            "rating_plan_id"
        )
    parity: list[dict[str, Any]] = []
    exact = tiers = 0
    for cid, grow in sorted(_cases(golden).items()):
        inputs = {imap.get(f, f): grow.get(f) for f in INPUT_FIELDS}
        q = _http(
            "POST",
            f"{api}/api/v1/plans/{plan_id}/quote?draft=true",
            json.dumps({"inputs": inputs}).encode(),
            "application/json",
        )
        premium = _num(q.get("premium"))
        expected = _num(grow.get("expected_total_premium"))
        delta = (
            None
            if premium is None or expected is None
            else round(premium - expected, 2)
        )
        tier_match = str(q.get("tier") or "") == str(grow.get("expected_tier") or "")
        if delta is not None and abs(delta) <= 0.5:
            exact += 1
        if tier_match:
            tiers += 1
        parity.append(
            {
                "case_id": cid,
                "row_status": q.get("row_status"),
                "premium": premium,
                "filing_total": expected,
                "delta": delta,
                "tier_ok": tier_match,
            }
        )
    return {
        "built": True,
        "plan_id": plan_id,
        "cases": len(parity),
        "premiums_exact": exact,
        "tiers_match": tiers,
        "max_abs_delta": max(
            (abs(p["delta"]) for p in parity if p["delta"] is not None), default=None
        ),
        "parity": parity,
    }


# ── Verdict + CLI ────────────────────────────────────────────────────


def verdict(report: dict[str, Any]) -> tuple[bool, list[str]]:
    bars: list[tuple[str, bool]] = [
        ("check passes with zero errors", report["check"]["ok"]),
        ("every factor cell matches the filing", report["cells"]["accuracy"] == 1.0
         and not report["cells"]["missing"]),
        (
            "all worked examples transcribed with the filing's totals + tiers",
            report["examples"]["totals_match"] == report["examples"]["filing_cases"]
            and report["examples"]["tiers_match"] == report["examples"]["filing_cases"],
        ),
        ("both Rule A.4 conventions recorded as gaps", not report["gaps"]["missing_topics"]),
    ]
    if "live" in report:
        live = report["live"]
        bars.append(
            (
                "live quotes reproduce the filing's premiums",
                bool(live.get("built"))
                and live.get("premiums_exact") == live.get("cases")
                and live.get("tiers_match") == live.get("cases"),
            )
        )
    failed = [name for name, ok in bars if not ok]
    return (not failed, failed)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("attempt", type=Path, help="the transcription attempt .xlsx")
    ap.add_argument("--golden", type=Path, default=GOLDEN_DEFAULT)
    ap.add_argument("--api", help="server base URL — also run build + quote parity")
    ap.add_argument("--json", type=Path, help="write the full JSON report here")
    args = ap.parse_args(argv)

    if not args.attempt.is_file():
        print(f"no such file: {args.attempt}", file=sys.stderr)
        return 2

    g_result, g_model = parse(args.golden)
    if not g_result.ok:
        print("GOLDEN workbook fails its own check — refusing to score", file=sys.stderr)
        return 2
    a_result, a_model = parse(args.attempt)

    align = Alignment(g_model, a_model)
    report: dict[str, Any] = {
        "attempt": str(args.attempt),
        "golden": str(args.golden),
        "spec_version": a_result.spec_version,
        "alignment": align.renames(),
        "check": score_check(a_result),
        "cells": score_cells(g_model, a_model, align),
        "examples": score_examples(g_model, a_model, align),
        "gaps": score_gaps(a_model, align),
    }
    if args.api:
        report["live"] = score_live(args.api, args.attempt, g_model, align)

    passed, failed = verdict(report)
    report["verdict"] = {"pass": passed, "failed_bars": failed}

    c, x, e, gp = report["check"], report["cells"], report["examples"], report["gaps"]
    print(f"── transcription eval · {args.attempt.name}")
    print(
        f"   check     {'PASS' if c['ok'] else 'FAIL'}"
        f" · {len(c['errors'])} errors · {c['warning_count']} warnings"
        f" · {c['notice_count']} notices"
    )
    print(
        f"   cells     {x['matched']}/{x['golden_cells']}"
        f" ({x['accuracy']:.1%}) · {len(x['wrong_value'])} wrong"
        f" · {len(x['missing'])} missing · {len(x['extra'])} extra"
    )
    print(
        f"   examples  {e['transcribed']}/{e['filing_cases']} transcribed"
        f" · totals {e['totals_match']}/{e['filing_cases']}"
        f" · tiers {e['tiers_match']}/{e['filing_cases']}"
    )
    print(
        f"   gaps      {len(gp['matched_topics'])}/{len(gp['expected_topics'])}"
        f" conventions recorded"
        + (f" · MISSING: {', '.join(gp['missing_topics'])}" if gp["missing_topics"] else "")
    )
    if "live" in report:
        lv = report["live"]
        if lv.get("built"):
            print(
                f"   live      built {lv['plan_id']}"
                f" · premiums exact {lv['premiums_exact']}/{lv['cases']}"
                f" · tiers {lv['tiers_match']}/{lv['cases']}"
                f" · max |Δ| {lv['max_abs_delta']}"
            )
        else:
            print(f"   live      build refused → {lv.get('refusal')}")
    print(f"   verdict   {'PASS' if passed else 'FAIL'}")
    for bar in failed:
        print(f"             ✗ {bar}")

    if args.json:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(json.dumps(report, indent=2, default=str) + "\n")
        print(f"   report    → {args.json}")
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
