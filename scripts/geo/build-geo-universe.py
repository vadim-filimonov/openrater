#!/usr/bin/env python3
"""Build the server's geographic universe asset (all states at once).

    python3 scripts/geo/build-geo-universe.py [--cache DIR]

Downloads the US Census Bureau's 2024 Gazetteer files (public domain,
~1 MB each, cached after the first run) and emits
server/src/openrater/rates/ingest/assets/geo-universe.json:

    { "zcta":   { "NE": "68001 68002 …", … },     # via the SCF ranges
      "county": { "NE": "31001 31003 …", … } }     # via the USPS column

The workbook lint (R-083…R-085) checks a geographic dimension's
`geo.<slug>` sheet against this universe: in-scope keys that were
never mapped (transcription holes), keys outside the declared scope
(typos or a wrong scope), and keys unknown to the Census universe
(PO-box ZIPs have no ZCTA; typos look like this too).

ZCTAs assign to states through the SAME USPS SCF prefix ranges the
platform's `zip5_to_state` transformer uses, parsed from
geoTransformers.ts — never duplicated. Counties carry their state
directly in the gazetteer. No external Python dependencies.
"""

from __future__ import annotations

import json
import re
import sys
import urllib.request
import zipfile
from pathlib import Path

ZCTA_URL = "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/2024_Gaz_zcta_national.zip"
COUNTY_URL = "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/2024_Gaz_counties_national.zip"

REPO = Path(__file__).resolve().parents[2]
OUT = REPO / "server" / "src" / "openrater" / "rates" / "ingest" / "assets" / "geo-universe.json"
RANGES_SRC = (
    REPO / "packages" / "ui" / "src" / "GeoTransformerPicker" / "geoTransformers.ts"
)


def zip_ranges() -> list[tuple[int, int, str]]:
    text = RANGES_SRC.read_text()
    out = [
        (int(lo), int(hi), usps)
        for lo, hi, usps in re.findall(r'\[(\d+),\s*(\d+),\s*"([A-Z]{2})"\]', text)
    ]
    if not out:
        raise SystemExit(f"no ZIP_RANGES parsed from {RANGES_SRC}")
    return out


def fetch(url: str, cache_dir: Path) -> str:
    cache_dir.mkdir(parents=True, exist_ok=True)
    path = cache_dir / url.rsplit("/", 1)[1]
    if not path.exists():
        print(f"downloading {url} …")
        urllib.request.urlretrieve(url, path)
    with zipfile.ZipFile(path) as z:
        txt = next(n for n in z.namelist() if n.endswith(".txt"))
        return z.read(txt).decode("utf-8-sig")


def column(header: list[str], name: str) -> int:
    idx = [i for i, h in enumerate(header) if h.strip() == name]
    if not idx:
        raise SystemExit(f"column {name!r} not in gazetteer header: {header}")
    return idx[0]


def main() -> None:
    cache = Path("/tmp")
    argv = sys.argv[1:]
    if "--cache" in argv:
        cache = Path(argv[argv.index("--cache") + 1])
    ranges = zip_ranges()

    zcta_by_state: dict[str, list[str]] = {}
    lines = fetch(ZCTA_URL, cache).splitlines()
    geoid = column(lines[0].split("\t"), "GEOID")
    skipped = 0
    for line in lines[1:]:
        if line.strip() == "":
            continue
        zcta = line.split("\t")[geoid].strip()
        if not re.fullmatch(r"\d{5}", zcta):
            continue
        z5 = int(zcta)
        state = next((usps for lo, hi, usps in ranges if lo <= z5 <= hi), None)
        if state is None:
            skipped += 1  # territories outside the SCF table (AS/GU/MP…)
            continue
        zcta_by_state.setdefault(state, []).append(zcta)

    county_by_state: dict[str, list[str]] = {}
    lines = fetch(COUNTY_URL, cache).splitlines()
    header = lines[0].split("\t")
    c_geoid = column(header, "GEOID")
    c_usps = column(header, "USPS")
    for line in lines[1:]:
        if line.strip() == "":
            continue
        cols = line.split("\t")
        fips = cols[c_geoid].strip()
        state = cols[c_usps].strip()
        if re.fullmatch(r"\d{5}", fips) and state:
            county_by_state.setdefault(state, []).append(fips)

    payload = {
        "format": "geo-universe-v1",
        "source": (
            "US Census Bureau, 2024 Gazetteer Files — ZCTAs (state via "
            "USPS SCF ranges) and counties (public domain)."
        ),
        "urls": [ZCTA_URL, COUNTY_URL],
        "zcta_count": sum(len(v) for v in zcta_by_state.values()),
        "county_count": sum(len(v) for v in county_by_state.values()),
        "zcta": {s: " ".join(sorted(v)) for s, v in sorted(zcta_by_state.items())},
        "county": {s: " ".join(sorted(v)) for s, v in sorted(county_by_state.items())},
    }
    OUT.write_text(json.dumps(payload, separators=(",", ":")))
    print(
        f"wrote {OUT}: {payload['zcta_count']} ZCTAs across "
        f"{len(zcta_by_state)} states ({skipped} outside the SCF table), "
        f"{payload['county_count']} counties, {OUT.stat().st_size:,} bytes"
    )


if __name__ == "__main__":
    main()
