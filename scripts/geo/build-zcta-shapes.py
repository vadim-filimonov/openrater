#!/usr/bin/env python3
"""Build per-state ZCTA boundary chunks for the Exhibits territory map.

    python3 scripts/geo/build-zcta-shapes.py [STATE ...] [--cache DIR]

Downloads the US Census Bureau's 2020 Cartographic Boundary ZCTA
shapefile (1:500,000 — public domain, ~66MB, cached after the first
run), assigns each ZCTA to a state via the same USPS SCF prefix
ranges the platform's `zip5_to_state` transformer uses (parsed from
geoTransformers.ts, never duplicated), simplifies + quantizes the
rings, and emits one JSON chunk per requested state into
frontend/public/geo/zcta-shapes/{STATE}.json.

Chunk format (zcta-shapes-v1): shapes[zip] is a list of polygons;
each polygon is a list of rings (outer first, holes after); each
ring is a flat [lng, lat, lng, lat, …] list rounded to 3 decimals
(~110 m — plenty at state zoom for 1:500k source geometry). Rings
are wound for d3-geo's SPHERICAL convention (exterior clockwise —
the opposite of RFC 7946, and the shapefile's own convention) so
d3 renders areas, not their complements.

Only states a fixture needs are committed (Nebraska today); run this
script to add more. No external Python dependencies.
"""

from __future__ import annotations

import json
import re
import struct
import sys
import urllib.request
import zipfile
from pathlib import Path

CB_URL = "https://www2.census.gov/geo/tiger/GENZ2020/shp/cb_2020_us_zcta520_500k.zip"
REPO = Path(__file__).resolve().parents[2]
OUT_DIR = REPO / "frontend" / "public" / "geo" / "zcta-shapes"
RANGES_SRC = (
    REPO / "packages" / "ui" / "src" / "GeoTransformerPicker" / "geoTransformers.ts"
)
SIMPLIFY_EPS = 0.002  # degrees (~200 m) — on top of the 1:500k generalization
QUANTUM = 3  # decimals


def zip_ranges() -> list[tuple[int, int, str]]:
    """The USPS L005 SCF ranges, parsed from the platform's own table."""
    text = RANGES_SRC.read_text()
    out = [
        (int(lo), int(hi), usps)
        for lo, hi, usps in re.findall(
            r'\[(\d+),\s*(\d+),\s*"([A-Z]{2})"\]', text
        )
    ]
    if not out:
        raise SystemExit(f"no ZIP_RANGES parsed from {RANGES_SRC}")
    return out


def fetch_cb(cache_dir: Path) -> Path:
    cache_dir.mkdir(parents=True, exist_ok=True)
    path = cache_dir / CB_URL.rsplit("/", 1)[1]
    if not path.exists():
        print(f"downloading {CB_URL} …")
        urllib.request.urlretrieve(CB_URL, path)
    return path


# ── Shapefile reading (type 5 = Polygon), stdlib only ────────────────


def read_dbf_zips(raw: bytes) -> list[str]:
    """The ZCTA5CE20 column, in record order."""
    n_records = struct.unpack_from("<I", raw, 4)[0]
    header_size, record_size = struct.unpack_from("<HH", raw, 8)
    fields = []
    off = 32
    while raw[off] != 0x0D:
        name = raw[off : off + 11].split(b"\x00")[0].decode("ascii")
        length = raw[off + 16]
        fields.append((name, length))
        off += 32
    col = None
    col_off = 1  # records start with a deletion flag byte
    for name, length in fields:
        if name == "ZCTA5CE20":
            col = (col_off, length)
        col_off += length
    if col is None:
        raise SystemExit(f"ZCTA5CE20 not in dbf fields: {[f for f, _ in fields]}")
    zips = []
    for i in range(n_records):
        base = header_size + i * record_size
        zips.append(raw[base + col[0] : base + col[0] + col[1]].decode("ascii").strip())
    return zips


def read_shp_polygons(raw: bytes) -> list[list[list[tuple[float, float]]]]:
    """Per record: a list of rings, each a list of (lng, lat)."""
    out = []
    off = 100
    total = struct.unpack_from(">I", raw, 24)[0] * 2
    while off < total:
        content_words = struct.unpack_from(">I", raw, off + 4)[0]
        shape_type = struct.unpack_from("<i", raw, off + 8)[0]
        rings: list[list[tuple[float, float]]] = []
        if shape_type == 5:
            n_parts, n_points = struct.unpack_from("<ii", raw, off + 44)
            parts = list(struct.unpack_from(f"<{n_parts}i", raw, off + 52))
            pts_off = off + 52 + 4 * n_parts
            flat = struct.unpack_from(f"<{2 * n_points}d", raw, pts_off)
            bounds = parts + [n_points]
            for p in range(n_parts):
                ring = [
                    (flat[2 * i], flat[2 * i + 1])
                    for i in range(bounds[p], bounds[p + 1])
                ]
                rings.append(ring)
        out.append(rings)
        off += 8 + content_words * 2
    return out


# ── Geometry: simplify, wind, group holes ────────────────────────────


def simplify(ring: list[tuple[float, float]], eps: float) -> list[tuple[float, float]]:
    """Iterative Douglas–Peucker (perpendicular distance in degrees).

    Rings arrive CLOSED (first == last) — DP on a closed ring has a
    degenerate zero-length baseline that collapses everything, so the
    ring is opened and split at its farthest-from-start vertex; the
    caller re-closes.
    """
    pts = ring[:-1] if len(ring) > 1 and ring[0] == ring[-1] else list(ring)
    n = len(pts)
    if n <= 4:
        return pts
    x0, y0 = pts[0]
    far = max(
        range(1, n), key=lambda i: (pts[i][0] - x0) ** 2 + (pts[i][1] - y0) ** 2
    )
    ring = pts
    keep = [False] * n
    keep[0] = keep[far] = keep[n - 1] = True
    stack = [(0, far), (far, n - 1)]
    while stack:
        lo, hi = stack.pop()
        if hi <= lo + 1:
            continue
        ax, ay = ring[lo]
        bx, by = ring[hi]
        dx, dy = bx - ax, by - ay
        norm = (dx * dx + dy * dy) ** 0.5 or 1e-12
        worst, worst_i = -1.0, -1
        for i in range(lo + 1, hi):
            px, py = ring[i]
            d = abs(dx * (ay - py) - dy * (ax - px)) / norm
            if d > worst:
                worst, worst_i = d, i
        if worst > eps:
            keep[worst_i] = True
            stack.append((lo, worst_i))
            stack.append((worst_i, hi))
    return [pt for pt, k in zip(ring, keep) if k]


def signed_area(ring: list[tuple[float, float]]) -> float:
    s = 0.0
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
        s += x1 * y2 - x2 * y1
    return s / 2


def contains(ring: list[tuple[float, float]], pt: tuple[float, float]) -> bool:
    x, y = pt
    inside = False
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
        if (y1 > y) != (y2 > y) and x < x1 + (y - y1) / (y2 - y1) * (x2 - x1):
            inside = not inside
    return inside


def pack(rings: list[list[tuple[float, float]]]) -> list[list[list[float]]]:
    """Simplify + quantize, group holes under their outers, and emit
    GeoJSON winding (outer CCW) as packed flat rings."""
    cleaned: list[tuple[bool, list[tuple[float, float]]]] = []
    for ring in rings:
        outer = signed_area(ring) < 0  # shapefile: outer rings are CW
        slim = simplify(ring, SIMPLIFY_EPS)
        slim = [(round(x, QUANTUM), round(y, QUANTUM)) for x, y in slim]
        dedup = [p for i, p in enumerate(slim) if i == 0 or p != slim[i - 1]]
        if len(dedup) > 1 and dedup[0] == dedup[-1]:
            dedup = dedup[:-1]
        if len(dedup) < 3:
            continue
        dedup.append(dedup[0])  # close
        cleaned.append((outer, dedup))
    polygons: list[list[list[tuple[float, float]]]] = []
    for outer, ring in cleaned:
        if outer:
            polygons.append([ring])
    if not polygons:  # degenerate — treat every ring as an outer
        polygons = [[ring] for _, ring in cleaned]
    else:
        outers = [p[0] for p in polygons]
        for outer, ring in cleaned:
            if outer:
                continue
            host = 0
            if len(outers) > 1:
                for i, o in enumerate(outers):
                    if contains(o, ring[0]):
                        host = i
                        break
            polygons[host].append(ring)
    packed = []
    for rings_of_poly in polygons:
        poly = []
        for i, ring in enumerate(rings_of_poly):
            ccw = signed_area(ring) > 0
            # d3-geo's spherical winding is the OPPOSITE of RFC 7946:
            # exteriors clockwise, holes counter-clockwise — which is
            # the shapefile convention. Wound the RFC way, d3 renders
            # the polygon's complement (the whole frame fills).
            want_ccw = i != 0
            pts = ring if ccw == want_ccw else ring[::-1]
            poly.append([coord for pt in pts for coord in pt])
        packed.append(poly)
    return packed


def main() -> None:
    argv = sys.argv[1:]
    cache = Path("/tmp")
    positional: list[str] = []
    i = 0
    while i < len(argv):
        if argv[i] == "--cache" and i + 1 < len(argv):
            cache = Path(argv[i + 1])
            i += 2
        else:
            positional.append(argv[i])
            i += 1
    states = [a.upper() for a in positional] or ["NE"]
    ranges = zip_ranges()
    wanted = {
        s: [(lo, hi) for lo, hi, usps in ranges if usps == s] for s in states
    }
    for s, r in wanted.items():
        if not r:
            raise SystemExit(f"no SCF range for state {s}")

    cb = fetch_cb(cache)
    with zipfile.ZipFile(cb) as z:
        shp_name = next(n for n in z.namelist() if n.endswith(".shp"))
        dbf_name = next(n for n in z.namelist() if n.endswith(".dbf"))
        print(f"parsing {shp_name} …")
        zips = read_dbf_zips(z.read(dbf_name))
        polys = read_shp_polygons(z.read(shp_name))
    if len(zips) != len(polys):
        raise SystemExit(f"dbf/shp record mismatch: {len(zips)} vs {len(polys)}")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for state in states:
        shapes = {}
        for zcta, rings in zip(zips, polys):
            if not zcta.isdigit():
                continue
            z5 = int(zcta)
            if any(lo <= z5 <= hi for lo, hi in wanted[state]) and rings:
                shapes[zcta] = pack(rings)
        payload = {
            "format": "zcta-shapes-v1",
            "state": state,
            "source": (
                "US Census Bureau, 2020 Cartographic Boundary Files — "
                "ZCTAs, 1:500,000 (public domain). Simplified ~0.002°, "
                "quantized to 0.001°."
            ),
            "url": CB_URL,
            "count": len(shapes),
            "shapes": shapes,
        }
        out = OUT_DIR / f"{state}.json"
        out.write_text(json.dumps(payload, separators=(",", ":")))
        print(f"wrote {out}: {len(shapes)} ZCTAs, {out.stat().st_size:,} bytes")


if __name__ == "__main__":
    main()
