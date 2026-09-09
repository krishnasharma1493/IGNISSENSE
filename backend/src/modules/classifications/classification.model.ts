import mongoose, { Schema, Document, Types } from 'mongoose';

/**
 * Classification Document
 *
 * Stores the ML classification result for a hotspot.
 * The model is the source of classification truth.
 */

export const CLASSIFICATION_CLASSES = [
  'industrial_fire',
  'gas_flare',
  'wildfire',
  'agricultural_burning',
  'mining_thermal_activity',
  'other_or_uncertain',
] as const;

export type ClassificationClass = typeof CLASSIFICATION_CLASSES[number];

/**
 * Outcome of a classification attempt.
 *
 * - `classified` — every required feature resolved and the model answered.
 * - `unclassified_insufficient_features` — a required feature could not be
 *   measured (typically no OSM coverage), so no call was made.
 * - `unclassified_model_unavailable` — the features were complete, the call was
 *   made, and the inference service did not answer. No prediction exists.
 *
 * Only `classified` rows carry a prediction. The other two exist so that a
 * missing verdict is never displayed, counted, or alerted on as if it were one.
 */
export const PIPELINE_STATUSES = [
  'classified',
  'unclassified_insufficient_features',
  'unclassified_model_unavailable',
] as const;

export type PipelineStatus = typeof PIPELINE_STATUSES[number];

/** Statuses in which no inference result exists. */
export const UNCLASSIFIED_STATUSES = PIPELINE_STATUSES.filter(
  (s): s is Exclude<PipelineStatus, 'classified'> => s !== 'classified'
);

export interface IClassification extends Document {
  hotspotId: Types.ObjectId;
  predictedClass: ClassificationClass | null;
  confidence: number | null;
  classProbabilities: Record<ClassificationClass, number> | null;
  persistenceScore: number;
  /** Null when FRP was not reported: the heuristic has no input to score. */
  anomalyScore: number | null;
  nearestFacilityId: Types.ObjectId | null;
  facilityDistanceMeters: number | null;
  landCover: string; // 'forest', 'cropland', 'built_up', 'bare', 'water', 'other'
  explanation: string[];
  modelVersion: string;
  pipelineStatus: PipelineStatus;
  featureVersion: string;
  predictedAt: Date;
  featureCompleteness: {
    required: string[];
    unresolved: string[];
    completenessRatio: number;
  };
  createdAt: Date;
}

const classificationSchema = new Schema<IClassification>(
  {
    hotspotId: {
      type: Schema.Types.ObjectId,
      ref: 'Hotspot',
      required: true,
    },
    predictedClass: {
      type: String,
      required: false,
      enum: CLASSIFICATION_CLASSES,
      default: null,
    },
    confidence: {
      type: Number,
      required: false,
      min: 0,
      max: 1,
      default: null,
    },
    classProbabilities: {
      type: Schema.Types.Mixed,
      required: false,
      default: null,
    },
    persistenceScore: {
      type: Number,
      required: true,
      min: 0,
      max: 1,
    },
    anomalyScore: {
      type: Number,
      required: false,
      default: null,
      min: 0,
      max: 1,
    },
    nearestFacilityId: {
      type: Schema.Types.ObjectId,
      ref: 'Facility',
      default: null,
    },
    facilityDistanceMeters: {
      type: Number,
      default: null,
    },
    landCover: {
      type: String,
      enum: ['forest', 'cropland', 'built_up', 'bare', 'water', 'other'],
      default: 'other',
    },
    explanation: {
      type: [String],
      default: [],
    },
    modelVersion: {
      type: String,
      required: true,
    },
    pipelineStatus: {
      type: String,
      required: true,
      enum: [...PIPELINE_STATUSES],
      default: 'classified',
    },
    featureVersion: { type: String, required: true },
    predictedAt: { type: Date, required: true, default: Date.now },
    featureCompleteness: {
      required: { type: [String], default: [] },
      unresolved: { type: [String], default: [] },
      completenessRatio: { type: Number, default: 1 },
    },
  },
  {
    timestamps: true,
  }
);

classificationSchema.index({ hotspotId: 1 });
classificationSchema.index({ predictedClass: 1 });
classificationSchema.index({ confidence: -1 });

export const Classification = mongoose.model<IClassification>(
  'Classification',
  classificationSchema
);
