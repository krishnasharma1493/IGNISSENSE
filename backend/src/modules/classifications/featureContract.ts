/** Bump when the meaning or membership of the feature vector changes. */
export const FEATURE_VERSION = 'v1.1.0';

/** Highest facility_type_encoded value the currently trained model was fit on. */
export const MODEL_VOCABULARY_MAX_FACILITY_CODE = 8;

/**
 * Facility type codes.
 *
 * The trained model knows codes 0-8 only. Types discovered later in the
 * India-wide OSM taxonomy collapse onto their nearest in-vocabulary parent
 * rather than extending the vocabulary — feeding a tree a code it never saw in
 * training produces undefined behaviour, not a graceful degradation. These
 * types get their own codes when the model is retrained on data containing them.
 */
export const FACILITY_TYPE_MAP: Record<string, number> = {
  none: 0,
  refinery: 1,
  power_plant: 2,
  chemical: 3,
  brick_kiln: 4,
  steel_mill: 5,
  quarry_mining: 6,
  general_industrial: 7,
  warehouse: 8,

  chemical_plant: 3,
  steel_plant: 5,
  thermal_power_station: 2,
  hydroelectric: 2,
  mine: 6,
  coal_mine: 6,
  opencast_mine: 6,
  quarry: 6,
  factory: 7,
  manufacturing: 7,
  works: 7,
  industrial_area: 7,
  industrial: 7,

  // Collapsed to in-vocabulary parents (see docstring above).
  cement_plant: 7,        // was 9
  oil_gas_facility: 1,    // was 10
  lpg_plant: 1,
  pipeline_station: 1,
  oil_terminal: 1,
  gas_flare: 1,
  petroleum_well: 1,      // was 11
  substation: 2,          // was 12
  solar_farm: 2,          // was 13
  wind_farm: 2,
};

export const LANDCOVER_MAP: Record<string, number> = {
  built_up: 0,
  cropland: 1,
  forest: 2,
  bare: 3,
  water: 4,
  other: 5,
};

/**
 * Spatial features. If any of these is unresolved the detection cannot be
 * classified — these are what separate an industrial fire from a crop burn.
 */
export const REQUIRED_FEATURES = [
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
] as const;

/**
 * Historical features. A first-ever detection at a coordinate legitimately has
 * no history; that is a real observation, not missing data, so it is passed as
 * null rather than blocking classification.
 */
export const OPTIONAL_FEATURES = [
  'historical_recurrence_1_5km',
  'historical_mean_frp',
  'frp_z_score',
  'days_since_last_detection',
] as const;
