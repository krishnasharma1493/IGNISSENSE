#!/usr/bin/env python3
"""
Reproduce the backend's Overpass extraction from a Geofabrik PBF extract.

The live backend pulls OSM context tile by tile from Overpass with the query in
backend/src/modules/osm/osmExtractor.ts::buildOverpassQuery and `out center tags`.
Training needs the same context for all of India, and Overpass rate limits make
that impractical, so this script applies the identical tag filter to the PBF and
emits elements in the same shape Overpass returns:

  {"type": "node", "id": 1, "lat": .., "lon": .., "tags": {..}}
  {"type": "way",  "id": 2, "center": {"lat": .., "lon": ..}, "tags": {..}}

`center` is the centre of the element's bounding box, which is what Overpass
computes for `out center`. For relations the box spans member nodes and the nodes
of member ways (one level, which covers national parks and nature reserves).

The output is normalised by the backend's own normalizeOsmElement() when loaded,
so the taxonomy mapping is not reimplemented here.

Usage:
  python src/features/osm_elements.py \
      --pbf data/raw/reference/india-latest.osm.pbf \
      --out data/interim/osm_elements_india.ndjson
"""

import argparse
import os
import time

import duckdb


def v(k):
    return f"map_extract_value(tags, '{k}')"


# Mirrors buildOverpassQuery clause for clause.
NWR = " OR ".join([
    f"{v('industrial')} IS NOT NULL",
    f"{v('man_made')} = 'works'",
    f"{v('landuse')} = 'industrial'",
    f"{v('building')} = 'factory'",
    f"{v('building')} = 'warehouse'",
    f"{v('craft')} = 'brickmaker'",
    f"{v('power')} = 'plant'",
    f"{v('power')} = 'generator'",
    f"({v('power')} = 'substation' AND {v('voltage')} IS NOT NULL)",
    f"{v('man_made')} = 'petroleum_well'",
    f"{v('man_made')} = 'oil_well'",
    f"{v('man_made')} = 'flare'",
    f"{v('pipeline')} = 'substation'",
    f"{v('landuse')} = 'quarry'",
    f"{v('mining')} IS NOT NULL",
    f"{v('resource')} IS NOT NULL",
    f"{v('landuse')} = 'landfill'",
    f"{v('landuse')} = 'brownfield'",
])
WAY_ONLY = " OR ".join([
    f"{v('landuse')} = 'forest'",
    f"{v('natural')} = 'wood'",
    f"{v('natural')} = 'scrub'",
    f"{v('landuse')} = 'farmland'",
    f"{v('landuse')} = 'orchard'",
    f"{v('landuse')} = 'meadow'",
])
REL_ONLY = f"{v('boundary')} = 'national_park' OR {v('leisure')} = 'nature_reserve'"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--pbf', required=True)
    ap.add_argument('--out', required=True)
    args = ap.parse_args()

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    con = duckdb.connect()
    con.sql('INSTALL spatial; LOAD spatial;')
    con.sql('SET preserve_insertion_order = false')
    pbf = args.pbf.replace("'", "''")

    def step(label, sql):
        t = time.time()
        con.sql(sql)
        print(f'  {label}: {time.time() - t:.1f}s', flush=True)

    step('select tagged elements', f"""
        CREATE TABLE sel AS
        SELECT kind, id, tags, refs, ref_types, lat, lon FROM ST_ReadOSM('{pbf}')
        WHERE tags IS NOT NULL AND cardinality(tags) > 0 AND (
              (kind IN ('node','way','relation') AND ({NWR}))
           OR (kind = 'way' AND ({WAY_ONLY}))
           OR (kind = 'relation' AND ({REL_ONLY})))""")
    print('  ', con.sql('SELECT kind, count(*) FROM sel GROUP BY 1 ORDER BY 1').fetchall())

    step('relation members', """
        CREATE TABLE rel_members AS
        SELECT id AS rel_id, unnest(refs) AS ref, unnest(ref_types) AS ref_type
        FROM sel WHERE kind = 'relation'""")
    step('member ways not already selected', f"""
        CREATE TABLE member_ways AS
        SELECT id, refs FROM ST_ReadOSM('{pbf}')
        WHERE kind = 'way' AND id IN (SELECT ref FROM rel_members WHERE ref_type = 'way')""")
    step('way node refs', """
        CREATE TABLE way_nodes AS
        SELECT id AS way_id, unnest(refs) AS node_id FROM (
            SELECT id, refs FROM sel WHERE kind = 'way'
            UNION ALL SELECT id, refs FROM member_ways)""")
    step('resolve node coordinates', f"""
        CREATE TABLE node_xy AS
        SELECT id, lat, lon FROM ST_ReadOSM('{pbf}')
        WHERE kind = 'node' AND id IN (
            SELECT node_id FROM way_nodes
            UNION SELECT ref FROM rel_members WHERE ref_type = 'node')""")
    step('way bbox centres', """
        CREATE TABLE way_box AS
        SELECT w.way_id AS id, min(n.lat) s, max(n.lat) n, min(n.lon) w, max(n.lon) e
        FROM (SELECT DISTINCT way_id, node_id FROM way_nodes) w JOIN node_xy n ON n.id = w.node_id
        GROUP BY w.way_id""")
    step('relation bbox centres', """
        CREATE TABLE rel_box AS
        SELECT rel_id AS id, min(s) s, max(n) n, min(w) w, max(e) e FROM (
            SELECT m.rel_id, b.s, b.n, b.w, b.e FROM rel_members m JOIN way_box b ON m.ref_type = 'way' AND b.id = m.ref
            UNION ALL
            SELECT m.rel_id, x.lat, x.lat, x.lon, x.lon FROM rel_members m JOIN node_xy x ON m.ref_type = 'node' AND x.id = m.ref)
        GROUP BY rel_id""")

    out = args.out.replace("'", "''")
    step('write elements', f"""
        COPY (
          SELECT 'node' AS type, id, lat, lon, NULL AS center, to_json(tags) AS tags FROM sel WHERE kind = 'node'
          UNION ALL
          SELECT s.kind AS type, s.id, NULL, NULL,
                 {{'lat': (b.s + b.n) / 2, 'lon': (b.w + b.e) / 2}} AS center, to_json(s.tags)
          FROM sel s JOIN (SELECT * FROM way_box UNION ALL SELECT * FROM rel_box) b ON b.id = s.id
          WHERE s.kind IN ('way', 'relation')
        ) TO '{out}' (FORMAT json)""")
    n = con.sql(f"SELECT count(*) FROM read_json('{out}', format='newline_delimited')").fetchone()[0]
    missing = con.sql("""SELECT count(*) FROM sel s WHERE s.kind <> 'node'
        AND s.id NOT IN (SELECT id FROM way_box UNION SELECT id FROM rel_box)""").fetchone()[0]
    print(f'  wrote {n:,} elements to {args.out} ({missing} ways/relations had no resolvable geometry)')


if __name__ == '__main__':
    main()
