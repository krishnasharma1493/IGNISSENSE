#!/usr/bin/env python3
"""
SIH 2026 — Problem Statement 26162
Production XGBoost Model Inference Service

Zero-dependency HTTP server (standard library http.server) serving
real-time multi-class thermal predictions directly from the trained
model artifact (xgb_fire_classifier_v1.joblib).
"""

import os
import sys
import json
import logging
from http.server import HTTPServer, BaseHTTPRequestHandler
import joblib
import numpy as np
import pandas as pd

# Features the backend must have resolved before we run inference. A null (or
# absent) value here means the backend could not measure/derive the feature —
# coercing it to a placeholder would silently reintroduce the substitution bug
# the backend was changed to remove, so we reject the request instead.
REQUIRED = [
    "frp", "brightness", "brightness_ti5", "temp_delta_ti4_ti5", "confidence",
    "is_night", "facility_distance_m", "facility_type_encoded",
    "landcover_encoded", "nearby_cluster_count_3km",
]

logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] [%(levelname)s] %(message)s',
    datefmt='%H:%M:%S',
)
logger = logging.getLogger('InferenceService')

# Path to trained model bundle
MODEL_PATH = os.path.join(
    os.path.dirname(__file__), '..', '..', 'models', 'xgb_fire_classifier_v1.joblib'
)

if not os.path.exists(MODEL_PATH):
    # Fallback to general model path
    MODEL_PATH = os.path.join(
        os.path.dirname(__file__), '..', '..', 'models', 'xgb_fire_classifier.joblib'
    )

logger.info(f"Loading production model artifact from: {MODEL_PATH}")
bundle = joblib.load(MODEL_PATH)
model = bundle['model']
feature_names = bundle['features']
classes = bundle['classes']
model_version = bundle.get('version', 'XGB-FIRMS-v1.0.0-DELHI_NCR')
logger.info(f"Loaded {model_version} with {len(feature_names)} features and {len(classes)} classes.")


class InferenceHandler(BaseHTTPRequestHandler):
    def _set_headers(self, status=200, content_type='application/json'):
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_OPTIONS(self):
        self._set_headers(200)

    def do_GET(self):
        if self.path in ('/', '/health', '/api/v1/health'):
            self._set_headers(200)
            res = {
                'status': 'ok',
                'service': 'IGNISSENSE ML Inference Engine',
                'model_version': model_version,
                'framework': 'XGBoost 3.4.1',
                'features': feature_names,
                'classes': classes,
            }
            self.wfile.write(json.dumps(res).encode('utf-8'))
        else:
            self._set_headers(404)
            self.wfile.write(b'{"error": "Endpoint not found"}')

    def do_POST(self):
        if self.path == '/predict' or self.path == '/api/v1/predict':
            content_length = int(self.headers.get('Content-Length', 0))
            if content_length == 0:
                self._set_headers(400)
                self.wfile.write(b'{"error": "Empty payload"}')
                return

            body = self.rfile.read(content_length).decode('utf-8')
            try:
                data = json.loads(body)
            except Exception as e:
                self._set_headers(400)
                self.wfile.write(json.dumps({'error': f'Invalid JSON: {str(e)}'}).encode('utf-8'))
                return

            # Support single record or batch
            raw_items = data.get('records') or data.get('features')
            is_single = False

            if isinstance(raw_items, dict):
                is_single = True
                raw_items = [raw_items]
            elif isinstance(data, dict) and 'frp' in data:
                is_single = True
                raw_items = [data]
            elif not isinstance(raw_items, list):
                self._set_headers(400)
                self.wfile.write(b'{"error": "Expected features object or records array"}')
                return

            # Validate completeness of every record in the (now-normalised) batch
            # before any of it reaches pandas/XGBoost. A record is incomplete if a
            # required feature is missing entirely or explicitly null.
            offending = []
            for idx, item in enumerate(raw_items):
                if not isinstance(item, dict):
                    continue
                missing = [k for k in REQUIRED if item.get(k) is None]
                if missing:
                    offending.append((idx, missing))

            if offending:
                detail = "; ".join(
                    f"record {idx}: {', '.join(missing)}" for idx, missing in offending
                )
                self._set_headers(422)
                self.wfile.write(json.dumps({
                    'success': False,
                    'error': {
                        'code': 'INCOMPLETE_FEATURES',
                        'message': f"Required features unresolved: {detail}",
                    },
                }).encode('utf-8'))
                return

            try:
                # Prepare DataFrame strictly conforming to canonical feature columns.
                # REQUIRED features are already guaranteed non-null by the check above,
                # so this fill only ever applies to OPTIONAL (historical) features that
                # are legitimately absent/null (e.g. a first-ever detection at a
                # coordinate has no history) — it does not mask the validation.
                df = pd.DataFrame(raw_items)
                for col in feature_names:
                    if col not in df.columns:
                        df[col] = 0.0
                    else:
                        df[col] = pd.to_numeric(df[col], errors='coerce').fillna(0.0)

                df = df[feature_names]

                # Run XGBoost inference
                probabilities = model.predict_proba(df)
                predictions = []

                for row_prob in probabilities:
                    pred_idx = int(np.argmax(row_prob))
                    confidence = float(row_prob[pred_idx])
                    pred_class = classes[pred_idx]

                    class_probs = {
                        cls: round(float(row_prob[i]), 4) for i, cls in enumerate(classes)
                    }

                    predictions.append({
                        'predicted_class': pred_class,
                        'confidence': round(confidence, 4),
                        'class_probabilities': class_probs,
                        'model_version': model_version,
                    })

                self._set_headers(200)
                if is_single:
                    response_payload = {'success': True, 'data': predictions[0]}
                else:
                    response_payload = {'success': True, 'data': predictions}

                self.wfile.write(json.dumps(response_payload).encode('utf-8'))

            except Exception as e:
                logger.error(f"Inference error: {str(e)}")
                self._set_headers(500)
                self.wfile.write(json.dumps({'error': f'Inference failed: {str(e)}'}).encode('utf-8'))

        else:
            self._set_headers(404)
            self.wfile.write(b'{"error": "Endpoint not found"}')

    def log_message(self, format, *args):
        # Concise logging
        logger.info(f"{self.address_string()} - {format % args}")


def run_service(port: int = 8000):
    server_address = ('', port)
    httpd = HTTPServer(server_address, InferenceHandler)
    logger.info(f"🚀 IGNISSENSE Production ML Inference Service listening on http://localhost:{port}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        logger.info("Shutting down inference service...")
        httpd.server_close()


if __name__ == '__main__':
    port = 8000
    if len(sys.argv) > 1:
        port = int(sys.argv[1])
    run_service(port)
