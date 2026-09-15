#!/usr/bin/env python3
"""
SIH 2026 — Problem Statement 26162
Single-sample smoke check against the active model artifact.

Loads the artifact the inference service would load and scores one canonical
14-feature record through the shared serving transform.
"""

import json
import os
import sys

import joblib
import numpy as np
import pandas as pd

from feature_frame import missing_required, to_model_frame

MODELS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'models')


def load_trained_model():
    explicit = os.environ.get('IGNISSENSE_MODEL_ARTIFACT')
    candidates = [explicit] if explicit else [
        os.path.join(MODELS_DIR, n)
        for n in ('xgb_fire_classifier_v2.joblib', 'xgb_fire_classifier_v1.joblib', 'xgb_fire_classifier.joblib')
    ]
    for path in candidates:
        if path and os.path.exists(path):
            return path, joblib.load(path)
    raise FileNotFoundError(f'No model artifact found in {MODELS_DIR}. Run src/training/train.py first.')


def predict_sample(sample_dict: dict):
    path, bundle = load_trained_model()
    missing = missing_required(sample_dict)
    if missing:
        raise ValueError(f'Required features unresolved: {missing}')
    df = to_model_frame(pd.DataFrame([sample_dict]), bundle['features'])
    probabilities = bundle['model'].predict_proba(df)[0]
    predicted_idx = int(np.argmax(probabilities))
    return {
        'artifact': os.path.basename(path),
        'model_version': bundle.get('version'),
        'predicted_class': bundle['classes'][predicted_idx],
        'confidence': round(float(probabilities[predicted_idx]), 4),
        'class_probabilities': {c: round(float(p), 4) for c, p in zip(bundle['classes'], probabilities)},
    }


if __name__ == '__main__':
    # A night-time VIIRS detection 350 m from a mapped refinery with a long local history.
    sample = {
        'frp': 18.4,
        'brightness': 341.2,
        'brightness_ti5': 301.7,
        'temp_delta_ti4_ti5': 39.5,
        'confidence': 0.75,
        'is_night': 1,
        'facility_distance_m': 350,
        'facility_type_encoded': 1,
        'landcover_encoded': 0,
        'nearby_cluster_count_3km': 6,
        'historical_recurrence_1_5km': 50,
        'historical_mean_frp': 15.2,
        'frp_z_score': 0.3,
        'days_since_last_detection': 0.4,
    }
    try:
        print(json.dumps(predict_sample(sample), indent=2))
    except Exception as e:  # noqa: BLE001
        print(f'Smoke check failed: {e}', file=sys.stderr)
        sys.exit(1)
