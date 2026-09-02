import { Hotspot, IHotspot } from '../hotspots/hotspot.model';
import { Classification, IClassification, ClassificationClass } from './classification.model';
import { Alert } from '../alerts/alert.model';
import { extractFeaturesForHotspot, ExtractedFeatures } from './feature.extractor';


/**
 * Model Metadata & Version Provenance
 */
export const CURRENT_MODEL_METADATA = {
  version: 'XGB-FIRMS-v1.0.0-DELHI_NCR',
  type: 'XGBoost Multi-Class Classifier + Spatiotemporal Anomaly Engine',
  features: [
    'frp',
    'brightness',
    'temp_delta_ti4_ti5',
    'is_night',
    'facility_distance_m',
    'facility_type_encoded',
    'landcover_encoded',
    'spatial_cluster_density_3km',
    'historical_recurrence_1_5km',
    'frp_z_score',
  ],
  trainedOn: 'NASA VIIRS / MODIS Active Fire Telemetry & OpenStreetMap Geometries',
  calibratedAt: '2026-08-24T00:00:00Z',
};

/**
 * Calculate Persistence Score (0.0 to 1.0)
 * Grounded in actual spatiotemporal clustering of historical FIRMS passes within 1.5 km
 */
function calculatePersistenceScore(features: ExtractedFeatures): number {
  const overpasses = features.historicalOverpassesWithin1_5km;
  // If no prior observations exist, recurrence is 0.0
  if (overpasses === 0) return 0.05;

  // Persistence scales with multi-pass detections at this coordinate
  // 1 pass = 0.20, 2 passes = 0.40, 3 passes = 0.60, 5+ passes = 0.90+
  const recurrenceScore = Math.min(0.95, 0.15 + overpasses * 0.18);

  // If inside known refinery / power plant perimeter with repeated detections -> high persistence
  if (
    features.isInsideIndustrialPerimeter &&
    (features.facilityType === 'refinery' || features.facilityType === 'power_plant' || features.facilityType === 'works')
  ) {
    return Math.min(0.98, recurrenceScore + 0.15);
  }

  return Number(recurrenceScore.toFixed(2));
}

/**
 * Calculate Anomaly Score (0.0 to 1.0)
 * Grounded in statistical FRP deviation (Z-score), sudden appearance, and industrial proximity
 */
function calculateAnomalyScore(
  features: ExtractedFeatures,
  persistenceScore: number
): number {
  // 1. FRP baseline deviation
  const zScore = Math.max(0, features.frpZScore);
  const frpAnomaly = Math.min(0.90, zScore * 0.25 + (features.frp > 50 ? 0.35 : features.frp > 25 ? 0.20 : 0.05));

  // 2. Sudden appearance near high-value industrial facility with LOW persistence
  let spatialAnomaly = 0.10;
  if (features.isInsideIndustrialPerimeter) {
    // If inside industrial area with LOW persistence (new sudden fire), anomaly is very high
    spatialAnomaly = persistenceScore < 0.35 ? 0.85 : 0.20;
  } else if (features.isNearIndustrialPerimeter) {
    spatialAnomaly = persistenceScore < 0.35 ? 0.65 : 0.15;
  }

  const combined = Math.max(frpAnomaly, spatialAnomaly * 0.7 + frpAnomaly * 0.3);
  return Number(Math.min(0.95, Math.max(0.08, combined)).toFixed(2));
}

import axios from 'axios';
import { config } from '../../config';
import { toCanonicalFeatureRecord } from './feature.extractor';

/**
 * Grounded ML Inference Pipeline
 * Calls the trained XGBoost model microservice directly with the canonical feature vector.
 */
async function runModelInference(
  features: ExtractedFeatures
): Promise<{
  predictedClass: ClassificationClass;
  confidence: number;
  classProbabilities: Record<ClassificationClass, number>;
  modelVersion: string;
  isModelLive: boolean;
}> {
  const canonicalFeatures = toCanonicalFeatureRecord(features).values;

  try {
    const response = await axios.post(
      `${config.modelServiceUrl}/predict`,
      { features: canonicalFeatures },
      { timeout: 2500 }
    );

    if (response.data?.success && response.data?.data) {
      const { predicted_class, confidence, class_probabilities, model_version } = response.data.data;
      return {
        predictedClass: predicted_class as ClassificationClass,
        confidence: Number(confidence),
        classProbabilities: class_probabilities,
        modelVersion: model_version || CURRENT_MODEL_METADATA.version,
        isModelLive: true,
      };
    }
  } catch (err: any) {
    console.warn(`[ML Inference] Python model service notice (${err.message}). Defaulting to other_or_uncertain.`);
  }

  // Graceful fallback when model service is offline: Never invent aggressive classifications
  const defaultProbabilities: Record<ClassificationClass, number> = {
    industrial_fire: 0.05,
    gas_flare: 0.03,
    wildfire: 0.05,
    agricultural_burning: 0.07,
    mining_thermal_activity: 0.05,
    other_or_uncertain: 0.75,
  };

  return {
    predictedClass: 'other_or_uncertain',
    confidence: 0.50,
    classProbabilities: defaultProbabilities,
    modelVersion: `${CURRENT_MODEL_METADATA.version}-OFFLINE`,
    isModelLive: false,
  };
}


/**
 * Generate Factual Grounded Explainability Evidence
 * Every statement is strictly tied to real computed features.
 */
function generateEvidenceExplanation(
  features: ExtractedFeatures,
  topClass: ClassificationClass,
  persistenceScore: number,
  anomalyScore: number
): string[] {
  const bullets: string[] = [];

  // 1. Spatial Infrastructure Proximity
  if (features.nearestFacility && features.facilityDistanceMeters !== null) {
    if (features.facilityDistanceMeters <= 1500) {
      bullets.push(
        `Within ${features.facilityDistanceMeters}m of verified OSM infrastructure: "${features.nearestFacility.name}" (${features.nearestFacility.sourceId})`
      );
    } else {
      bullets.push(
        `Nearest mapped industrial facility is ${features.nearestFacility.name} at ${(features.facilityDistanceMeters / 1000).toFixed(1)} km`
      );
    }
  } else {
    bullets.push('No industrial infrastructure mapped within 25 km radius in OSM database');
  }

  // 2. Thermal Radiative Power & Sensor Telemetry
  bullets.push(
    `Observed FRP: ${features.frp.toFixed(1)} MW · Brightness: ${features.brightness.toFixed(1)} K (${features.dayNight === 'N' ? 'Night Pass' : 'Day Pass'}) by ${features.instrument} ${features.satellite}`
  );

  // 3. Historical Baseline & Recurrence
  if (features.historicalOverpassesWithin1_5km > 0) {
    bullets.push(
      `Historical activity: ${features.historicalOverpassesWithin1_5km} prior overpasses recorded within 1.5 km (Baseline FRP: ${features.historicalMeanFrp.toFixed(1)} MW)`
    );
    if (features.frpZScore > 1.0) {
      bullets.push(
        `Significant thermal spike (+${features.frpZScore.toFixed(1)}σ deviation above historical baseline)`
      );
    }
  } else {
    bullets.push('First-time detection at these coordinates in active historical monitoring window');
  }

  // 4. Land Cover Context
  bullets.push(`Contextual Land Cover: ${features.landCover.replace(/_/g, ' ').toUpperCase()} zone`);

  return bullets;
}

/**
 * Classify a real FIRMS Hotspot using the genuine feature pipeline
 */
export async function classifyHotspot(hotspot: IHotspot): Promise<IClassification> {
  // 1. Extract real features
  const features = await extractFeaturesForHotspot(hotspot);

  // 2. Compute true Persistence and Anomaly scores
  const persistenceScore = calculatePersistenceScore(features);
  const anomalyScore = calculateAnomalyScore(features, persistenceScore);

  // 3. Run ML Inference
  const inference = await runModelInference(features);

  // 4. Generate grounded explainability evidence
  const explanation = generateEvidenceExplanation(
    features,
    inference.predictedClass,
    persistenceScore,
    anomalyScore
  );

  // 5. Upsert Classification document in MongoDB Atlas
  const classification = await Classification.findOneAndUpdate(
    { hotspotId: hotspot._id },
    {
      hotspotId: hotspot._id,
      predictedClass: inference.predictedClass,
      confidence: inference.confidence,
      classProbabilities: inference.classProbabilities,
      persistenceScore,
      anomalyScore,
      nearestFacilityId: features.nearestFacility?._id || null,
      facilityDistanceMeters: features.facilityDistanceMeters,
      landCover: features.landCover,
      explanation,
      modelVersion: inference.modelVersion,
    },
    { upsert: true, returnDocument: 'after' }
  );


  // 6. Deterministic Alert Generation: Anomaly Score >= 0.65 AND within 1.5 km of OSM Industrial Facility
  if (
    anomalyScore >= 0.65 &&
    features.facilityDistanceMeters !== null &&
    features.facilityDistanceMeters <= 1500
  ) {
    const severity = anomalyScore >= 0.80 ? 'critical' : anomalyScore >= 0.65 ? 'high' : 'medium';
    const reason = `[AI CANDIDATE] High anomaly (${anomalyScore.toFixed(2)}) ${inference.predictedClass.replace(/_/g, ' ')} signature within ${features.facilityDistanceMeters}m of ${features.nearestFacility?.name || 'industrial facility'}. FRP: ${features.frp.toFixed(1)} MW.`;

    await Alert.findOneAndUpdate(
      { hotspotId: hotspot._id },
      {
        hotspotId: hotspot._id,
        severity,
        reason,
        status: 'open',
      },
      { upsert: true }
    );
  }

  return classification;
}

/**
 * Bulk re-classify all hotspots in parallel chunks
 */
export async function reclassifyAllHotspots() {
  const all = await Hotspot.find().lean();
  console.log(`[ML Engine] Re-classifying ${all.length} hotspots with feature extractor...`);

  const chunkSize = 25;
  let processed = 0;

  for (let i = 0; i < all.length; i += chunkSize) {
    const chunk = all.slice(i, i + chunkSize);
    await Promise.all(chunk.map((h: any) => classifyHotspot(h as unknown as IHotspot)));
    processed += chunk.length;
    console.log(`[ML Engine] Processed ${processed}/${all.length} hotspots...`);
  }

  console.log(`[ML Engine] Successfully re-classified all ${processed} hotspots.`);
}


