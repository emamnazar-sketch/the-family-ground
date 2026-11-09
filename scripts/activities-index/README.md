# Activities index builder

Builds the static U.S. family-places index that powers the homepage
"Find activities near you" search. Instead of querying a live map
server at search time (the public Overpass mirrors take 45-80 s when
busy), the browser fetches 1-4 tiny JSON tiles from our own site and
answers in about a second.

## What it produces

- `data/places/la<LA>_lo<LO>.json` — one file per 0.5° x 0.5° grid
  cell that contains at least one place. `LA = floor(lat / 0.5)`,
  `LO = floor(lon / 0.5)` (the cell's south-west corner indices).
  Each file is a JSON array of rows:
  `[name, categoryCode, lat, lon, address]`
  with lat/lon rounded to 5 decimals. Category codes:
  `park`, `play` (playground), `lib` (library), `pool` (swimming
  pool / public bath), `mus` (museum), `comm` (community centre).
- `data/places/manifest.json` — build date, display month
  ("U.S. index updated <Month Year>" on the page), totals.

## Which places are included

From OpenStreetMap, per state extract (Geofabrik):

- parks: `leisure=park`
- playgrounds: `leisure=playground`
- libraries: `amenity=library`
- pools: `leisure=swimming_pool` with `access` not `private`/`no`,
  plus `amenity=public_bath`
- museums: `tourism=museum`
- community centres: `amenity=community_centre`

Nodes use their own coordinates; ways and relations use the feature
centroid (polygon centroid for closed ways / multipolygon relations,
length-weighted line centroid as fallback). Unnamed features are
kept with an empty name — the page shows the category label instead.
Duplicates across state extracts are removed by OSM type+id.

## Rebuild (monthly)

```sh
cd scripts/activities-index
python3 -m venv .venv            # first time only
.venv/bin/pip install osmium     # first time only
.venv/bin/python build_index.py  # download + extract + tile
```

The build is resumable: each state's extracted POIs are cached in
`work/shards/<state>.jsonl`; delete a shard to force that state to
be rebuilt. PBFs are downloaded one state at a time and deleted
right after extraction, so peak disk stays near one state extract
plus the shards. Useful flags:

- `--tile-only` — re-slice tiles from existing shards (no downloads)
- `--states delaware,vermont` — build only those states, then tile

After a rebuild, commit `data/places/` (and `js/activities.js` if it
changed) and push — Cloudflare Pages serves the tiles like any
other static file. The pipeline prints a summary (POIs per category,
tile count, total MB); a healthy national build lands in the
few-hundred-thousand POI range.

## How the page uses it

`js/activities.js` geocodes the town with Nominatim, computes the
grid cells covering a 12 km circle, fetches those tile files from
`/data/places/`, merges them, measures exact distances, and renders
the nearest places. A missing tile file (404) simply means that
cell has no places yet.
