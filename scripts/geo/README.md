# Exhibits geo pipeline

The territory map draws every geographic unit as its **actual
boundary** — never a dot:

- **state / county grain** — polygons come from the bundled us-atlas
  catalog (`packages/ui/src/GeoMapEditor/geoCatalog.ts`), the same
  geometry the Rate Lab maps use.
- **zip grain** — member ZCTAs render from per-state boundary
  chunks in `frontend/public/geo/zcta-shapes/{STATE}.json`, built by
  [`build-zcta-shapes.py`](./build-zcta-shapes.py):

```sh
python3 scripts/geo/build-zcta-shapes.py NE IA   # add states as needed
```

The script downloads the **US Census Bureau 2020 Cartographic
Boundary ZCTA shapefile** (1:500,000, public domain, ~66 MB, cached
after the first run), assigns ZCTAs to states through the SAME USPS
SCF ranges the platform's `zip5_to_state` transformer uses (parsed
from `geoTransformers.ts`, never duplicated), simplifies (~0.002°)
and quantizes (0.001°) the rings, winds rings for d3-geo's spherical convention (exterior
clockwise — the opposite of RFC 7946; holes attached to their
outers), and emits one compact chunk per state (~400 KB for
Nebraska's 586 ZCTAs).

Only states a fixture needs are committed — Nebraska today. A plan
whose members reach an unbundled state gets an honest note and the
diverging-bars fallback, never an invented boundary. PO-box-only
ZIPs have no ZCTA at all; they're counted in the map's note.

The workbook lint has its own, separate universe asset —
`server/src/openrater/rates/ingest/assets/geo-universe.json`, built
by [`build-geo-universe.py`](./build-geo-universe.py) from the 2024
Census Gazetteer (all 51 states at once, ~220 KB: ZCTAs by SCF
range, counties by their USPS column). It powers the R-083…R-085
checks: in-scope keys a `geo.<slug>` sheet never maps, keys outside
the declared scope, and keys the Census universe doesn't know
(PO-box ZIPs have no ZCTA).

```sh
python3 scripts/geo/build-geo-universe.py
```

Census tract is not yet a `geo_granularity` the dimension model
declares; when it lands, the same per-state chunk mechanism serves
it (Census publishes tract cartographic files per state).

No bureau or carrier rate content is involved — geography only
(repo rule C5).
