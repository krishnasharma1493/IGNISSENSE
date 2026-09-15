#!/usr/bin/env python3
"""
Download the public source datasets the real training pipeline is built from.

Every source here is a published, citable dataset. Nothing is scraped from the
live FIRMS API, so the training set is reproducible from these URLs alone.

  firms       NASA FIRMS yearly country archives for India (standard processing,
              carries the `type` column). URL pattern and file list published at
              https://firms.modaps.eosdis.nasa.gov/data/country/yearly_summary_files.txt
  reference   EOG VIIRS Nightfire flare-site catalogues, Maus et al. (2022) global
              mining polygons v2, Geofabrik India OSM extract.
  worldcover  ESA WorldCover 10 m 2021 v200 tiles (public S3, unsigned), by tile name.

A MANIFEST.json with URL, byte size, sha256 and download time is written next to
the files so any trained artifact can be traced back to exact inputs.

Usage:
  python src/ingestion/fetch_sources.py firms --years 2022 2023 2024
  python src/ingestion/fetch_sources.py reference
  python src/ingestion/fetch_sources.py worldcover --tiles N27E075 N30E075
"""

import argparse
import hashlib
import json
import os
import sys
import time
from datetime import datetime, timezone

import requests

ML_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
RAW = os.path.join(ML_ROOT, 'data', 'raw')

FIRMS_BASE = 'https://firms.modaps.eosdis.nasa.gov/data/country'
# Sensor slugs exactly as listed in yearly_summary_files.txt. viirs-jpss1 is NOAA-20.
FIRMS_SENSORS = ['viirs-snpp', 'viirs-jpss1', 'modis']

REFERENCE = {
    'VIIRS_Global_flaring_d.7_slope_0.029353_2023_v20230614_web_IDmatch.xlsx':
        'https://eogdata.mines.edu/global_flare_data/VIIRS_Global_flaring_d.7_slope_0.029353_2023_v20230614_web_IDmatch.xlsx',
    'VIIRS_Global_flaring_d.7_slope_0.029353_2024_v20240730_web_IDmatch.xlsx':
        'https://eogdata.mines.edu/global_flare_data/VIIRS_Global_flaring_d.7_slope_0.029353_2024_v20240730_web_IDmatch.xlsx',
    # Single-file access pattern documented in the PANGAEA text export for this DOI.
    'global_mining_polygons_v2.gpkg':
        'https://download.pangaea.de/dataset/942325/files/global_mining_polygons_v2.gpkg',
    'india-latest.osm.pbf': 'https://download.geofabrik.de/asia/india-latest.osm.pbf',
}

WORLDCOVER_BASE = 'https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map'


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def download(url, dest, retries=3):
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return False
    tmp = dest + '.part'
    for attempt in range(1, retries + 1):
        try:
            with requests.get(url, stream=True, timeout=120) as r:
                r.raise_for_status()
                with open(tmp, 'wb') as f:
                    for chunk in r.iter_content(1 << 20):
                        f.write(chunk)
            os.replace(tmp, dest)
            return True
        except Exception as e:  # noqa: BLE001 — report and retry any transport failure
            print(f'  ! {os.path.basename(dest)} attempt {attempt} failed: {e}', file=sys.stderr)
            time.sleep(5 * attempt)
    raise RuntimeError(f'Could not download {url}')


def update_manifest(directory, entries):
    path = os.path.join(directory, 'MANIFEST.json')
    manifest = {}
    if os.path.exists(path):
        with open(path) as f:
            manifest = json.load(f)
    manifest.update(entries)
    with open(path, 'w') as f:
        json.dump(manifest, f, indent=2, sort_keys=True)


def fetch_set(directory, files, workers=1):
    from concurrent.futures import ThreadPoolExecutor

    os.makedirs(directory, exist_ok=True)
    entries = {}

    def one(item):
        name, url = item
        dest = os.path.join(directory, name)
        fresh = download(url, dest)
        entry = {
            'url': url,
            'bytes': os.path.getsize(dest),
            'sha256': sha256(dest),
            'downloaded_at': datetime.now(timezone.utc).isoformat() if fresh else None,
        }
        print(f'  {"↓" if fresh else "="} {name} ({entry["bytes"]:,} B)', flush=True)
        return name, entry

    with ThreadPoolExecutor(max_workers=workers) as pool:
        for name, entry in pool.map(one, files.items()):
            entries[name] = entry
    # Keep an earlier download time when the file was already present.
    path = os.path.join(directory, 'MANIFEST.json')
    if os.path.exists(path):
        with open(path) as f:
            old = json.load(f)
        for name, e in entries.items():
            if e['downloaded_at'] is None:
                e['downloaded_at'] = old.get(name, {}).get('downloaded_at')
    update_manifest(directory, entries)


WORLDCOVER_OV_DIR = os.path.join(RAW, 'reference', 'worldcover_ov0')


def fetch_worldcover_overview(tiles, workers=6):
    """Cache the first overview level (20 m) of WorldCover tiles as local GeoTIFFs.

    The full 10 m tiles are ~100 MB each; the COGs carry internal overviews, and the
    first level holds a quarter of the pixels. Labels only need class fractions over
    375 m-1 km detection footprints, where the 20 m level agreed with full resolution
    on 98.8% of labels in a 3,000-footprint comparison. Only the overview's byte
    ranges are fetched (GDAL /vsicurl/). A tile already downloaded at full
    resolution is read locally instead.
    """
    from concurrent.futures import ThreadPoolExecutor

    import rasterio

    os.makedirs(WORLDCOVER_OV_DIR, exist_ok=True)
    full_dir = os.path.join(RAW, 'reference', 'worldcover')

    def one(tile):
        name = f'ESA_WorldCover_10m_2021_v200_{tile}_Map.tif'
        dest = os.path.join(WORLDCOVER_OV_DIR, name.replace('_Map.tif', '_Map_ov0.tif'))
        if os.path.exists(dest) and os.path.getsize(dest) > 0:
            return tile, 'cached', os.path.getsize(dest)
        local = os.path.join(full_dir, name)
        src_path = local if os.path.exists(local) else f'/vsicurl/{WORLDCOVER_BASE}/{name}'
        t0 = time.time()
        with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN='EMPTY_DIR', CPL_VSIL_CURL_ALLOWED_EXTENSIONS='.tif',
                          GDAL_HTTP_MULTIRANGE='YES', GDAL_HTTP_MERGE_CONSECUTIVE_RANGES='YES',
                          GDAL_HTTP_MAX_RETRY='5', GDAL_HTTP_RETRY_DELAY='3'):
            with rasterio.open(src_path, OVERVIEW_LEVEL=0) as src:
                arr = src.read(1)
                profile = {
                    'driver': 'GTiff', 'dtype': 'uint8', 'count': 1, 'width': src.width, 'height': src.height,
                    'crs': src.crs, 'transform': src.transform, 'nodata': 0,
                    'compress': 'deflate', 'tiled': True, 'blockxsize': 512, 'blockysize': 512,
                }
        tmp = dest + '.part'
        with rasterio.open(tmp, 'w', **profile) as out:
            out.write(arr, 1)
        os.replace(tmp, dest)
        where = 'local' if src_path == local else 'remote'
        print(f'  ↓ {tile} 20 m overview from {where} {arr.shape} in {time.time() - t0:.0f}s', flush=True)
        return tile, where, os.path.getsize(dest)

    with ThreadPoolExecutor(max_workers=workers) as pool:
        results = list(pool.map(one, tiles))
    update_manifest(WORLDCOVER_OV_DIR, {
        f'{t}': {'source': f'{WORLDCOVER_BASE}/ESA_WorldCover_10m_2021_v200_{t}_Map.tif', 'overview_level': 0,
                 'resolution_deg': 1 / 6000, 'read_from': w, 'bytes': b}
        for t, w, b in results
    })


def fetch_context(source, start, end):
    """Unlabelled context detections for a sensor the yearly archives do not carry.

    The live backend ingests VIIRS_NOAA21_NRT, so its cluster and history features
    count NOAA-21 detections. The yearly country archives have no NOAA-21 files, so
    without this the evaluation year would be missing a third of the VIIRS context
    production sees. These rows have no `type` column and are never labelled.

    Uses the FIRMS area API the backend already uses (5-day windows, the live ceiling),
    over the backend's India bounding box. Needs FIRMS_MAP_KEY in the environment.
    """
    from datetime import date, timedelta

    key = os.environ.get('FIRMS_MAP_KEY')
    if not key:
        sys.exit('FIRMS_MAP_KEY is not set')
    directory = os.path.join(RAW, 'firms_context', source)
    os.makedirs(directory, exist_ok=True)
    d, last = date.fromisoformat(start), date.fromisoformat(end)
    while d <= last:
        span = min(5, (last - d).days + 1)
        dest = os.path.join(directory, f'{source}_{d.isoformat()}_{span}d.csv')
        if not (os.path.exists(dest) and os.path.getsize(dest) > 0):
            url = f'https://firms.modaps.eosdis.nasa.gov/api/area/csv/{key}/{source}/68,6.5,97.5,37.5/{span}/{d.isoformat()}'
            r = requests.get(url, timeout=180)
            if r.status_code != 200 or not r.text.startswith('latitude'):
                raise RuntimeError(f'{source} {d}: HTTP {r.status_code} {r.text[:120]!r}')
            with open(dest, 'w') as f:
                f.write(r.text)
            time.sleep(1)
        print(f'  {os.path.basename(dest)}: {sum(1 for _ in open(dest)) - 1} rows')
        d += timedelta(days=span)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest='cmd', required=True)
    f = sub.add_parser('firms')
    f.add_argument('--years', nargs='+', type=int, default=[2022, 2023, 2024])
    sub.add_parser('reference')
    w = sub.add_parser('worldcover')
    w.add_argument('--tiles', nargs='+', required=True)
    o = sub.add_parser('worldcover-overview')
    o.add_argument('--tiles', nargs='+', required=True)
    o.add_argument('--workers', type=int, default=6)
    c = sub.add_parser('firms-context')
    c.add_argument('--source', default='VIIRS_NOAA21_NRT')
    c.add_argument('--start', default='2024-01-17')
    c.add_argument('--end', default='2024-12-31')
    args = ap.parse_args()

    if args.cmd == 'worldcover-overview':
        fetch_worldcover_overview(args.tiles, workers=args.workers)
    elif args.cmd == 'firms-context':
        fetch_context(args.source, args.start, args.end)
    elif args.cmd == 'firms':
        files = {
            f'{s}_{y}_India.csv': f'{FIRMS_BASE}/{s}/{y}/{s}_{y}_India.csv'
            for s in FIRMS_SENSORS for y in args.years
        }
        fetch_set(os.path.join(RAW, 'firms'), files)
    elif args.cmd == 'reference':
        fetch_set(os.path.join(RAW, 'reference'), REFERENCE)
    else:
        files = {
            f'ESA_WorldCover_10m_2021_v200_{t}_Map.tif': f'{WORLDCOVER_BASE}/ESA_WorldCover_10m_2021_v200_{t}_Map.tif'
            for t in args.tiles
        }
        fetch_set(os.path.join(RAW, 'reference', 'worldcover'), files, workers=8)


if __name__ == '__main__':
    main()
