# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""The committed Meridian demo book — docs/fixtures/meridian-demo-book.csv.

Twenty deterministic risks against the Meridian Shopfront BOP program:
the filing's own 8 worked examples (mv_01–mv_08) plus 12 book-texture
rows sweeping the widened program (classes beyond the examples, all six
territories, every construction × protection corner). Expected values
ride IN the book (`expected_tier`, `expected_total`), computed by the
same engine-mirrored `price()` / `tier_of()` that self-verify the
workbook — so the CSV, the workbook's test_cases sheet, and the filing's
worked examples can never disagree.

Consumed by:
  · the seeded-fixture oracle gate
    (frontend/src/integrations/meridianSeedFixture.verify.test.ts)
  · the book re-rate demo (MCP `rerate_book` / the Run zone)

Regenerate (from this directory):
    uv run --with openpyxl python generate_demo_book.py
(openpyxl only because importing generate_workbook pulls it in.)
"""

from __future__ import annotations

import csv
from pathlib import Path

from generate_workbook import VECTORS, price, tier_of

HERE = Path(__file__).resolve().parent
OUT = HERE.parents[2] / "fixtures" / "meridian-demo-book.csv"

INPUTS = [
    "class_code",
    "building_limit",
    "bpp_limit",
    "annual_gross_sales",
    "construction_class",
    "protection_class",
    "zip",
    "sprinklered",
    "years_in_business",
]

# Book-texture rows: deterministic sweeps the 8 examples don't cover —
# the widened class list (c113+), territories t4–t6, and construction ×
# protection corners. Values are invented; expecteds are computed.
EXTRA = [
    dict(case_id="bk_09", name="Neighborhood grocery t4, frame, sprinklered",
         class_code="c113", building_limit=320_000, bpp_limit=95_000,
         annual_gross_sales=700_000, construction_class="frame",
         protection_class="p5_8", zip="68005", sprinklered=True,
         years_in_business=11),
    dict(case_id="bk_10", name="Coffee shop t5, masonry",
         class_code="c115", building_limit=150_000, bpp_limit=120_000,
         annual_gross_sales=380_000, construction_class="masonry",
         protection_class="p1_4", zip="68801", sprinklered=False,
         years_in_business=7),
    dict(case_id="bk_11", name="Bookstore t6, joisted masonry",
         class_code="c117", building_limit=210_000, bpp_limit=60_000,
         annual_gross_sales=520_000, construction_class="jm",
         protection_class="p5_8", zip="68025", sprinklered=True,
         years_in_business=4),
    dict(case_id="bk_12", name="Jewelry store t1, fire-resistive",
         class_code="c119", building_limit=275_000, bpp_limit=70_000,
         annual_gross_sales=430_000, construction_class="fr",
         protection_class="p1_4", zip="68001", sprinklered=True,
         years_in_business=16),
    dict(case_id="bk_13", name="Sporting goods t2, mid-band interpolated limit",
         class_code="c121", building_limit=333_000, bpp_limit=45_000,
         annual_gross_sales=290_000, construction_class="jm",
         protection_class="p9_10", zip="68104", sprinklered=False,
         years_in_business=9),
    dict(case_id="bk_14", name="Pet shop t3, tiny sales (clamp candidate)",
         class_code="c123", building_limit=95_000, bpp_limit=25_000,
         annual_gross_sales=45_000, construction_class="frame",
         protection_class="p5_8", zip="68502", sprinklered=True,
         years_in_business=3),
    dict(case_id="bk_15", name="Tailor t4, unsprinklered (endorsement)",
         class_code="c126", building_limit=480_000, bpp_limit=160_000,
         annual_gross_sales=1_500_000, construction_class="masonry",
         protection_class="p9_10", zip="68123", sprinklered=False,
         years_in_business=22),
    dict(case_id="bk_16", name="Picture framer t5, micro package (floor candidate)",
         class_code="c129", building_limit=35_000, bpp_limit=8_000,
         annual_gross_sales=20_000, construction_class="jm",
         protection_class="p1_4", zip="68901", sprinklered=True,
         years_in_business=5),
    dict(case_id="bk_17", name="Woodworking t6 (submit tier)",
         class_code="c111", building_limit=300_000, bpp_limit=100_000,
         annual_gross_sales=800_000, construction_class="frame",
         protection_class="p5_8", zip="68601", sprinklered=True,
         years_in_business=13),
    dict(case_id="bk_18", name="Big young art gallery (decline tier)",
         class_code="c131", building_limit=1_100_000, bpp_limit=350_000,
         annual_gross_sales=5_600_000, construction_class="fr",
         protection_class="p1_4", zip="68102", sprinklered=True,
         years_in_business=1),
    dict(case_id="bk_19", name="Insurance agency t1, band lower edge exactly",
         class_code="c134", building_limit=500_000, bpp_limit=130_000,
         annual_gross_sales=1_000_000, construction_class="masonry",
         protection_class="p5_8", zip="68003", sprinklered=True,
         years_in_business=18),
    dict(case_id="bk_20", name="Veterinary office t2, top band",
         class_code="c138", building_limit=2_100_000, bpp_limit=600_000,
         annual_gross_sales=3_800_000, construction_class="fr",
         protection_class="p9_10", zip="68105", sprinklered=False,
         years_in_business=27),
]


def emit() -> None:
    rows = [*VECTORS, *EXTRA]
    seen = set()
    for v in rows:
        assert v["case_id"] not in seen, f"duplicate case_id {v['case_id']}"
        seen.add(v["case_id"])
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["case_id", "name", *INPUTS, "expected_tier", "expected_total"])
        fired = {"endorsement": False, "clamp": False, "floor": False}
        tiers: set[str] = set()
        for v in rows:
            p = price(v)
            tier = tier_of(v)
            tiers.add(tier)
            for k in fired:
                fired[k] = fired[k] or p["fired"][k]
            w.writerow([
                v["case_id"], v["name"],
                *[str(v[k]).lower() if isinstance(v[k], bool) else v[k]
                  for k in INPUTS],
                tier, int(p["total"]),
            ])
        assert all(fired.values()), f"book misses a behavior: {fired}"
        assert tiers == {"preferred", "standard", "submit", "decline"}, tiers
    print(f"wrote {len(rows)} rows -> {OUT}")


if __name__ == "__main__":
    emit()
