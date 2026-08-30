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

export interface IClassification extends Document {
  hotspotId: Types.ObjectId;
  predictedClass: ClassificationClass;
  confidence: number;
  classProbabilities: Record<ClassificationClass, number>;
  persistenceScore: number;
  anomalyScore: number;
  nearestFacilityId: Types.ObjectId | null;
  facilityDistanceMeters: number | null;
  landCover: string; // 'forest', 'cropland', 'built_up', 'bare', 'water', 'other'
  explanation: string[];
  modelVersion: string;
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
      required: true,
      enum: CLASSIFICATION_CLASSES,
    },
    confidence: {
      type: Number,
      required: true,
      min: 0,
      max: 1,
    },
    classProbabilities: {
      type: Schema.Types.Mixed,
      required: true,
    },
    persistenceScore: {
      type: Number,
      required: true,
      min: 0,
      max: 1,
    },
    anomalyScore: {
      type: Number,
      required: true,
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
