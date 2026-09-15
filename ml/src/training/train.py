#!/usr/bin/env python3
"""
SIH 2026 — Problem Statement 26162
IGNISSENSE XGBoost thermal-event classifier: training and evaluation.

Real mode (default) trains on NASA FIRMS standard-processing detections over India:

  labels    ml/data/processed/labels.parquet     built by src/labeling/build_labels.py from
            FIRMS `type`, EOG VIIRS Nightfire flare sites, Maus et al. (2022) mining
            polygons and ESA WorldCover 2021 — none of which is a model input.
  features  ml/data/interim/features.ndjson      computed by the backend's own
            extractFeaturesForHotspot + toCanonicalFeatureRecord
            (backend/src/scripts/training/extractTrainingFeatures.ts).

Only rows the live pipeline could actually classify are used: a row whose REQUIRED
features did not resolve would be gated to `unclassified_insufficient_features` in
production and never reach the model, so it is excluded from training and test alike,
and the exclusion is reported per class.

Partitions (from build_labels.py): train = 2023 in train blocks, val = 2023 in
validation blocks (early stopping), test = 2024 in held-out blocks. Blocks are 0.5°.

Synthetic mode (`--data-source synthetic`) is a fallback only. It writes
xgb_fire_classifier_synthetic.* and model_metadata_synthetic.json and never touches the
real artifact.

Usage:
  python src/training/train.py                           # real data
  python src/training/train.py --data-source synthetic   # fallback generator
"""

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone

import joblib
import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    confusion_matrix,
    f1_score,
    log_loss,
    precision_recall_fscore_support,
)
from sklearn.model_selection import GroupShuffleSplit

HERE = os.path.dirname(os.path.abspath(__file__))
ML_ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ML_ROOT, 'src', 'inference'))

from classes import (  # noqa: E402
    CLASSES, CLASS_TO_IDX, IDX_TO_CLASS, FEATURE_COLUMNS, FACILITY_TYPE_MAP, LANDCOVER_MAP,
)
from feature_frame import to_model_frame  # noqa: E402

REAL_VERSION = 'XGB-FIRMS-v2.0.0-INDIA-SP2023'
SYNTHETIC_VERSION = 'XGB-SYNTHETIC-v1.0.0'

HISTORY_FEATURES = [
    'nearby_cluster_count_3km', 'historical_recurrence_1_5km', 'historical_mean_frp',
    'frp_z_score', 'days_since_last_detection',
]
OSM_FEATURES = ['facility_distance_m', 'facility_type_encoded', 'landcover_encoded']

XGB_PARAMS = {
    'objective': 'multi:softprob',
    'num_class': len(CLASSES),
    'tree_method': 'hist',
    'max_depth': 7,
    'learning_rate': 0.05,
    'n_estimators': 2000,
    'subsample': 0.8,
    'colsample_bytree': 0.8,
    'min_child_weight': 5,
    'gamma': 0.0,
    'reg_alpha': 0.0,
    'reg_lambda': 1.0,
    'max_bin': 256,
    'random_state': 42,
    'n_jobs': -1,
    'eval_metric': 'mlogloss',
    'early_stopping_rounds': 60,
}


def check_schema_contract():
    """The artifact must match the declared schema the backend is built against."""
    with open(os.path.join(ML_ROOT, 'models', 'feature_schema.json')) as f:
        schema = json.load(f)
    problems = []
    if schema['features'] != FEATURE_COLUMNS:
        problems.append('features')
    if schema['classes'] != CLASSES:
        problems.append('classes')
    if schema['facility_type_map'] != FACILITY_TYPE_MAP:
        problems.append('facility_type_map')
    if schema['landcover_map'] != LANDCOVER_MAP:
        problems.append('landcover_map')
    if problems:
        sys.exit(f'feature_schema.json disagrees with classes.py on: {", ".join(problems)}')


# ─── Real data ────────────────────────────────────────────────────────────────

def load_real(labels_path, features_path):
    import glob

    labels = pd.read_parquet(labels_path)
    paths = sorted(glob.glob(features_path))
    if not paths:
        sys.exit(f'No feature files match {features_path}')
    records, malformed = [], 0
    for p in paths:
        with open(p) as fh:
            for line in fh:
                if not line.strip():
                    continue
                try:
                    records.append(json.loads(line))
                except json.JSONDecodeError:
                    # A shard interrupted mid-write leaves one partial line; the
                    # extractor re-does that row on resume.
                    malformed += 1
    feats = pd.DataFrame.from_records(records)
    feats['row_id'] = feats['row_id'].astype(str)
    if malformed:
        print(f'      skipped {malformed} partial line(s) in feature files')
    if 'error' in feats.columns:
        not_found = feats['error'].notna().sum()
        feats = feats[feats['error'].isna()].drop(columns=['error'])
    else:
        not_found = 0
    feats = feats.drop_duplicates('row_id', keep='last')
    missing_cols = [c for c in FEATURE_COLUMNS if c not in feats.columns]
    if missing_cols:
        sys.exit(f'Feature files lack columns: {missing_cols}')
    # labels.parquet keeps raw FIRMS columns (frp, confidence as CSV strings) for
    # provenance. They must not shadow the extractor's canonical values in the
    # merge — to_model_frame zero-fills a column it cannot find.
    label_cols = [c for c in labels.columns if c == 'row_id' or c not in feats.columns]
    df = labels[label_cols].merge(feats, on='row_id', how='inner')
    missing_cols = [c for c in FEATURE_COLUMNS if c not in df.columns]
    if missing_cols:
        sys.exit(f'Merged training frame lacks feature columns: {missing_cols}')
    missing_extraction = len(labels) - len(df)

    unresolved = df['unresolved'].apply(lambda u: len(u) if isinstance(u, list) else 0)
    df['servable'] = unresolved == 0
    gate = (
        df.groupby(['split', 'label'])['servable']
          .agg(total='size', servable='sum')
          .assign(excluded=lambda x: x['total'] - x['servable'])
          .reset_index()
    )
    unresolved_reasons = (
        df.loc[~df['servable'], 'unresolved'].explode().value_counts().to_dict()
    )
    served = df[df['servable']].copy()
    served['target'] = served['label'].map(CLASS_TO_IDX)
    return served, {
        'labelled_rows': int(len(labels)),
        'hotspot_not_found': int(not_found),
        'not_extracted': int(missing_extraction),
        'gate_by_split_and_class': gate.to_dict(orient='records'),
        'unresolved_feature_counts': {k: int(v) for k, v in unresolved_reasons.items()},
    }


def balanced_weights(y):
    counts = np.bincount(y, minlength=len(CLASSES)).astype(float)
    w = len(y) / (len(CLASSES) * np.maximum(counts, 1))
    return w[y]


def fit(train, val, columns):
    model = xgb.XGBClassifier(**XGB_PARAMS)
    Xtr = to_model_frame(train, FEATURE_COLUMNS)[columns]
    Xva = to_model_frame(val, FEATURE_COLUMNS)[columns]
    model.fit(
        Xtr, train['target'], sample_weight=balanced_weights(train['target'].to_numpy()),
        eval_set=[(Xva, val['target'])],
        sample_weight_eval_set=[balanced_weights(val['target'].to_numpy())],
        verbose=False,
    )
    return model


def evaluate(y_true, proba, weights=None):
    y_pred = proba.argmax(axis=1)
    labels = list(range(len(CLASSES)))
    p, r, f, s = precision_recall_fscore_support(y_true, y_pred, labels=labels, zero_division=0, sample_weight=weights)
    out = {
        'accuracy': round(float(accuracy_score(y_true, y_pred, sample_weight=weights)), 4),
        'macro_f1': round(float(f1_score(y_true, y_pred, labels=labels, average='macro', zero_division=0, sample_weight=weights)), 4),
        'weighted_f1': round(float(f1_score(y_true, y_pred, labels=labels, average='weighted', zero_division=0, sample_weight=weights)), 4),
        'log_loss': round(float(log_loss(y_true, proba, labels=labels, sample_weight=weights)), 4),
        'per_class': {
            CLASSES[i]: {'precision': round(float(p[i]), 4), 'recall': round(float(r[i]), 4),
                         'f1': round(float(f[i]), 4), 'support': float(round(s[i], 1)) if weights is not None else int(s[i])}
            for i in labels
        },
        'confusion_matrix': confusion_matrix(y_true, y_pred, labels=labels, sample_weight=weights).round(1).tolist(),
    }
    return out


def rule_baseline(df):
    """What a simplistic proximity rule on the model's own OSM features achieves.

    This is the kind of labeller the real dataset deliberately avoids; scoring it
    against the independent labels shows how much the model adds over it.
    """
    X = to_model_frame(df, FEATURE_COLUMNS)
    d, t, lc = X['facility_distance_m'], X['facility_type_encoded'], X['landcover_encoded']
    pred = np.full(len(X), CLASS_TO_IDX['other_or_uncertain'])
    pred[(lc == 2).to_numpy()] = CLASS_TO_IDX['wildfire']
    pred[(lc == 1).to_numpy()] = CLASS_TO_IDX['agricultural_burning']
    pred[((d <= 1500) & t.isin([2, 3, 4, 5, 7, 8])).to_numpy()] = CLASS_TO_IDX['industrial_fire']
    pred[((d <= 1500) & (t == 6)).to_numpy()] = CLASS_TO_IDX['mining_thermal_activity']
    pred[((d <= 1000) & (t == 1)).to_numpy()] = CLASS_TO_IDX['gas_flare']
    proba = np.full((len(X), len(CLASSES)), 1e-6)
    proba[np.arange(len(X)), pred] = 1.0
    return proba / proba.sum(axis=1, keepdims=True)


def train_real(args):
    check_schema_contract()
    print('=' * 78)
    print(f'IGNISSENSE — XGBoost thermal-event classifier on real FIRMS data ({REAL_VERSION})')
    print('=' * 78)

    df, gate_report = load_real(args.labels, args.features)
    train, val, test = (df[df['split'] == s] for s in ('train', 'val', 'test'))
    print(f'\n[1/5] Servable labelled rows: train {len(train):,} · val {len(val):,} · test {len(test):,}')
    print(f'      hotspot_not_found={gate_report["hotspot_not_found"]} not_extracted={gate_report["not_extracted"]}')
    print('      unresolved required features (excluded rows):', gate_report['unresolved_feature_counts'])
    dist = pd.crosstab(df['label'], df['split']).reindex(CLASSES).fillna(0).astype(int)
    print(dist.to_string())

    overlap = set(train['block_id']) & set(test['block_id'])
    overlap |= set(train['block_id']) & set(val['block_id'])
    if overlap:
        sys.exit(f'Spatial leakage: {len(overlap)} blocks appear in more than one partition')

    print('\n[2/5] Training (class-balanced weights, early stopping on validation blocks)...')
    t0 = time.time()
    model = fit(train, val, FEATURE_COLUMNS)
    print(f'      best iteration {model.best_iteration}, {time.time() - t0:.0f}s')

    print('\n[3/5] Evaluating on 2024 detections in held-out spatial blocks...')
    Xte = to_model_frame(test, FEATURE_COLUMNS)
    proba = model.predict_proba(Xte)
    y = test['target'].to_numpy()
    metrics_sample = evaluate(y, proba)
    metrics_prev = evaluate(y, proba, weights=test['prevalence_weight'].to_numpy())
    print(classification_report(y, proba.argmax(axis=1), labels=list(range(len(CLASSES))), target_names=CLASSES, zero_division=0, digits=3))
    print(f'      class-capped test set:     macro F1 {metrics_sample["macro_f1"]}, accuracy {metrics_sample["accuracy"]}')
    print(f'      prevalence-weighted test:  macro F1 {metrics_prev["macro_f1"]}, accuracy {metrics_prev["accuracy"]}')

    print('\n[4/5] Baselines and ablations (same partitions)...')
    baselines = {
        'majority_class': evaluate(y, np.eye(len(CLASSES))[np.full(len(y), np.bincount(train['target']).argmax())] * (1 - 6e-6) + 1e-6),
        'osm_proximity_rule': evaluate(y, rule_baseline(test)),
    }
    ablations = {}
    for name, drop in (('without_history_features', HISTORY_FEATURES), ('without_osm_features', OSM_FEATURES),
                       ('fire_radiometry_only', HISTORY_FEATURES + OSM_FEATURES)):
        cols = [c for c in FEATURE_COLUMNS if c not in drop]
        m = fit(train, val, cols)
        ablations[name] = {'dropped': drop, 'best_iteration': int(m.best_iteration),
                           **{k: v for k, v in evaluate(y, m.predict_proba(Xte[cols])).items() if k in ('accuracy', 'macro_f1', 'log_loss', 'per_class')}}
    for k, v in baselines.items():
        print(f'      baseline {k:<26} macro F1 {v["macro_f1"]}')
    for k, v in ablations.items():
        print(f'      ablation {k:<26} macro F1 {v["macro_f1"]}')

    gain = model.get_booster().get_score(importance_type='gain')
    total = sum(gain.values()) or 1.0
    importances = {c: round(gain.get(c, 0.0) / total, 4) for c in FEATURE_COLUMNS}

    print('\n[5/5] Exporting artifacts...')
    models_dir = os.path.join(ML_ROOT, 'models')
    trained_at = datetime.now(timezone.utc).isoformat()
    bundle = {
        'model': model,
        'features': FEATURE_COLUMNS,
        'classes': CLASSES,
        'class_to_idx': CLASS_TO_IDX,
        'idx_to_class': IDX_TO_CLASS,
        'facility_type_map': FACILITY_TYPE_MAP,
        'landcover_map': LANDCOVER_MAP,
        'version': REAL_VERSION,
        'trained_at': trained_at,
        'data_source': 'real',
    }
    joblib_path = os.path.join(models_dir, 'xgb_fire_classifier_v2.joblib')
    joblib.dump(bundle, joblib_path)
    model.save_model(os.path.join(models_dir, 'xgb_fire_classifier_v2.json'))

    with open(os.path.join(ML_ROOT, 'data', 'processed', 'label_report.json')) as f:
        label_report = json.load(f)
    with open(os.path.join(ML_ROOT, 'data', 'raw', 'firms', 'MANIFEST.json')) as f:
        firms_manifest = json.load(f)

    metadata = {
        'model_name': 'IGNISSENSE XGBoost Thermal-Event Classifier',
        'version': REAL_VERSION,
        'active_artifact': 'models/xgb_fire_classifier_v2.joblib',
        'data_source': 'real',
        'framework': f'XGBoost {xgb.__version__}',
        'trained_at': trained_at,
        'features': FEATURE_COLUMNS,
        'feature_version': 'v1.1.0',
        'classes': CLASSES,
        'training_data': {
            'detections': 'NASA FIRMS standard-processing (archive) active fire detections, India country files, '
                          'VIIRS S-NPP 375 m, VIIRS NOAA-20 375 m, MODIS Aqua/Terra 1 km',
            'years': {'history_context': '2022-2024', 'train_val_labels': 2023, 'test_labels': 2024},
            'extra_context': 'VIIRS NOAA-21 NRT 2024 (unlabelled; production ingests NOAA-21, the archive does not carry it)',
            'osm_context': 'Geofabrik india-latest.osm.pbf filtered with the backend Overpass query, '
                           'normalised by the backend normalizeOsmElement()',
            'firms_files': firms_manifest,
        },
        'feature_extraction': 'backend extractFeaturesForHotspot + toCanonicalFeatureRecord against a local database '
                              'holding the archive detections and OSM context; history/cluster queries look backwards only',
        'label_generation_method': 'independent_sources_v1',
        'labeling': {
            'sources': {
                'firms_type': 'NASA FIRMS `type`: 0 presumed vegetation fire, 1 active volcano, 2 other static land source, 3 offshore',
                'vnf_flares': 'Earth Observation Group VIIRS Nightfire global flare catalogues 2023 and 2024 (upstream, refinery, gas plant sheets)',
                'mining_polygons': 'Maus et al. (2022) Global-scale mining polygons v2, PANGAEA doi:10.1594/PANGAEA.942325 (CC BY-SA 4.0)',
                'land_cover': 'ESA WorldCover 10 m 2021 v200 (CC BY 4.0), class fractions over each detection pixel footprint '
                              '(scan x track), read from the 20 m first overview level (98.8% label agreement with 10 m on 3,000 footprints)',
            },
            'rules': [
                'gas_flare: type 2 or 3 within 1 km of a same-year VNF flare site',
                'mining_thermal_activity: type 2 inside a mining polygon',
                'industrial_fire: type 2, not a flare site, not a mining polygon',
                'agricultural_burning: type 0, WorldCover cropland >= 60% of footprint',
                'wildfire: type 0, WorldCover tree/shrub/grass/mangrove >= 60% of footprint',
                'other_or_uncertain: type 1; type 3 without flare match; type 0 inside mining polygon; type 0 with mixed or non-vegetated footprint',
            ],
            'independence': 'No label reads OSM or any model input feature.',
            'report': label_report,
        },
        'split_method': '0.5 degree spatial blocks assigned wholly to one partition; train = 2023 in train blocks, '
                        'val = 2023 in validation blocks (early stopping only), test = 2024 in held-out blocks',
        'serving_gate': gate_report,
        'class_distribution_servable': {s: dist[s].to_dict() for s in dist.columns},
        'hyperparameters': {**{k: v for k, v in XGB_PARAMS.items()}, 'best_iteration': int(model.best_iteration),
                            'sample_weighting': 'class-balanced'},
        'metrics': {
            'test_class_capped': {k: metrics_sample[k] for k in ('accuracy', 'macro_f1', 'weighted_f1', 'log_loss')},
            'test_prevalence_weighted': {k: metrics_prev[k] for k in ('accuracy', 'macro_f1', 'weighted_f1', 'log_loss')},
        },
        'per_class_metrics': metrics_sample['per_class'],
        'per_class_metrics_prevalence_weighted': metrics_prev['per_class'],
        'confusion_matrix': metrics_sample['confusion_matrix'],
        'confusion_matrix_order': CLASSES,
        'baselines': {k: {kk: v[kk] for kk in ('accuracy', 'macro_f1', 'per_class')} for k, v in baselines.items()},
        'ablations': ablations,
        'feature_importances_gain': importances,
        'limitations': args.limitations,
    }
    with open(os.path.join(models_dir, 'model_metadata.json'), 'w') as f:
        json.dump(metadata, f, indent=2)

    print(f'      {joblib_path}')
    print(f'      {os.path.join(models_dir, "xgb_fire_classifier_v2.json")}')
    print(f'      {os.path.join(models_dir, "model_metadata.json")}')
    print('\nDone.')


# ─── Synthetic fallback ───────────────────────────────────────────────────────

def train_synthetic():
    from synthetic import construct_dataset

    check_schema_contract()
    print('SYNTHETIC FALLBACK — not real data; metrics are meaningless.')
    df = construct_dataset(num_samples=10000, random_state=42)
    gss = GroupShuffleSplit(n_splits=1, test_size=0.20, random_state=42)
    tr, te = next(gss.split(df, df['target'], groups=df['grid_group']))
    params = {k: v for k, v in XGB_PARAMS.items() if k != 'early_stopping_rounds'}
    params['n_estimators'] = 220
    model = xgb.XGBClassifier(**params)
    model.fit(to_model_frame(df.iloc[tr], FEATURE_COLUMNS), df.iloc[tr]['target'], verbose=False)

    models_dir = os.path.join(ML_ROOT, 'models')
    trained_at = datetime.now(timezone.utc).isoformat()
    joblib.dump({
        'model': model, 'features': FEATURE_COLUMNS, 'classes': CLASSES, 'class_to_idx': CLASS_TO_IDX,
        'idx_to_class': IDX_TO_CLASS, 'facility_type_map': FACILITY_TYPE_MAP, 'landcover_map': LANDCOVER_MAP,
        'version': SYNTHETIC_VERSION, 'trained_at': trained_at, 'data_source': 'synthetic',
    }, os.path.join(models_dir, 'xgb_fire_classifier_synthetic.joblib'))
    model.save_model(os.path.join(models_dir, 'xgb_fire_classifier_synthetic.json'))
    with open(os.path.join(models_dir, 'model_metadata_synthetic.json'), 'w') as f:
        json.dump({
            'version': SYNTHETIC_VERSION, 'data_source': 'synthetic', 'trained_at': trained_at,
            'provenance_warning': 'Trained on numpy-generated rows, not FIRMS or OSM data. Labels are a deterministic '
                                  'function of the sampled features. Do not cite any metric from this artifact.',
            'features': FEATURE_COLUMNS, 'classes': CLASSES,
        }, f, indent=2)
    print('Wrote models/xgb_fire_classifier_synthetic.{joblib,json} and models/model_metadata_synthetic.json')


DEFAULT_LIMITATIONS = []

if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--data-source', choices=['real', 'synthetic'], default='real')
    ap.add_argument('--labels', default=os.path.join(ML_ROOT, 'data', 'processed', 'labels.parquet'))
    ap.add_argument('--features', default=os.path.join(ML_ROOT, 'data', 'interim', 'features*.ndjson'),
                    help='glob of extractor NDJSON outputs (shards are concatenated)')
    ap.add_argument('--limitations-file', default=os.path.join(ML_ROOT, 'models', 'LIMITATIONS.json'))
    args = ap.parse_args()
    if args.data_source == 'synthetic':
        train_synthetic()
    else:
        args.limitations = DEFAULT_LIMITATIONS
        if os.path.exists(args.limitations_file):
            with open(args.limitations_file) as f:
                args.limitations = json.load(f)
        train_real(args)
