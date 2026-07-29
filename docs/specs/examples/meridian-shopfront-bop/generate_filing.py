# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""The Meridian reference FILING — a realistic, fully synthetic rate
filing PDF for the fictional Meridian Mutual Insurance Company's
Shopfront BOP program (Brief 2 §8, P2).

ONE source of truth: every number renders from generate_workbook.py's
program constants (classes, factors, bands, territories, vectors, the
engine-mirrored price()). The PDF and the workbook can never drift.

Outputs (committed):
  · meridian_shopfront_bop_filing.pdf   — the ~25-page filing
  · meridian_filing_pages.json          — {section key → rule id + page},
    read by generate_workbook.py to stamp REAL citations into the
    workbook (citation_rule / citation_page point at actual pages).

Regenerate:  uv run --with reportlab python generate_filing.py
Deterministic: reportlab invariant mode (fixed metadata, no timestamps)
— the committed PDF is byte-stable across runs.

Every page footer states the carrier is fictional. Real Nebraska ZIP
codes are public geography; every factor, rate, and rule is invented.
"""

from __future__ import annotations

import json
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.pdfgen import canvas as pdfcanvas
from reportlab.platypus import (
    Flowable,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from generate_workbook import (
    BASE,
    BUILDING_BANDS,
    CLASSES,
    CONSTR_X_PROT,
    CONSTRUCTION,
    ENDORSEMENT_FACTOR,
    LCM,
    LIAB_MIN,
    LOADING,
    PROTECTION,
    SALES_BANDS,
    SPRINKLER,
    TERRITORIES,
    TOTAL_FLOOR,
    VECTORS,
    band_of,
    interp_of,
    price,
    r3,
    round_half_up,
    territory_of,
    tier_of,
)

HERE = Path(__file__).resolve().parent
PDF_OUT = HERE / "meridian_shopfront_bop_filing.pdf"
PAGES_OUT = HERE / "meridian_filing_pages.json"

FILING_NO = "MMI-NE-2026-BOP-001"
CARRIER = "Meridian Mutual Insurance Company"
PROGRAM = "Shopfront Businessowners (BOP) Program"
STATE = "Nebraska"
EFFECTIVE = "September 1, 2026"
FOOT = (
    "Meridian Mutual is a FICTIONAL carrier — synthetic OpenRater "
    "reference filing; every number is invented."
)

# section key → rule id (pages captured at render time)
RULES: dict[str, str] = {
    "program": "A.1",
    "eligibility": "A.2",
    "coverages": "A.3",
    "conventions": "A.4",
    "rating_order": "B.1",
    "rounding": "B.2",
    "modifiers": "B.3",
    "base_rates": "C.1",
    "construction": "C.2",
    "building_bands": "C.3",
    "sales_bands": "C.4",
    "sprinkler": "C.5",
    "territory_factors": "C.6",
    "territory_zips": "D.1",
    "classes": "E.1",
    "endorsement_equip": "F.1",
    "endorsement_venture": "F.2",
    "examples": "G.1",
}

PAGES: dict[str, int] = {}


class Mark(Flowable):
    """Records the page a section lands on (for the citation sidecar)."""

    def __init__(self, key: str) -> None:
        super().__init__()
        self.key = key
        self.width = 0
        self.height = 0

    def draw(self) -> None:
        PAGES[self.key] = self.canv.getPageNumber()


class FilingCanvas(pdfcanvas.Canvas):
    """Invariant (byte-stable) canvas with 'Page X of Y' + the
    fictional-carrier footer on every page."""

    def __init__(self, *args, **kwargs) -> None:
        kwargs["invariant"] = 1
        super().__init__(*args, **kwargs)
        self._page_states: list[dict] = []
        self.setTitle(f"{CARRIER} — {PROGRAM} — {STATE} Rates & Rules")
        self.setAuthor("OpenRater reference materials (synthetic)")
        self.setSubject(f"Filing {FILING_NO} (fictional)")
        self.setCreator("generate_filing.py")

    def showPage(self) -> None:  # noqa: N802 (reportlab API)
        self._page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self) -> None:
        total = len(self._page_states)
        for state in self._page_states:
            self.__dict__.update(state)
            self._draw_footer(total)
            super().showPage()
        super().save()

    def _draw_footer(self, total: int) -> None:
        self.saveState()
        self.setFont("Helvetica", 7)
        self.setFillColor(colors.grey)
        self.drawString(0.75 * inch, 0.5 * inch, FOOT)
        self.drawRightString(
            letter[0] - 0.75 * inch,
            0.5 * inch,
            f"Page {self.getPageNumber()} of {total}",
        )
        if self.getPageNumber() > 1:
            self.drawRightString(
                letter[0] - 0.75 * inch,
                letter[1] - 0.55 * inch,
                f"{CARRIER} · {FILING_NO} · Effective {EFFECTIVE}",
            )
        self.restoreState()


STYLES = getSampleStyleSheet()
H1 = ParagraphStyle("H1", parent=STYLES["Heading1"], spaceAfter=10)
H2 = ParagraphStyle("H2", parent=STYLES["Heading2"], spaceBefore=14, spaceAfter=6)
BODY = ParagraphStyle("Body", parent=STYLES["BodyText"], leading=13)
SMALL = ParagraphStyle("Small", parent=STYLES["BodyText"], fontSize=8, leading=10)

GRID = TableStyle(
    [
        ("FONT", (0, 0), (-1, -1), "Helvetica", 8),
        ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 8),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#999999")),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#eeeeee")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]
)


CELL = ParagraphStyle("Cell", parent=STYLES["BodyText"], fontSize=8, leading=10)
CELL_H = ParagraphStyle("CellH", parent=CELL, fontName="Helvetica-Bold")


def tbl(rows: list[list], widths: list[float] | None = None) -> Table:
    wrapped: list[list] = []
    for i, row in enumerate(rows):
        out_row = []
        for cell in row:
            text = str(cell)
            if len(text) > 34:
                out_row.append(Paragraph(text, CELL_H if i == 0 else CELL))
            else:
                out_row.append(text)
        wrapped.append(out_row)
    t = Table(wrapped, colWidths=widths, repeatRows=1)
    t.setStyle(GRID)
    return t


def money(x: float) -> str:
    return f"${x:,.0f}" if float(x).is_integer() else f"${x:,.2f}"


def rule_head(key: str, title: str) -> list:
    return [Mark(key), Paragraph(f"Rule {RULES[key]} — {title}", H2)]


def build_story(toc_pages: dict[str, int] | None) -> list:
    s: list = []

    # ── Cover ────────────────────────────────────────────────────────
    s.append(Spacer(1, 1.6 * inch))
    s.append(Paragraph(CARRIER, ParagraphStyle("cv1", parent=H1, fontSize=22, leading=26)))
    s.append(Paragraph(PROGRAM, ParagraphStyle("cv2", parent=H1, fontSize=17)))
    s.append(Spacer(1, 0.25 * inch))
    s.append(Paragraph(f"{STATE} — Rates and Rules Manual", STYLES["Heading3"]))
    s.append(Spacer(1, 0.4 * inch))
    cover = [
        ["Filing number", FILING_NO],
        ["Filing type", "Rates and rules — new program"],
        ["State", STATE],
        ["Line of business", "Businessowners (BOP)"],
        ["Proposed effective date", EFFECTIVE],
        ["Coverages", "Building · Business personal property · Liability"],
    ]
    s.append(tbl([["Item", "Value"]] + cover, [2.2 * inch, 4.0 * inch]))
    s.append(Spacer(1, 0.5 * inch))
    s.append(
        Paragraph(
            "SYNTHETIC REFERENCE DOCUMENT — this filing, its carrier, and every "
            "number in it are invented. It exists so that software (and the "
            "people reviewing it) can practice reading a realistically "
            "structured rate filing without touching any carrier's real "
            "intellectual property.",
            SMALL,
        )
    )
    s.append(PageBreak())

    # ── Table of contents ────────────────────────────────────────────
    s.append(Paragraph("Table of Contents", H1))
    toc_rows = [["Rule", "Section", "Page"]]
    toc_titles = {
        "program": "Program description",
        "eligibility": "Eligibility and referral",
        "coverages": "Coverage options and election",
        "conventions": "Application conventions (defaults)",
        "rating_order": "Premium determination (rating order)",
        "rounding": "Rounding, minimums, and the package floor",
        "modifiers": "Schedule rating (IRPM)",
        "base_rates": "Base rates and multipliers",
        "construction": "Construction × protection factors",
        "building_bands": "Building limit relativities (interpolated)",
        "sales_bands": "Annual gross sales relativities",
        "sprinkler": "Sprinkler factor",
        "territory_factors": "Territory factors",
        "territory_zips": "Territory definitions (ZIP assignments)",
        "classes": "Classification table",
        "endorsement_equip": "Equipment breakdown endorsement",
        "endorsement_venture": "New-venture surcharge endorsement",
        "examples": "Worked premium examples",
    }
    for key, title in toc_titles.items():
        page = str((toc_pages or {}).get(key, "—"))
        toc_rows.append([RULES[key], title, page])
    s.append(tbl(toc_rows, [0.7 * inch, 4.6 * inch, 0.7 * inch]))
    s.append(PageBreak())

    # ── Section A — General rules ────────────────────────────────────
    s.append(Paragraph("Section A — General Rules", H1))
    s.extend(rule_head("program", "Program description"))
    s.append(
        Paragraph(
            f"The {PROGRAM} provides property and liability coverage for "
            "small mainstreet risks (retail, office, service, and light "
            "artisan occupancies) at a single location in "
            f"{STATE}. Premium is determined per coverage from the rates and "
            "factors in Section C, subject to the rating order in Section B. "
            "The classifications eligible for the program are listed in "
            "Section E; territory assignments in Section D.",
            BODY,
        )
    )
    s.extend(rule_head("eligibility", "Eligibility and referral"))
    s.append(
        Paragraph(
            "Risks are accepted, referred, or declined as follows (first "
            "matching row governs):",
            BODY,
        )
    )
    s.append(
        tbl(
            [
                ["Order", "Condition", "Action"],
                ["1", "Annual gross sales over $5,000,000 AND less than 3 years in business", "Decline"],
                ["2", "Classification c111 (Woodworking — light) or c112 (Welding supply)", "Submit to company"],
                ["3", "Fully sprinklered AND public protection class 1–4", "Preferred acceptance"],
                ["4", "All other risks meeting this manual's terms", "Standard acceptance"],
            ],
            [0.55 * inch, 4.35 * inch, 1.3 * inch],
        )
    )
    s.extend(rule_head("coverages", "Coverage options and election"))
    s.append(
        Paragraph(
            "Building coverage and business personal property (BPP) coverage "
            "are each OPTIONAL; a policy must carry at least one of them. "
            "Liability coverage is mandatory and is rated from annual gross "
            "sales. A coverage that is not elected develops no premium and "
            "its rating steps are skipped entirely — an elected coverage "
            "with a zero limit is not permitted.",
            BODY,
        )
    )
    s.extend(rule_head("conventions", "Application conventions (defaults)"))
    s.append(
        Paragraph(
            "Where the application leaves the sprinkler question unanswered, "
            "the risk is rated as NOT sprinklered (and the equipment "
            "breakdown endorsement of Rule F.1 attaches). Where years in "
            "business is not stated, the risk is rated as 5 years in "
            "business.",
            BODY,
        )
    )
    s.append(Paragraph("Rule A.5 — Policy term and administration", H2))
    s.append(
        Paragraph(
            "Policies are written for a 12-month term. All premiums are "
            "whole-dollar. Midterm changes, cancellation, and reinstatement "
            "follow the company's standard commercial-lines procedures and "
            "do not alter the rating algorithm of this manual.",
            BODY,
        )
    )
    s.append(PageBreak())

    # ── Section B — Premium determination ────────────────────────────
    s.append(Paragraph("Section B — Premium Determination", H1))
    s.extend(rule_head("rating_order", "Rating order"))
    s.append(
        Paragraph(
            "Each elected coverage develops premium independently, then the "
            "policy-level steps apply. All factors are taken from Section C.",
            BODY,
        )
    )
    order_rows = [
        ["Step", "Building / BPP coverages", "Liability coverage"],
        ["1", "Rate per $100: base rate × class (property) × construction/protection × building-limit relativity (Building only) × sprinkler × territory (property). Round the RATE to 3 decimals.",
         "Rate per $1,000: base rate × class (liability) × gross-sales relativity × territory (liability). Round the RATE to 3 decimals."],
        ["2", "Multiply by exposure: limit ÷ 100.", "Multiply by exposure: annual gross sales ÷ 1,000."],
        ["3", f"Multiply by the loss cost multiplier ({LCM:.2f}) and round to whole dollars.", f"Multiply by the loss cost multiplier ({LCM:.2f}) and round to whole dollars."],
        ["4", "Endorsements (Section F) multiply each coverage premium.", "Same."],
        ["5", f"Apply the expense loading ({LOADING:.2f}).", "Same."],
        ["6", "—", f"Liability minimum premium: {money(LIAB_MIN)} (Rule B.2)."],
        ["7", "Sum the coverage premiums; apply the package floor and final rounding (Rule B.2).", ""],
    ]
    s.append(tbl(order_rows, [0.5 * inch, 3.0 * inch, 3.0 * inch]))
    s.extend(rule_head("rounding", "Rounding, minimums, and the package floor"))
    s.append(
        Paragraph(
            "Rates round HALF-UP to 3 decimals before the exposure multiplies "
            "them; each coverage premium rounds half-up to whole dollars at "
            f"step 3. The liability premium is subject to a {money(LIAB_MIN)} "
            f"minimum after the loading. The total policy premium is subject "
            f"to a {money(TOTAL_FLOOR)} package minimum and rounds half-up "
            "to whole dollars.",
            BODY,
        )
    )
    s.extend(rule_head("modifiers", "Schedule rating (IRPM)"))
    s.append(
        Paragraph(
            "The company may modify the policy premium to recognize risk "
            "characteristics not otherwise reflected in this manual, per the "
            "schedule below. The total schedule credit or debit may not "
            "exceed 25% of the policy premium. No schedule credit or debit "
            "is reflected in the Section G examples.",
            BODY,
        )
    )
    s.append(
        tbl(
            [
                ["Category", "Range"],
                ["Management experience", "±10%"],
                ["Premises condition", "±15%"],
            ],
            [2.6 * inch, 1.2 * inch],
        )
    )
    s.append(PageBreak())

    # ── Section C — Rates and factors ────────────────────────────────
    s.append(Paragraph("Section C — Rates and Factors", H1))
    s.extend(rule_head("base_rates", "Base rates and multipliers"))
    s.append(
        tbl(
            [
                ["Item", "Value", "Applies"],
                ["Building base rate (per $100 of limit)", f"{BASE['building']:.2f}", "Building"],
                ["BPP base rate (per $100 of limit)", f"{BASE['bpp']:.2f}", "BPP"],
                ["Liability base rate (per $1,000 of sales)", f"{BASE['liability']:.2f}", "Liability"],
                ["Loss cost multiplier (LCM)", f"{LCM:.2f}", "All coverages"],
                ["Expense loading", f"{LOADING:.2f}", "All coverages"],
            ],
            [3.2 * inch, 1.1 * inch, 1.5 * inch],
        )
    )
    s.extend(rule_head("construction", "Construction × protection factors"))
    cxp_rows = [["Construction \\ Protection"] + [p[1] for p in PROTECTION]]
    for c_id, c_label in CONSTRUCTION:
        cxp_rows.append([c_label] + [f"{CONSTR_X_PROT[(c_id, p_id)]:.2f}" for p_id, _ in PROTECTION])
    s.append(tbl(cxp_rows, [2.0 * inch] + [1.35 * inch] * len(PROTECTION)))
    s.append(Paragraph("Applies to Building and BPP.", SMALL))

    s.extend(rule_head("building_bands", "Building limit relativities"))
    bb_rows = [["Building limit (from)", "Relativity"]]
    for _id, _label, lo, _hi, ilf in BUILDING_BANDS:
        bb_rows.append([money(lo), f"{ilf:.2f}"])
    s.append(tbl(bb_rows, [2.2 * inch, 1.2 * inch]))
    s.append(
        Paragraph(
            "The relativity for a limit between two shown limits is "
            "determined by LINEAR INTERPOLATION between the factors shown; "
            "below the first shown limit or above the last, the endpoint "
            "factor applies. Applies to Building coverage only.",
            SMALL,
        )
    )

    s.extend(rule_head("sales_bands", "Annual gross sales relativities"))
    sb_rows = [["Annual gross sales", "Relativity"]]
    for _id, label, _lo, _hi, f in SALES_BANDS:
        sb_rows.append([label, f"{f:.2f}"])
    s.append(tbl(sb_rows, [2.2 * inch, 1.2 * inch]))
    s.append(
        Paragraph(
            "The factor of the band containing the risk's annual gross sales "
            "applies as shown; these factors are NOT interpolated. Applies "
            "to Liability coverage only.",
            SMALL,
        )
    )
    s.append(PageBreak())

    s.extend(rule_head("sprinkler", "Sprinkler factor"))
    spr_rows = [["Sprinkler status", "Factor"]]
    for _id, label, f in SPRINKLER:
        spr_rows.append([label, f"{f:.2f}"])
    s.append(tbl(spr_rows, [2.2 * inch, 1.2 * inch]))
    s.append(Paragraph("Applies to Building and BPP. See also Rule F.1.", SMALL))

    s.extend(rule_head("territory_factors", "Territory factors"))
    tf_rows = [["Territory", "Property factor", "Liability factor"]]
    for code in sorted(TERRITORIES):
        _zips, prop_f, liab_f = TERRITORIES[code]
        tf_rows.append([code.upper(), f"{prop_f:.2f}", f"{liab_f:.2f}"])
    s.append(tbl(tf_rows, [1.4 * inch, 1.4 * inch, 1.4 * inch]))

    # ── Section D — Territory definitions ────────────────────────────
    s.append(Paragraph("Section D — Territory Definitions", H1))
    s.extend(rule_head("territory_zips", "ZIP code assignments"))
    tz_rows = [["Territory", "ZIP codes"]]
    for code in sorted(TERRITORIES):
        zips, _p, _l = TERRITORIES[code]
        tz_rows.append([code.upper(), ", ".join(zips)])
    s.append(tbl(tz_rows, [1.0 * inch, 5.2 * inch]))
    s.append(
        Paragraph(
            "A risk at a ZIP code not listed is outside the program's "
            "eligible territory.",
            SMALL,
        )
    )
    s.append(PageBreak())

    # ── Section E — Classifications ──────────────────────────────────
    s.append(Paragraph("Section E — Classification Table", H1))
    s.extend(rule_head("classes", "Eligible classifications"))
    cl_rows = [["Code", "Classification", "Property factor", "Liability factor"]]
    for code, label, pf, lf in CLASSES:
        cl_rows.append([code, label, f"{pf:.2f}", f"{lf:.2f}"])
    s.append(tbl(cl_rows, [0.8 * inch, 3.4 * inch, 1.1 * inch, 1.1 * inch]))
    s.append(PageBreak())

    # ── Section F — Endorsements ─────────────────────────────────────
    s.append(Paragraph("Section F — Endorsements", H1))
    s.extend(rule_head("endorsement_equip", "Equipment breakdown endorsement (MS 10 01)"))
    s.append(
        Paragraph(
            "Attaches automatically to every risk that is NOT fully "
            f"sprinklered. Each coverage premium is multiplied by "
            f"{ENDORSEMENT_FACTOR:.2f} at rating-order step 4.",
            BODY,
        )
    )
    s.extend(rule_head("endorsement_venture", "New-venture surcharge endorsement (MS 20 07)"))
    s.append(
        Paragraph(
            "Attaches automatically to risks with less than 1 year in "
            "business: each coverage premium is multiplied by 1.15 at "
            "rating-order step 4. (No worked example in Section G "
            "exercises this endorsement; none of the example risks is a "
            "new venture.)",
            BODY,
        )
    )
    s.append(PageBreak())

    # ── Section G — Worked examples ──────────────────────────────────
    s.append(Paragraph("Section G — Worked Premium Examples", H1))
    s.extend(rule_head("examples", "Worked examples"))
    s.append(
        Paragraph(
            "The following examples apply this manual end-to-end. They are "
            "the acceptance test of any implementation of this program: a "
            "system that reproduces every total below, to the dollar, "
            "implements the manual correctly.",
            BODY,
        )
    )
    for v in VECTORS:
        p = price(v)
        tier = tier_of(v)
        _t_code, terr_prop, terr_liab = territory_of(v["zip"])
        class_prop = next(c[2] for c in CLASSES if c[0] == v["class_code"])
        class_liab = next(c[3] for c in CLASSES if c[0] == v["class_code"])
        cxp = CONSTR_X_PROT[(v["construction_class"], v["protection_class"])]
        bl_ilf = interp_of(v["building_limit"], BUILDING_BANDS)
        _sb, sb_ilf = band_of(v["annual_gross_sales"], SALES_BANDS)
        spr = 0.92 if v["sprinklered"] else 1.00

        if v["case_id"] != "mv_01":
            s.append(PageBreak())
        s.append(Paragraph(f"Example {v['case_id']} — {v['name']}", H2))
        risk_rows = [
            ["Class", f"{v['class_code']}"], ["Building limit", money(v["building_limit"])],
            ["BPP limit", money(v["bpp_limit"])], ["Annual gross sales", money(v["annual_gross_sales"])],
            ["Construction / protection", f"{v['construction_class']} / {v['protection_class']}"],
            ["ZIP (territory)", f"{v['zip']} ({_t_code.upper()})"],
            ["Sprinklered / years in business", f"{v['sprinklered']} / {v['years_in_business']}"],
            ["Underwriting action (Rule A.2)", tier.capitalize()],
        ]
        s.append(tbl([["Risk", ""]] + risk_rows, [2.6 * inch, 3.4 * inch]))

        b_rate = r3(BASE["building"] * class_prop * cxp * bl_ilf * spr * terr_prop)
        bpp_rate = r3(BASE["bpp"] * class_prop * cxp * spr * terr_prop)
        l_rate = r3(BASE["liability"] * class_liab * sb_ilf * terr_liab)
        calc_rows = [["Step", "Computation", "Result"]]
        calc_rows.append([
            "Building rate",
            f"{BASE['building']:.2f} × {class_prop:.2f} × {cxp:.2f} × {bl_ilf:.4f} × {spr:.2f} × {terr_prop:.2f} (round 3dp)",
            f"{b_rate:.3f}",
        ])
        calc_rows.append([
            "Building premium",
            f"{b_rate:.3f} × ({money(v['building_limit'])} ÷ 100) × {LCM:.2f} (round)",
            money(round_half_up(b_rate * (v["building_limit"] / 100.0) * LCM)),
        ])
        calc_rows.append([
            "BPP rate",
            f"{BASE['bpp']:.2f} × {class_prop:.2f} × {cxp:.2f} × {spr:.2f} × {terr_prop:.2f} (round 3dp)",
            f"{bpp_rate:.3f}",
        ])
        calc_rows.append([
            "BPP premium",
            f"{bpp_rate:.3f} × ({money(v['bpp_limit'])} ÷ 100) × {LCM:.2f} (round)",
            money(round_half_up(bpp_rate * (v["bpp_limit"] / 100.0) * LCM)),
        ])
        calc_rows.append([
            "Liability rate",
            f"{BASE['liability']:.2f} × {class_liab:.2f} × {sb_ilf:.2f} × {terr_liab:.2f} (round 3dp)",
            f"{l_rate:.3f}",
        ])
        calc_rows.append([
            "Liability premium",
            f"{l_rate:.3f} × ({money(v['annual_gross_sales'])} ÷ 1,000) × {LCM:.2f} (round)",
            money(round_half_up(l_rate * (v["annual_gross_sales"] / 1000.0) * LCM)),
        ])
        notes = []
        if p["fired"]["endorsement"]:
            notes.append(f"MMI-EB-01 ×{ENDORSEMENT_FACTOR:.2f} (Rule F.1)")
        notes.append(f"loading ×{LOADING:.2f} (Rule B.1 step 5)")
        if p["fired"]["clamp"]:
            notes.append(f"liability minimum {money(LIAB_MIN)} (Rule B.2)")
        if p["fired"]["floor"]:
            notes.append(f"package floor {money(TOTAL_FLOOR)} (Rule B.2)")
        calc_rows.append(["Policy-level steps", " · ".join(notes), ""])
        for cov in ("building", "bpp", "liability"):
            calc_rows.append([f"Final {cov} premium", "", money(round(p["towers"][cov], 2))])
        calc_rows.append(["TOTAL POLICY PREMIUM", "", money(p["total"])])
        s.append(tbl(calc_rows, [1.5 * inch, 3.6 * inch, 1.1 * inch]))
        s.append(Spacer(1, 0.18 * inch))

    return s


def render(path: Path, toc_pages: dict[str, int] | None) -> None:
    doc = SimpleDocTemplate(
        str(path),
        pagesize=letter,
        leftMargin=0.75 * inch,
        rightMargin=0.75 * inch,
        topMargin=0.75 * inch,
        bottomMargin=0.85 * inch,
    )
    doc.build(build_story(toc_pages), canvasmaker=FilingCanvas)


def main() -> None:
    # Two-pass: pass 1 captures section pages; pass 2 renders the real TOC.
    PAGES.clear()
    render(PDF_OUT, None)
    first_pass = dict(PAGES)
    PAGES.clear()
    render(PDF_OUT, first_pass)
    assert PAGES == first_pass, "TOC page numbers shifted layout — widen the TOC column"

    sidecar = {
        "filing": FILING_NO,
        "document": PDF_OUT.name,
        "sections": {
            key: {"rule": RULES[key], "page": PAGES[key]} for key in RULES
        },
    }
    PAGES_OUT.write_text(json.dumps(sidecar, indent=2) + "\n")
    print(f"wrote {PDF_OUT.name} ({max(PAGES.values())} pages) + {PAGES_OUT.name}")


if __name__ == "__main__":
    main()
