#!/usr/bin/env python3
"""Build The Family Ground's static U.S. places index.

Downloads each Geofabrik state extract, extracts family-place POIs
with extract_state.py, deletes the PBF, and finally slices the
national POI list into 0.5° x 0.5° JSON tiles under data/places/.

Resumable: a state whose shard already exists in work/shards/ is
skipped, so a re-run only does the states that are missing.

Usage:
  .venv/bin/python build_index.py             # extract missing + tile
  .venv/bin/python build_index.py --tile-only # just re-slice tiles
  .venv/bin/python build_index.py --states delaware,vermont
"""
import datetime
import glob
import json
import math
import os
import subprocess
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
WORK = os.path.join(HERE, "work")
SHARDS = os.path.join(WORK, "shards")
TILES_DIR = os.path.join(REPO, "data", "places")
PY = os.path.join(HERE, ".venv", "bin", "python")

STATES = [
    "alabama", "alaska", "arizona", "arkansas", "california", "colorado",
    "connecticut", "delaware", "district-of-columbia", "florida",
    "georgia", "hawaii", "idaho", "illinois", "indiana", "iowa",
    "kansas", "kentucky", "louisiana", "maine", "maryland",
    "massachusetts", "michigan", "minnesota", "mississippi", "missouri",
    "montana", "nebraska", "nevada", "new-hampshire", "new-jersey",
    "new-mexico", "new-york", "north-carolina", "north-dakota", "ohio",
    "oklahoma", "oregon", "pennsylvania", "rhode-island",
    "south-carolina", "south-dakota", "tennessee", "texas", "utah",
    "vermont", "virginia", "washington", "west-virginia", "wisconsin",
    "wyoming",
]

GEOFABRIK = "https://download.geofabrik.de/north-america/us/%s-latest.osm.pbf"

# Category key in shards -> short code inside tile files.
CAT_CODE = {
    "park": "park",
    "playground": "play",
    "library": "lib",
    "pool": "pool",
    "museum": "mus",
    "community": "comm",
}

CELL = 0.5  # degrees


def cell_of(lat, lon):
    return math.floor(lat / CELL), math.floor(lon / CELL)


def expected_size(url):
    out = subprocess.run(
        ["curl", "-sIL", "--max-time", "60", url],
        capture_output=True, text=True).stdout
    lengths = [int(line.split(":")[1]) for line in out.splitlines()
               if line.lower().startswith("content-length:")]
    return lengths[-1] if lengths else None


def download(slug, dest):
    """Download with curl resume until the file matches the server's
    Content-Length. Long downloads through the proxy can be cut
    mid-stream; a plain read loop would mistake that for EOF and
    silently keep a truncated file (seen on california: 270 MB of
    1,335 MB), so size is verified and the transfer resumed."""
    url = GEOFABRIK % slug
    expected = expected_size(url)
    for _attempt in range(15):
        have = os.path.getsize(dest) if os.path.exists(dest) else 0
        if expected is not None and have == expected:
            return
        if expected is not None and have > expected:
            os.remove(dest)
        subprocess.run(
            ["curl", "-sL", "-C", "-", "--retry", "3",
             "--max-time", "2400", "-o", dest, url],
            capture_output=True)
    have = os.path.getsize(dest) if os.path.exists(dest) else 0
    if expected is not None and have != expected:
        raise SystemExit(
            "download incomplete for %s: %d of %d bytes" % (slug, have, expected))


def extract_states(slugs):
    os.makedirs(SHARDS, exist_ok=True)
    for slug in slugs:
        shard = os.path.join(SHARDS, slug + ".jsonl")
        if os.path.exists(shard) and os.path.getsize(shard) > 0:
            print("skip (shard exists): %s" % slug, flush=True)
            continue
        pbf = os.path.join(WORK, slug + ".osm.pbf")
        want = expected_size(GEOFABRIK % slug)
        have = os.path.getsize(pbf) if os.path.exists(pbf) else 0
        if want is None or have != want:
            print("downloading %s ..." % slug, flush=True)
            download(slug, pbf)
        size_mb = os.path.getsize(pbf) / 1e6
        print("extracting %s (%.0f MB) ..." % (slug, size_mb), flush=True)
        result = subprocess.run(
            [PY, os.path.join(HERE, "extract_state.py"),
             slug, pbf, shard, WORK],
            capture_output=True, text=True)
        if result.returncode != 0:
            print(result.stdout)
            print(result.stderr, file=sys.stderr)
            raise SystemExit("extract failed for %s" % slug)
        print("  " + result.stdout.strip(), flush=True)
        os.remove(pbf)


def tile():
    seen = set()
    cells = {}
    per_cat = {}
    total = 0
    for shard in sorted(glob.glob(os.path.join(SHARDS, "*.jsonl"))):
        with open(shard, encoding="utf-8") as fh:
            for line in fh:
                rec = json.loads(line)
                if rec["i"] in seen:
                    continue
                seen.add(rec["i"])
                total += 1
                per_cat[rec["c"]] = per_cat.get(rec["c"], 0) + 1
                key = cell_of(rec["a"], rec["o"])
                entry = [
                    rec["n"],
                    CAT_CODE[rec["c"]],
                    round(rec["a"], 5),
                    round(rec["o"], 5),
                    rec["d"],
                ]
                cells.setdefault(key, []).append(entry)

    os.makedirs(TILES_DIR, exist_ok=True)
    for old in glob.glob(os.path.join(TILES_DIR, "*.json")):
        os.remove(old)
    total_bytes = 0
    for (la, lo), entries in sorted(cells.items()):
        name = "la%d_lo%d.json" % (la, lo)
        payload = json.dumps(entries, ensure_ascii=False,
                             separators=(",", ":"))
        path = os.path.join(TILES_DIR, name)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(payload)
        total_bytes += len(payload.encode("utf-8"))

    today = datetime.date.today()
    manifest = {
        "built": today.isoformat(),
        "month": today.strftime("%B %Y"),
        "total": total,
        "categories": per_cat,
        "tiles": len(cells),
    }
    with open(os.path.join(TILES_DIR, "manifest.json"), "w",
              encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=1)

    print("=== INDEX SUMMARY ===")
    print("total POIs: %d" % total)
    for cat in sorted(per_cat):
        print("  %-12s %d" % (cat, per_cat[cat]))
    print("tiles: %d" % len(cells))
    print("total size: %.1f MB" % (total_bytes / 1e6))
    if total < 100000 or total > 2000000:
        print("WARNING: total outside expected 100k-2M band — "
              "inspect before shipping", file=sys.stderr)
    return manifest


def main():
    args = sys.argv[1:]
    tile_only = "--tile-only" in args
    slugs = STATES
    for a in args:
        if a.startswith("--states"):
            slugs = a.split("=", 1)[1].split(",") if "=" in a else \
                args[args.index(a) + 1].split(",")
    if not tile_only:
        extract_states(slugs)
    tile()


if __name__ == "__main__":
    main()
