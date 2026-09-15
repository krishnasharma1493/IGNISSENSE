"""
The single definition of how a canonical feature record becomes model input.

Both the inference service and the training script call `to_model_frame`, so the
null handling the model is trained on is, by construction, the null handling it
is served with. Any change here changes training and serving together.
"""

import pandas as pd

# Features the backend must have resolved before inference. Mirrors
# REQUIRED_FEATURES in backend/src/modules/classifications/featureContract.ts.
REQUIRED = [
    "frp", "brightness", "brightness_ti5", "temp_delta_ti4_ti5", "confidence",
    "is_night", "facility_distance_m", "facility_type_encoded",
    "landcover_encoded", "nearby_cluster_count_3km",
]

# Passed to XGBoost as NaN rather than filled. Zero would mean "last detected
# today", the opposite of "never detected before", which is what a null means for
# a first-ever detection. XGBoost learns a default split direction for NaN, and
# the real training data contains these nulls, so that direction is learned.
NAN_PASSTHROUGH = {"days_since_last_detection"}


def missing_required(record: dict) -> list:
    return [k for k in REQUIRED if record.get(k) is None]


def to_model_frame(df: pd.DataFrame, feature_names: list) -> pd.DataFrame:
    """Coerce to numeric and apply the optional-feature null policy, in model column order.

    REQUIRED features are validated non-null before this is called at serving time,
    so the zero fill below only ever applies to OPTIONAL historical features that are
    legitimately absent (historical_mean_frp and frp_z_score are null exactly when a
    coordinate has no prior detection, which historical_recurrence_1_5km == 0 also
    encodes).
    """
    out = pd.DataFrame(index=df.index)
    for col in feature_names:
        if col not in df.columns:
            out[col] = 0.0
        elif col in NAN_PASSTHROUGH:
            out[col] = pd.to_numeric(df[col], errors='coerce')
        else:
            out[col] = pd.to_numeric(df[col], errors='coerce').fillna(0.0)
    return out[feature_names]
