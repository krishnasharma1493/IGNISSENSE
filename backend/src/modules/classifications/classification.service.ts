import { Hotspot, IHotspot } from '../hotspots/hotspot.model';
import { Classification, IClassification, ClassificationClass } from './classification.model';
import { Alert } from '../alerts/alert.model';
import { extractFeaturesForHotspot, ExtractedFeatures, toCanonicalFeatureRecord } from './feature.extractor';
import { REQUIRED_FEATURES, FEATURE_VERSION } from './featureContract';
import type { PipelineStatus } from './classification.model';


/**
 * Model Metadata & Version Provenance
 */
export const CURRENT_MODEL_METADATA = {
  // Fallback label only. A live model reports its own version via /predict and
  // /health, and that is what gets stored; this string is used for rows that
  // never reached the model (feature-gated or service unreachable).
  version: 'XGB-FIRMS-v2.0.0-INDIA-SP2023',
  type: 'XGBoost Multi-Class Classifier + Spatiotemporal Anomaly Engine',
  features: [
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
  ],
  // Labels come from sources that are not model inputs: NASA FIRMS `type`, EOG
  // VIIRS Nightfire flare sites, Maus et al. (2022) mining polygons and ESA
  // WorldCover 2021. Features were computed by this module's own extractor over
  // the archive. Provenance, metrics and limitations: ml/models/model_metadata.json.
  trainedOn:
    'NASA FIRMS standard-processing detections over India (VIIRS S-NPP, NOAA-20, MODIS); ' +
    'train/val 2023, test 2024 in held-out 0.5° spatial blocks.',
  calibratedAt: '2026-09-14T00:00:00Z',
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
): number | null {
  // FRP magnitude is a required input here. With no measured FRP there is
  // nothing to score, and picking a floor would put a fabricated number into
  // the panel and into the alert rule. The score is simply not computed.
  if (features.frp === null) return null;

  // A null z-score means no prior detection exists at this coordinate. That is
  // a real observation rather than a missing measurement: with no baseline
  // there is no deviation from one, so the deviation term contributes nothing.
  // 1. FRP baseline deviation
  const zScore = Math.max(0, features.frpZScore ?? 0);
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

export interface InferenceOutcome {
  predictedClass: ClassificationClass | null;
  confidence: number | null;
  classProbabilities: Record<ClassificationClass, number> | null;
  modelVersion: string;
  isModelLive: boolean;
}

/**
 * Grounded ML Inference Pipeline
 * Calls the trained XGBoost model microservice directly with the canonical feature vector.
 *
 * Takes the already-computed canonical values rather than recomputing them from
 * ExtractedFeatures — the caller (classifyHotspot) gates on feature completeness
 * before this is invoked, so it must have already produced the canonical record.
 *
 * When the service cannot be reached there is no prediction to report. The
 * previous fallback returned `other_or_uncertain` at 0.50 with a full
 * probability vector, which is a verdict the model never issued: the row was
 * then stored as `classified`, counted in the class distribution, drawn on the
 * map with a class colour, and could raise an "[AI CANDIDATE]" alert. Absence
 * of inference is now reported as absence, exactly as an unresolvable feature is.
 */
async function runModelInference(
  canonicalFeatures: Record<string, number>
): Promise<InferenceOutcome> {
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
    console.warn('[ML Inference] Model service returned an unusable payload. Recording no prediction.');
  } catch (err: any) {
    console.warn(`[ML Inference] Model service unreachable (${err.message}). Recording no prediction.`);
  }

  return {
    predictedClass: null,
    confidence: null,
    classProbabilities: null,
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
  topClass: ClassificationClass | null,
  persistenceScore: number,
  anomalyScore: number | null
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

  // 2. Thermal Radiative Power & Sensor Telemetry.
  // A band the sensor did not report is stated as unavailable. Printing a
  // default as though it were observed is what this branch exists to stop.
  const frpText = features.frp !== null ? `${features.frp.toFixed(1)} MW` : 'not reported';
  const brightnessText =
    features.brightness !== null ? `${features.brightness.toFixed(1)} K` : 'not reported';
  bullets.push(
    `Observed FRP: ${frpText} · Brightness: ${brightnessText} (${features.dayNight === 'N' ? 'Night Pass' : 'Day Pass'}) by ${features.instrument} ${features.satellite}`
  );

  // 3. Historical Baseline & Recurrence
  if (features.historicalOverpassesWithin1_5km > 0) {
    const baselineText =
      features.historicalMeanFrp !== null
        ? ` (Baseline FRP: ${features.historicalMeanFrp.toFixed(1)} MW)`
        : '';
    bullets.push(
      `Historical activity: ${features.historicalOverpassesWithin1_5km} prior overpasses recorded within 1.5 km${baselineText}`
    );
    if (features.frpZScore !== null && features.frpZScore > 1.0) {
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

  // 3. Gate on feature completeness before spending an inference call.
  const canonical = toCanonicalFeatureRecord(features);
  const ratio =
    (REQUIRED_FEATURES.length - canonical.unresolved.length) / REQUIRED_FEATURES.length;

  const completeness = {
    required: [...REQUIRED_FEATURES],
    unresolved: canonical.unresolved,
    completenessRatio: Number(ratio.toFixed(3)),
  };

  let inference: InferenceOutcome;
  let pipelineStatus: PipelineStatus;

  if (canonical.unresolved.length > 0) {
    // No OSM coverage here. Saying "uncertain" would imply the model looked and
    // was unsure; it never ran.
    pipelineStatus = 'unclassified_insufficient_features';
    inference = {
      predictedClass: null,
      confidence: null,
      classProbabilities: null,
      modelVersion: CURRENT_MODEL_METADATA.version,
      isModelLive: false,
    };
  } else {
    inference = await runModelInference(canonical.values as Record<string, number>);
    // The features were complete and the call was made, so this row is not
    // gated for want of inputs — the inference service simply did not answer.
    // The two are distinct failures and are recorded distinctly.
    pipelineStatus = inference.isModelLive ? 'classified' : 'unclassified_model_unavailable';
  }

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
      pipelineStatus,
      featureVersion: FEATURE_VERSION,
      predictedAt: new Date(),
      featureCompleteness: completeness,
    },
    { upsert: true, returnDocument: 'after' }
  );


  // 6. Deterministic Alert Generation: Anomaly Score >= 0.65 AND within 1.5 km of OSM Industrial Facility
  // An unclassified detection never raises an alert — there is no classified
  // signature to assert. That covers both the feature gate and an unreachable
  // inference service; neither produced a class to name in the alert text.
  if (
    pipelineStatus === 'classified' &&
    anomalyScore !== null &&
    anomalyScore >= 0.65 &&
    features.facilityDistanceMeters !== null &&
    features.facilityDistanceMeters <= 1500
  ) {
    const severity = anomalyScore >= 0.80 ? 'critical' : anomalyScore >= 0.65 ? 'high' : 'medium';
    // `classified` guarantees a non-null class; the fallback keeps the type honest.
    const predictedClassLabel = (inference.predictedClass ?? 'other_or_uncertain').replace(/_/g, ' ');
    const frpClause =
      features.frp !== null ? ` FRP: ${features.frp.toFixed(1)} MW.` : ' FRP not reported.';
    const reason = `[AI CANDIDATE] High anomaly (${anomalyScore.toFixed(2)}) ${predictedClassLabel} signature within ${features.facilityDistanceMeters}m of ${features.nearestFacility?.name || 'industrial facility'}.${frpClause}`;

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


