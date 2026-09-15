#!/usr/bin/env python3
"""
Train/serve parity check for the active model artifact.

Takes feature vectors produced by the backend extractor, scores them twice:
  1. in-process: bundle model on feature_frame.to_model_frame (what training evaluated)
  2. over HTTP: the running inference service's POST /predict, in both the single
     `{ "features": {...} }` shape the backend sends and the batch `records` shape
and asserts the class probabilities agree (the service rounds to 4 decimals).

Also checks the service rejects an incomplete vector with 422 INCOMPLETE_FEATURES.

Usage:
  python src/evaluation/parity_check.py --url http://127.0.0.1:8000 --n 400
"""

import argparse
import glob
import json
import os
import random
import sys
import urllib.error
import urllib.request

import joblib
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
ML_ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, os.path.join(ML_ROOT, 'src', 'inference'))
from feature_frame import REQUIRED, to_model_frame  # noqa: E402


def post(url, payload):
    req = urllib.request.Request(url, data=json.dumps(payload).encode(), headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--url', default='http://127.0.0.1:8000')
    ap.add_argument('--n', type=int, default=400)
    ap.add_argument('--artifact', default=os.path.join(ML_ROOT, 'models', 'xgb_fire_classifier_v2.joblib'))
    args = ap.parse_args()

    with urllib.request.urlopen(f'{args.url}/health', timeout=10) as r:
        health = json.loads(r.read())
    bundle = joblib.load(args.artifact)
    print(f"service: {health['model_version']} ({health.get('data_source')}); artifact: {bundle['version']}")
    assert health['model_version'] == bundle['version'], 'service is not serving the artifact under test'
    features = bundle['features']

    rows = []
    for path in sorted(glob.glob(os.path.join(ML_ROOT, 'data', 'interim', 'features*.ndjson'))):
        with open(path) as fh:
            for line in fh:
                try:
                    rec = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if 'error' not in rec and not rec.get('unresolved'):
                    rows.append({k: rec.get(k) for k in features})
    random.Random(7).shuffle(rows)
    rows = rows[: args.n]
    # Include first-ever detections so the NaN path is exercised.
    n_null_history = sum(1 for r in rows if r['days_since_last_detection'] is None)

    local = bundle['model'].predict_proba(to_model_frame(pd.DataFrame(rows), features))

    single_diff = 0.0
    for i, rec in enumerate(rows):
        status, body = post(f'{args.url}/predict', {'features': rec})
        assert status == 200 and body['success'], body
        remote = np.array([body['data']['class_probabilities'][c] for c in bundle['classes']])
        single_diff = max(single_diff, float(np.abs(remote - local[i]).max()))
        assert body['data']['predicted_class'] == bundle['classes'][int(local[i].argmax())] or \
            np.isclose(local[i].max(), np.sort(local[i])[-2], atol=1e-4)

    status, body = post(f'{args.url}/predict', {'records': rows})
    assert status == 200 and body['success'], body
    remote = np.array([[d['class_probabilities'][c] for c in bundle['classes']] for d in body['data']])
    batch_diff = float(np.abs(remote - local).max())

    incomplete = dict(rows[0])
    incomplete[REQUIRED[6]] = None
    status, body = post(f'{args.url}/predict', {'features': incomplete})
    assert status == 422 and body['error']['code'] == 'INCOMPLETE_FEATURES', body

    print(f'rows compared: {len(rows)} (of which {n_null_history} with null days_since_last_detection)')
    print(f'max |p_service - p_training| single: {single_diff:.6f}, batch: {batch_diff:.6f}')
    assert single_diff <= 6e-5 and batch_diff <= 6e-5, 'service probabilities diverge from training-time scoring'
    print('incomplete vector rejected with 422 INCOMPLETE_FEATURES')
    print('PARITY OK')


if __name__ == '__main__':
    main()
