"""Canonical class order and encodings shared by labelling, training and the model bundle.

Order is part of the serving contract: the model's probability vector is indexed by
this list, and it matches ml/models/feature_schema.json `classes`.
"""

CLASSES = [
    'industrial_fire',
    'gas_flare',
    'wildfire',
    'agricultural_burning',
    'mining_thermal_activity',
    'other_or_uncertain',
]

CLASS_TO_IDX = {cls: idx for idx, cls in enumerate(CLASSES)}
IDX_TO_CLASS = {idx: cls for idx, cls in enumerate(CLASSES)}

FEATURE_COLUMNS = [
    'frp',
    'brightness',
    'brightness_ti5',
    'temp_delta_ti4_ti5',
    'confidence',
    'is_night',
    'facility_distance_m',
    'facility_type_encoded',
    'landcover_encoded',
    'nearby_cluster_count_3km',
    'historical_recurrence_1_5km',
    'historical_mean_frp',
    'frp_z_score',
    'days_since_last_detection',
]

FACILITY_TYPE_MAP = {
    'none': 0,
    'refinery': 1,
    'power_plant': 2,
    'chemical': 3,
    'brick_kiln': 4,
    'steel_mill': 5,
    'quarry_mining': 6,
    'general_industrial': 7,
    'warehouse': 8,
}

LANDCOVER_MAP = {
    'built_up': 0,
    'cropland': 1,
    'forest': 2,
    'bare': 3,
    'water': 4,
    'other': 5,
}
