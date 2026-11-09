#!/usr/bin/env python3
"""Extract family-place POIs from one Geofabrik state .osm.pbf.

Usage: extract_state.py <state-slug> <pbf-path> <out-jsonl-path> [workdir]

Three streaming passes over the PBF with pyosmium (no location index,
so RAM stays flat even for California):

  pass 1 (relations): find relations whose tags match a POI category;
          record their member structure + the set of member way ids.
  pass 2 (ways):      record node-id lists for tag-matched ways and for
          ways that are members of matched relations.
  pass 3 (nodes):     emit node POIs directly; store coordinates of
          every node referenced by a recorded way into a temp sqlite
          db (disk-backed, so a state with millions of referenced
          nodes cannot blow up RAM).

Ways use their polygon centroid when closed (line centroid fallback);
relations use the area-weighted centroid of their stitched outer
rings (inner rings subtracted), with line-centroid and node-mean
fallbacks. Output is one JSON object per line:
  {"i": "n123|w123|r123", "c": <category>, "n": <name>,
   "a": <lat>, "o": <lon>, "d": <address line>}
"""
import json
import math
import os
import sqlite3
import sys

import osmium

# Category keys here are the pipeline's canonical keys; the tiler maps
# them to the short codes used inside the tile files.
def category_of(tags):
    leisure = tags.get("leisure")
    amenity = tags.get("amenity")
    tourism = tags.get("tourism")
    if leisure == "park":
        return "park"
    if leisure == "playground":
        return "playground"
    if amenity == "library":
        return "library"
    if leisure == "swimming_pool":
        # Same rule as the old Overpass clause: private / no-access
        # pools are not family places.
        if tags.get("access") in ("private", "no"):
            return None
        return "pool"
    if amenity == "public_bath":
        return "pool"
    if tourism == "museum":
        return "museum"
    if amenity == "community_centre":
        return "community"
    return None


def address_of(tags):
    line1 = ""
    if tags.get("addr:housenumber") or tags.get("addr:street"):
        line1 = ((tags.get("addr:housenumber") or "") + " " +
                 (tags.get("addr:street") or "")).strip()
    city = tags.get("addr:city") or tags.get("addr:town") or tags.get("addr:village") or ""
    if line1 and city:
        return line1 + ", " + city
    return line1 or city or ""


def tag_subset(tags):
    keep = {}
    for k in ("name", "leisure", "amenity", "tourism", "access",
              "addr:housenumber", "addr:street", "addr:city",
              "addr:town", "addr:village"):
        v = tags.get(k)
        if v is not None:
            keep[k] = v
    return keep


# ---------- geometry helpers (coords are (lon, lat) degree pairs) ----------

def ring_area_centroid(pts):
    """Shoelace centroid of a ring. Returns (signed_area, cx, cy)."""
    area2 = 0.0
    sx = 0.0
    sy = 0.0
    n = len(pts)
    for i in range(n):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % n]
        cross = x1 * y2 - x2 * y1
        area2 += cross
        sx += (x1 + x2) * cross
        sy += (y1 + y2) * cross
    if abs(area2) < 1e-12:
        return 0.0, 0.0, 0.0
    return area2 / 2.0, sx / (3.0 * area2), sy / (3.0 * area2)


def line_centroid(pts):
    """Length-weighted centroid of a polyline."""
    total = 0.0
    sx = 0.0
    sy = 0.0
    for i in range(len(pts) - 1):
        x1, y1 = pts[i]
        x2, y2 = pts[i + 1]
        seg = math.hypot(x2 - x1, y2 - y1)
        if seg == 0:
            continue
        total += seg
        sx += seg * (x1 + x2) / 2.0
        sy += seg * (y1 + y2) / 2.0
    if total == 0:
        return pts[0] if pts else None
    return (sx / total, sy / total)


def way_centroid(pts):
    if len(pts) == 1:
        return pts[0]
    if len(pts) >= 3 and pts[0] == pts[-1]:
        area, cx, cy = ring_area_centroid(pts)
        if abs(area) > 1e-10:
            return (cx, cy)
    return line_centroid(pts)


def stitch_rings(polylines):
    """Join polylines sharing endpoints into rings.

    Returns (closed_rings, leftover_polylines)."""
    segs = [list(p) for p in polylines if len(p) >= 2]
    rings = []
    leftovers = []
    while segs:
        ring = segs.pop()
        grew = True
        while grew and ring[0] != ring[-1]:
            grew = False
            for i, s in enumerate(segs):
                if s[0] == ring[-1]:
                    ring.extend(s[1:])
                elif s[-1] == ring[-1]:
                    ring.extend(list(reversed(s))[1:])
                elif s[-1] == ring[0]:
                    ring = s[:-1] + ring
                elif s[0] == ring[0]:
                    ring = list(reversed(s))[:-1] + ring
                else:
                    continue
                segs.pop(i)
                grew = True
                break
        if ring[0] == ring[-1] and len(ring) >= 4:
            rings.append(ring)
        else:
            leftovers.append(ring)
    return rings, leftovers


def relation_centroid(outer_lines, inner_lines, member_node_coords):
    """Area-weighted centroid of stitched outer rings minus inners."""
    outers, outer_left = stitch_rings(outer_lines)
    inners, _ = stitch_rings(inner_lines)
    total_w = 0.0
    sx = 0.0
    sy = 0.0
    for ring in outers:
        area, cx, cy = ring_area_centroid(ring)
        w = abs(area)
        if w > 0:
            total_w += w
            sx += w * cx
            sy += w * cy
    for ring in inners:
        area, cx, cy = ring_area_centroid(ring)
        w = abs(area)
        if w > 0 and total_w - w > 0:
            total_w -= w
            sx -= w * cx
            sy -= w * cy
    if total_w > 1e-10:
        return (sx / total_w, sy / total_w)
    # Fallback: length-weighted centroid over all member way lines.
    lines = outer_lines + inner_lines + outer_left
    flat = [pt for line in lines for pt in line]
    if len(flat) >= 2:
        c = None
        total = 0.0
        ax = ay = 0.0
        for line in lines:
            lc = line_centroid(line)
            if lc is None:
                continue
            length = sum(
                math.hypot(line[i + 1][0] - line[i][0], line[i + 1][1] - line[i][1])
                for i in range(len(line) - 1)
            )
            if length > 0:
                total += length
                ax += length * lc[0]
                ay += length * lc[1]
        if total > 0:
            c = (ax / total, ay / total)
        if c:
            return c
    if member_node_coords:
        n = len(member_node_coords)
        return (sum(p[0] for p in member_node_coords) / n,
                sum(p[1] for p in member_node_coords) / n)
    return None


# ---------- passes ----------

class RelationScan(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.matched = {}      # rel id -> (tag subset, members list)
        self.member_way_ids = set()
        self.member_node_ids = set()

    def relation(self, r):
        tags = tag_subset(r.tags)
        if category_of(tags) is None:
            return
        members = []
        for m in r.members:
            mtype = m.type  # 'n', 'w' or 'r'
            members.append((mtype, m.ref, m.role or ""))
            if mtype == "w":
                self.member_way_ids.add(m.ref)
            elif mtype == "n":
                self.member_node_ids.add(m.ref)
        self.matched[r.id] = (tags, members)


class WayScan(osmium.SimpleHandler):
    def __init__(self, member_way_ids):
        super().__init__()
        self.member_way_ids = member_way_ids
        self.matched = {}      # way id -> (tag subset, [node refs])
        self.member = {}       # way id -> [node refs]

    def way(self, w):
        # Cheap checks first: building the node-ref list for every
        # way in the file is the pass's hotspot, so only ways that
        # are matched or needed as relation members pay for it.
        tags = tag_subset(w.tags)
        matched = category_of(tags) is not None
        is_member = w.id in self.member_way_ids
        if not matched and not is_member:
            return
        refs = [n.ref for n in w.nodes]
        if is_member:
            self.member[w.id] = refs
        if matched:
            self.matched[w.id] = (tags, refs)


class NodeScan(osmium.SimpleHandler):
    def __init__(self, wanted_node_ids, db):
        super().__init__()
        self.wanted = wanted_node_ids
        self.db = db
        self.batch = []
        self.pois = []         # node POIs, emitted directly

    def _flush(self):
        if self.batch:
            self.db.executemany(
                "INSERT OR REPLACE INTO coords (id, lat, lon) VALUES (?, ?, ?)",
                self.batch)
            self.batch = []

    def node(self, n):
        if n.id in self.wanted:
            self.batch.append((n.id, n.location.lat, n.location.lon))
            if len(self.batch) >= 20000:
                self._flush()
        tags = n.tags
        if tags:
            sub = tag_subset(tags)
            if category_of(sub) is not None:
                self.pois.append((n.id, sub, n.location.lon, n.location.lat))


def main():
    slug, pbf, out_path = sys.argv[1], sys.argv[2], sys.argv[3]
    workdir = sys.argv[4] if len(sys.argv) > 4 else "."
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    db_path = os.path.join(workdir, slug + "-coords.db")
    if os.path.exists(db_path):
        os.remove(db_path)

    rel_scan = RelationScan()
    rel_scan.apply_file(pbf)
    way_scan = WayScan(rel_scan.member_way_ids)
    way_scan.apply_file(pbf)

    wanted = set(rel_scan.member_node_ids)
    for _tags, refs in way_scan.matched.values():
        wanted.update(refs)
    for refs in way_scan.member.values():
        wanted.update(refs)

    db = sqlite3.connect(db_path)
    db.execute("PRAGMA journal_mode = OFF")
    db.execute("PRAGMA synchronous = OFF")
    db.execute("CREATE TABLE coords (id INTEGER PRIMARY KEY, lat REAL, lon REAL)")
    node_scan = NodeScan(wanted, db)
    node_scan.apply_file(pbf)
    node_scan._flush()
    db.commit()

    def coords_for(refs):
        pts = []
        cur = db.cursor()
        for ref in refs:
            row = cur.execute(
                "SELECT lon, lat FROM coords WHERE id = ?", (ref,)).fetchone()
            if row is not None:
                pts.append((row[0], row[1]))
        return pts

    counts = {}
    written = 0
    with open(out_path, "w", encoding="utf-8") as out:
        def emit(oid, tags, lonlat):
            nonlocal written
            if lonlat is None:
                return
            lon, lat = lonlat
            rec = {
                "i": oid,
                "c": category_of(tags),
                "n": tags.get("name") or "",
                "a": round(lat, 6),
                "o": round(lon, 6),
                "d": address_of(tags),
            }
            out.write(json.dumps(rec, ensure_ascii=False) + "\n")
            counts[rec["c"]] = counts.get(rec["c"], 0) + 1
            written += 1

        for nid, tags, lon, lat in node_scan.pois:
            emit("n%d" % nid, tags, (lon, lat))
        for wid, (tags, refs) in way_scan.matched.items():
            pts = coords_for(refs)
            if len(pts) >= 1:
                emit("w%d" % wid, tags, way_centroid(pts))
        for rid, (tags, members) in rel_scan.matched.items():
            outer, inner, node_coords = [], [], []
            for mtype, ref, role in members:
                if mtype == "w":
                    refs = way_scan.member.get(ref)
                    if refs:
                        pts = coords_for(refs)
                        if len(pts) >= 2:
                            if role == "inner":
                                inner.append(pts)
                            else:
                                outer.append(pts)
                elif mtype == "n":
                    pts = coords_for([ref])
                    node_coords.extend(pts)
            emit("r%d" % rid, tags, relation_centroid(outer, inner, node_coords))

    db.close()
    os.remove(db_path)
    print(json.dumps({"state": slug, "pois": written, "by_category": counts}))


if __name__ == "__main__":
    main()
