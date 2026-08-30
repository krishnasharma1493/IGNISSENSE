#!/usr/bin/env python3
"""
SIH 2026 — Problem Statement 26162
XGBoost Classifier Inference & Verification Script
"""

import os
import json
import joblib
import numpy as np
import pandas as pd

def load_trained_model():
    model_path = os.path.join(os.path.dirname(__file__), '..', '..', 'models', 'xgb_fire_classifier.joblib')
    if not os.path.exists(model_path):
        raise FileNotFoundError(f"Model file not found at {model_path}. Run train.py first.")
    bundle = joblib.load(model_path)
    return bundle

def predict_sample(sample_dict: dict):
    bundle = load_trained_model()
    model = bundle['model']
    features = bundle['features']
    classes = bundle['classes']

    df = pd.DataFrame([sample_dict])[features]
    probabilities = model.predict_proba(df)[0]
    predicted_idx = np.argmax(probabilities)
    predicted_class = classes[predicted_idx]
    confidence = float(probabilities[predicted_idx])

    return {
        'predicted_class': predicted_class,
        'confidence': round(confidence, 4),
        'class_probabilities': {cls: round(float(prob), 4) for cls, prob in zip(classes, probabilities)},
    }

if __name__ == '__main__':
    print("Testing inference on sample industrial hotspot...")
    # Sample representing a sudden high-FRP fire candidate 80m from a refinery
    sample = {
        'frp': 48.5,
        'brightness': 362.1,
        'brightness_ti5': 324.0,
        'temp_delta_ti4_ti5': 38.1,
        'confidence': 0.94,
        'is_night': 1,
        'facility_distance_m': 80.0,
        'facility_type_encoded': 1, # refinery
        'persistence_score': 0.18,  # sudden new appearance
        'anomaly_score': 0.88,      # high anomaly
        'cluster_density_3km': 2,
        'historical_recurrence': 1,
    }

    result = predict_sample(sample)
    print(json.dumps(result, indent=2))
