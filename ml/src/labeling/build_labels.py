#!/usr/bin/env python3
"""
Build thermal-event labels for FIRMS archive detections over India from sources
that are independent of the model's input features.

Why these sources
-----------------
The model sees FIRMS radiometry, OSM proximity/land-cover context, and detection
history. A label derived from any of those (e.g. "within 1.5 km of an OSM refinery
=> industrial") would let the model score well by re-learning the labelling rule.
So no label here reads OSM or the backend's feature vector. Labels come from:

  NASA FIRMS `type` (standard processing)   0 presumed vegetation fire, 1 active volcano,
                                            2 other static land source, 3 offshore
  EOG VIIRS Nightfire flare catalogue       gas flare sites by year (upstream, refinery, gas plant)
  Maus et al. (2022) mining polygons v2     mining footprints digitised from Sentinel-2 imagery
  ESA WorldCover 10 m 2021 v200             land cover under each detection's pixel footprint, read
                                            from the COG's 20 m overview (98.8% label agreement with 10 m)

Rules (applied in order; first match wins)
------------------------------------------
  gas_flare                type in {2,3} and within 1 km of a same-year VNF flare site
  mining_thermal_activity  type 2 and inside a mining polygon
  industrial_fire          type 2 (static land source, not a flare site, not a mine)
  other_or_uncertain       type 3 without a flare match; type 1; type 0 inside a mining
                           polygon (vegetation or mine fire cannot be told apart)
  agricultural_burning     type 0 and WorldCover cropland >= 60% of the pixel footprint
  wildfire                 type 0 and WorldCover tree/shrub/grass/mangrove >= 60% of footprint
  other_or_uncertain       type 0 with mixed or non-vegetated footprint

Leakage controls
----------------
  * Spatial: 0.5 degree blocks are assigned wholly to one partition.
  * Temporal: train/val use 2023 detections, test uses 2024 detections.
  * History features only look backwards, so 2024 test rows may see 2023 detections
    at their location, as production would. They never see a 2024 label.

Block assignment is stratified: rare thermal sources (coal-fire fields, offshore flare
platforms) sit in a handful of blocks, and a random block split can put nearly all of
one class into a single partition. Blocks are assigned greedily, largest class share
first, to the partition that keeps every class closest to the target partition shares.
Blocks are never split.

Stages
------
  python src/labeling/build_labels.py candidates   # FIRMS + flares + mines, sample type-0 rows
  python src/ingestion/fetch_sources.py worldcover --tiles $(cat data/interim/worldcover_tiles.txt)
  python src/labeling/build_labels.py finalize     # WorldCover footprint fractions, caps, outputs
"""

import argparse
import json
import math
import os
import sys
import time

import duckdb
import numpy as np
import pandas as pd

ML_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
RAW = os.path.join(ML_ROOT, 'data', 'raw')
INTERIM = os.path.join(ML_ROOT, 'data', 'interim')
PROCESSED = os.path.join(ML_ROOT, 'data', 'processed')
REF = os.path.join(RAW, 'reference')

sys.path.insert(0, os.path.join(ML_ROOT, 'src', 'training'))
from classes import CLASSES  # noqa: E402

SEED = 20260914
BLOCK_DEG = 0.5
PARTITION_SHARE = {'train': 0.68, 'val': 0.12, 'test': 0.20}
PARTITION_YEAR = {'train': 2023, 'val': 2023, 'test': 2024}
FLARE_RADIUS_M = 1000
PURITY = 0.60

# Type-0 rows sampled per partition before WorldCover labelling (bounds raster work).
TYPE0_SAMPLE = {'train': 160_000, 'val': 32_000, 'test': 64_000}
# Per-class caps for what goes to feature extraction and training.
CLASS_CAP = {'train': 30_000, 'val': 6_000, 'test': 12_000}

FLARE_FILES = {
    2023: 'VIIRS_Global_flaring_d.7_slope_0.029353_2023_v20230614_web_IDmatch.xlsx',
    2024: 'VIIRS_Global_flaring_d.7_slope_0.029353_2024_v20240730_web_IDmatch.xlsx',
}
FLARE_SHEETS = ['flare upstream', 'flare oil downstream', 'flare gas downstream']

WC_CROPLAND = {40}
WC_NATURAL_VEG = {10, 20, 30, 95}


def sql_path(p):
    """Quote a filesystem path for a SQL string literal (the repo path contains an apostrophe)."""
    return p.replace("'", "''")


def load_flares():
    frames = []
    for year, name in FLARE_FILES.items():
        path = os.path.join(REF, name)
        for sheet in FLARE_SHEETS:
            df = pd.read_excel(path, sheet_name=sheet)
            df = df[df['ISO Code'] == 'IND'][['Latitude', 'Longitude', 'Type']].copy()
            df.columns = ['lat', 'lon', 'flare_kind']
            df['year'] = year
            df['sheet'] = sheet
            frames.append(df)
    out = pd.concat(frames, ignore_index=True)
    print(f'  VNF flare sites in India: {out.groupby("year").size().to_dict()}')
    return out


def tile_name(lat, lon):
    la, lo = math.floor(lat / 3) * 3, math.floor(lon / 3) * 3
    return f"{'N' if la >= 0 else 'S'}{abs(la):02d}{'E' if lo >= 0 else 'W'}{abs(lo):03d}"


def footprint_box(lat, lon, scan_km, track_km):
    """Detection pixel footprint. FIRMS scan/track are the pixel's along-scan and
    along-track size in km; for polar orbiters scan runs roughly east-west."""
    half_w = scan_km * 1000 / 2 / (111_320 * math.cos(math.radians(lat)))
    half_h = track_km * 1000 / 2 / 110_574
    return lon - half_w, lat - half_h, lon + half_w, lat + half_h


def assign_blocks(counts: pd.DataFrame) -> pd.Series:
    """Stratified group assignment of spatial blocks to partitions.

    `counts` is indexed by block_id with one column per stratum. Each partition's
    share of each stratum is steered towards PARTITION_SHARE; a block goes wholly to
    the partition where it most reduces the total absolute deviation.
    """
    parts = list(PARTITION_SHARE)
    target = np.array([PARTITION_SHARE[p] for p in parts])
    M = counts.to_numpy(dtype=float)
    totals = np.maximum(M.sum(axis=0), 1.0)
    share = M / totals
    rng = np.random.default_rng(SEED)
    # Most concentrated blocks first; random tie-break keeps it seedable.
    order = np.lexsort((rng.random(len(M)), -share.max(axis=1)))
    acc = np.zeros((len(parts), M.shape[1]))
    assigned = np.empty(len(M), dtype=object)
    for i in order:
        cur = np.abs(acc / totals - target[:, None]).sum(axis=1)
        new = np.abs((acc + M[i]) / totals - target[:, None]).sum(axis=1)
        p = int(np.argmin(new - cur))
        acc[p] += M[i]
        assigned[i] = parts[p]
    return pd.Series(assigned, index=counts.index, name='partition')


def candidates():
    t0 = time.time()
    os.makedirs(INTERIM, exist_ok=True)
    con = duckdb.connect()
    con.sql('INSTALL spatial; LOAD spatial;')

    con.sql(f"""
        CREATE TABLE firms AS
        SELECT * EXCLUDE (filename),
               regexp_extract(filename, '([a-z0-9-]+)_(\\d{{4}})_India', 1) AS sensor_file,
               CAST(latitude AS DOUBLE) AS lat, CAST(longitude AS DOUBLE) AS lon,
               CAST(substr(acq_date, 1, 4) AS INTEGER) AS year,
               CAST(scan AS DOUBLE) AS scan_km, CAST(track AS DOUBLE) AS track_km
        FROM read_csv('{sql_path(RAW)}/firms/*_202[34]_India.csv', union_by_name = true, all_varchar = true, filename = true)
    """)
    # Production dedups on coordinates + timestamp + satellite + instrument.
    con.sql(f"""
        CREATE TABLE d AS
        SELECT *,
          md5(latitude || '|' || longitude || '|' || acq_date || '|' || acq_time || '|' || satellite || '|' || instrument) AS row_id,
          CAST(floor(lat / {BLOCK_DEG}) AS INTEGER) || '_' || CAST(floor(lon / {BLOCK_DEG}) AS INTEGER) AS block_id
        FROM (SELECT DISTINCT ON (latitude, longitude, acq_date, acq_time, satellite, instrument) * FROM firms)
    """)

    # Flare sites (same year), nearest distance within FLARE_RADIUS_M.
    con.register('flares_df', load_flares())
    con.sql("CREATE TABLE flares AS SELECT * FROM flares_df")
    dlat = FLARE_RADIUS_M / 110_574
    hav = """2 * 6371000 * asin(sqrt(pow(sin(radians(f.lat - d.lat) / 2), 2) +
             cos(radians(d.lat)) * cos(radians(f.lat)) * pow(sin(radians(f.lon - d.lon) / 2), 2)))"""
    con.sql(f"""
        CREATE TABLE flare_hit AS
        SELECT d.row_id, min({hav}) AS flare_dist_m
        FROM d JOIN flares f
          ON f.year = d.year
         AND f.lat BETWEEN d.lat - {dlat} AND d.lat + {dlat}
         AND f.lon BETWEEN d.lon - {dlat} / cos(radians(d.lat)) AND d.lon + {dlat} / cos(radians(d.lat))
        WHERE d.type IN ('2', '3')
        GROUP BY d.row_id
        HAVING min({hav}) <= {FLARE_RADIUS_M}
    """)

    # Mining polygons, India only. CRS tags are stripped so geometries compare as plain lon/lat.
    gpkg = os.path.join(REF, 'global_mining_polygons_v2.gpkg')
    con.sql(f"""
        CREATE TABLE mines AS
        SELECT ST_GeomFromWKB(ST_AsWKB(geom)) AS geom FROM ST_Read('{sql_path(gpkg)}') WHERE ISO3_CODE = 'IND'
    """)
    print(f"  mining polygons in India: {con.sql('SELECT count(*) FROM mines').fetchone()[0]}")
    con.sql("""
        CREATE TABLE mine_hit AS
        SELECT DISTINCT d.row_id
        FROM d JOIN mines m ON ST_Intersects(m.geom, ST_Point(d.lon, d.lat))
        WHERE d.type IN ('0', '2')
    """)

    con.sql("""
        CREATE TABLE lab AS
        SELECT d.*, fh.flare_dist_m, (mh.row_id IS NOT NULL) AS in_mine,
          CASE
            WHEN d.type IN ('2', '3') AND fh.row_id IS NOT NULL THEN 'gas_flare'
            WHEN d.type = '2' AND mh.row_id IS NOT NULL THEN 'mining_thermal_activity'
            WHEN d.type = '2' THEN 'industrial_fire'
            WHEN d.type IN ('1', '3') THEN 'other_or_uncertain'
            WHEN d.type = '0' AND mh.row_id IS NOT NULL THEN 'other_or_uncertain'
            WHEN d.type = '0' THEN NULL
          END AS label,
          CASE
            WHEN d.type IN ('2', '3') AND fh.row_id IS NOT NULL THEN 'firms_type_' || d.type || '+vnf_flare_site_within_1km'
            WHEN d.type = '2' AND mh.row_id IS NOT NULL THEN 'firms_type_2+maus2022_mining_polygon'
            WHEN d.type = '2' THEN 'firms_type_2_not_flare_not_mine'
            WHEN d.type = '1' THEN 'firms_type_1_volcano'
            WHEN d.type = '3' THEN 'firms_type_3_offshore_no_flare_match'
            WHEN d.type = '0' AND mh.row_id IS NOT NULL THEN 'firms_type_0_inside_mining_polygon'
            WHEN d.type = '0' THEN 'pending_worldcover'
          END AS label_rule
        FROM d
        LEFT JOIN flare_hit fh USING (row_id)
        LEFT JOIN mine_hit mh USING (row_id)
    """)

    # Stratified block assignment over both years' provisional labels.
    strata = con.sql("""
        SELECT block_id, coalesce(label, 'type0') AS stratum, count(*) AS n FROM lab GROUP BY ALL
    """).df().pivot_table(index='block_id', columns='stratum', values='n', fill_value=0)
    partition = assign_blocks(strata)
    con.register('block_partition', partition.reset_index())
    con.sql(f"""
        CREATE TABLE s AS
        SELECT lab.*,
          CASE WHEN bp.partition = 'test' AND lab.year = {PARTITION_YEAR['test']} THEN 'test'
               WHEN bp.partition = 'val' AND lab.year = {PARTITION_YEAR['val']} THEN 'val'
               WHEN bp.partition = 'train' AND lab.year = {PARTITION_YEAR['train']} THEN 'train'
               ELSE 'unused' END AS split
        FROM lab JOIN block_partition bp USING (block_id)
    """)
    print(con.sql("SELECT split, count(*) n, count(DISTINCT block_id) blocks FROM s GROUP BY 1 ORDER BY 1").fetchall())

    natural = con.sql("""
        SELECT split, coalesce(label, 'type0_pending_worldcover') AS label, count(*) AS n
        FROM s WHERE split <> 'unused' GROUP BY ALL ORDER BY ALL
    """).df()
    print(natural.to_string(index=False))

    # Deterministic type-0 sample per partition (ordered hash, independent of thread count).
    parts = []
    for split, n in TYPE0_SAMPLE.items():
        parts.append(con.sql(f"""
            SELECT * FROM s WHERE label IS NULL AND split = '{split}'
            ORDER BY hash(row_id || '{SEED}') LIMIT {n}
        """).df())
    type0 = pd.concat(parts, ignore_index=True)
    decided = con.sql("SELECT * FROM s WHERE label IS NOT NULL AND split <> 'unused'").df()
    cand = pd.concat([decided, type0], ignore_index=True)

    tiles = set()
    for r in type0.itertuples(index=False):
        w, s_, e, n = footprint_box(r.lat, r.lon, r.scan_km, r.track_km)
        for la in (s_, n):
            for lo in (w, e):
                tiles.add(tile_name(la, lo))

    cand.to_parquet(os.path.join(INTERIM, 'label_candidates.parquet'), index=False)
    natural.to_csv(os.path.join(INTERIM, 'natural_label_counts.csv'), index=False)
    partition.to_csv(os.path.join(INTERIM, 'block_partition.csv'))
    with open(os.path.join(INTERIM, 'worldcover_tiles.txt'), 'w') as f:
        f.write(' '.join(sorted(tiles)))
    print(f'  candidates: {len(cand):,} rows ({len(type0):,} sampled type-0); WorldCover tiles needed: {len(tiles)}')
    print(f'  done in {time.time() - t0:.0f}s')


def worldcover_fractions(df):
    """Class fractions of WorldCover pixels under each detection footprint."""
    import rasterio
    from rasterio.windows import from_bounds

    # 20 m first overview level of each WorldCover tile, cached by
    # fetch_sources.py worldcover-overview (98.8% label agreement with 10 m).
    wc_dir = os.path.join(REF, 'worldcover_ov0')
    counts = np.zeros((len(df), 101), dtype=np.int64)
    boxes = [footprint_box(r.lat, r.lon, r.scan_km, r.track_km) for r in df.itertuples(index=False)]

    by_tile = {}
    for i, (w, s, e, n) in enumerate(boxes):
        for t in {tile_name(la, lo) for la in (s, n) for lo in (w, e)}:
            by_tile.setdefault(t, []).append(i)

    for k, (t, idxs) in enumerate(sorted(by_tile.items())):
        path = os.path.join(wc_dir, f'ESA_WorldCover_10m_2021_v200_{t}_Map_ov0.tif')
        if not os.path.exists(path):
            # Ocean tiles have no WorldCover file; those rows keep zero valid pixels.
            print(f'  tile {t}: no file ({len(idxs)} rows)')
            continue
        tt = time.time()
        with rasterio.open(path) as src:
            tw, ts, te, tn = src.bounds
            # Footprints are scattered across the tile, so windowed reads thrash the
            # block cache. Decompress the tile once (36000x36000 uint8) and slice it.
            full = src.read(1) if len(idxs) > 300 else None
            for i in idxs:
                w, s, e, n = boxes[i]
                w2, s2, e2, n2 = max(w, tw), max(s, ts), min(e, te), min(n, tn)
                if w2 >= e2 or s2 >= n2:
                    continue
                win = from_bounds(w2, s2, e2, n2, src.transform).round_offsets().round_lengths()
                if full is not None:
                    r0, c0 = max(int(win.row_off), 0), max(int(win.col_off), 0)
                    arr = full[r0:r0 + int(win.height), c0:c0 + int(win.width)]
                else:
                    arr = src.read(1, window=win)
                if arr.size:
                    counts[i] += np.bincount(arr.ravel(), minlength=101)[:101]
            del full
        print(f'  tile {t} ({k + 1}/{len(by_tile)}): {len(idxs)} rows, {time.time() - tt:.1f}s', flush=True)

    counts[:, 0] = 0  # nodata
    valid = counts.sum(axis=1)
    # A missing tile would silently turn every land row in it into "no pixels" and
    # relabel it other_or_uncertain. Only genuinely ocean-edge rows may lack pixels.
    empty_share = float((valid == 0).mean()) if len(valid) else 0.0
    if empty_share > 0.01:
        raise RuntimeError(f'{empty_share:.1%} of type-0 footprints have no WorldCover pixels — '
                           f'tiles are missing from {wc_dir}; run fetch_sources.py worldcover-overview')
    frac = counts / np.maximum(valid, 1)[:, None]
    return valid, frac


def finalize():
    t0 = time.time()
    rng = np.random.default_rng(SEED)
    cand = pd.read_parquet(os.path.join(INTERIM, 'label_candidates.parquet'))
    natural = pd.read_csv(os.path.join(INTERIM, 'natural_label_counts.csv'))

    pending = cand['label'].isna()
    valid, frac = worldcover_fractions(cand[pending])
    crop = frac[:, sorted(WC_CROPLAND)].sum(axis=1)
    veg = frac[:, sorted(WC_NATURAL_VEG)].sum(axis=1)
    dominant = frac.argmax(axis=1)

    lab = np.where(valid == 0, 'other_or_uncertain',
          np.where(crop >= PURITY, 'agricultural_burning',
          np.where(veg >= PURITY, 'wildfire', 'other_or_uncertain')))
    rule = np.where(valid == 0, 'firms_type_0_no_worldcover_pixels',
           np.where(crop >= PURITY, 'firms_type_0+worldcover_cropland>=0.6',
           np.where(veg >= PURITY, 'firms_type_0+worldcover_natural_veg>=0.6',
                    'firms_type_0+worldcover_mixed_or_nonvegetated')))
    cand.loc[pending, 'label'] = lab
    cand.loc[pending, 'label_rule'] = rule
    for col in ('wc_valid_px', 'wc_cropland_frac', 'wc_natural_veg_frac', 'wc_dominant_class'):
        cand[col] = np.nan
    cand.loc[pending, 'wc_valid_px'] = valid
    cand.loc[pending, 'wc_cropland_frac'] = crop.round(4)
    cand.loc[pending, 'wc_natural_veg_frac'] = veg.round(4)
    cand.loc[pending, 'wc_dominant_class'] = dominant

    # Natural prevalence per partition. Type-0 classes are estimated by scaling the
    # WorldCover label mix of the uniform type-0 sample up to the partition's type-0 total.
    prevalence = {}
    for split in ['train', 'val', 'test']:
        nat = natural[natural['split'] == split].set_index('label')['n'].to_dict()
        t0_total = nat.pop('type0_pending_worldcover', 0)
        in_split = cand['split'] == split
        sampled_type0 = in_split & pending
        mix = cand.loc[sampled_type0, 'label'].value_counts(normalize=True).to_dict()
        est = {c: float(nat.get(c, 0)) for c in CLASSES}
        for c, share in mix.items():
            est[c] += share * t0_total
        prevalence[split] = est

    # Cap per class per partition (uniform random within class).
    keep = []
    for (split, label), g in cand.groupby(['split', 'label']):
        cap = CLASS_CAP[split]
        keep.append(g if len(g) <= cap else g.sample(n=cap, random_state=int(rng.integers(1 << 31))))
    final = pd.concat(keep, ignore_index=True)

    # Weight mapping each kept row back to its class's natural share, for
    # prevalence-weighted evaluation.
    kept_counts = final.groupby(['split', 'label']).size().to_dict()
    final['prevalence_weight'] = [
        prevalence[s][l] / kept_counts[(s, l)] for s, l in zip(final['split'], final['label'])
    ]

    os.makedirs(PROCESSED, exist_ok=True)
    cols = ['row_id', 'split', 'block_id', 'year', 'sensor_file', 'label', 'label_rule', 'prevalence_weight',
            'type', 'flare_dist_m', 'in_mine', 'wc_valid_px', 'wc_cropland_frac', 'wc_natural_veg_frac',
            'wc_dominant_class', 'latitude', 'longitude', 'acq_date', 'acq_time', 'satellite', 'instrument',
            'confidence', 'daynight', 'frp', 'scan', 'track']
    final[cols].to_parquet(os.path.join(PROCESSED, 'labels.parquet'), index=False)
    final[['row_id', 'latitude', 'longitude', 'acq_date', 'acq_time', 'satellite', 'instrument']].to_csv(
        os.path.join(INTERIM, 'labels_for_extraction.csv'), index=False)

    rule_counts = final.groupby(['split', 'label_rule']).size()
    report = {
        'seed': SEED,
        'block_deg': BLOCK_DEG,
        'partition_share_targets': PARTITION_SHARE,
        'partitions': {'train': '2023 detections in train blocks', 'val': '2023 detections in validation blocks',
                       'test': '2024 detections in test blocks'},
        'worldcover_purity_threshold': PURITY,
        'flare_radius_m': FLARE_RADIUS_M,
        'type0_sample_sizes': TYPE0_SAMPLE,
        'class_caps': CLASS_CAP,
        'kept_counts': {f'{s}/{l}': int(n) for (s, l), n in sorted(kept_counts.items())},
        'estimated_natural_counts': {s: {c: round(v) for c, v in d.items()} for s, d in prevalence.items()},
        'label_rule_counts': {f'{s}/{r}': int(n) for (s, r), n in rule_counts.items()},
    }
    with open(os.path.join(PROCESSED, 'label_report.json'), 'w') as f:
        json.dump(report, f, indent=2)
    print(pd.crosstab(final['label'], final['split']))
    print(f'  wrote {len(final):,} labelled rows; done in {time.time() - t0:.0f}s')


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('stage', choices=['candidates', 'finalize'])
    stage = ap.parse_args().stage
    candidates() if stage == 'candidates' else finalize()
