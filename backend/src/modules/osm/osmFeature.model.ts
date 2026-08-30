import mongoose, { Schema, Document } from 'mongoose';
import type { FeatureCategory } from './taxonomy';

/**
 * OsmFeature Document
 *
 * Canonical schema for India-wide OSM geospatial context features.
 * Each document represents a single, deduplicated OSM element
 * (node, way, or relation) normalized into our controlled taxonomy.
 *
 * This collection is the primary geospatial context database used by
 * the enrichment service to provide ML features for FIRMS hotspot
 * classification.
 *
 * Provenance: Every feature preserves its original OSM ID, element type,
 * raw tags, and extraction metadata so we can trace how any feature
 * was mapped and classified.
 */
export interface IOsmFeature extends Document {
  osmId: number;
  osmType: 'node' | 'way' | 'relation';
  sourceId: string; // 'node/12345' — dedupe key

  geometry: {
    type: 'Point';
    coordinates: [number, number]; // [longitude, latitude]
  };
  latitude: number;
  longitude: number;

  // Controlled taxonomy classification
  featureCategory: FeatureCategory;
  featureSubcategory: string;

  name: string;
  tags: Record<string, string>; // Raw OSM tags preserved

  // Derived fields from tags (retained for quick access)
  industrialType?: string;
  facilityType?: string;
  landUse?: string;
  naturalType?: string;
  operator?: string;

  source: 'OpenStreetMap';
  tileId: string; // Geographic tile ID for extraction tracking
  region: string; // 'india'

  extractedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const osmFeatureSchema = new Schema<IOsmFeature>(
  {
    osmId: {
      type: Number,
      required: true,
    },
    osmType: {
      type: String,
      enum: ['node', 'way', 'relation'],
      required: true,
    },
    sourceId: {
      type: String,
      required: true,
      unique: true, // Dedupe key: 'way/12345'
    },

    geometry: {
      type: {
        type: String,
        enum: ['Point'],
        required: true,
      },
      coordinates: {
        type: [Number],
        required: true,
        validate: {
          validator: (coords: number[]) =>
            coords.length === 2 &&
            coords[0] >= -180 && coords[0] <= 180 &&
            coords[1] >= -90 && coords[1] <= 90,
          message: 'Invalid coordinates. Must be [longitude, latitude] within valid ranges.',
        },
      },
    },
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },

    featureCategory: {
      type: String,
      required: true,
      enum: [
        'industrial',
        'oil_gas',
        'mining',
        'power',
        'forest',
        'agriculture',
        'urban',
        'water',
        'other',
      ],
    },
    featureSubcategory: {
      type: String,
      required: true,
    },

    name: {
      type: String,
      default: 'OSM Feature',
    },

    tags: {
      type: Schema.Types.Mixed,
      default: {},
    },

    industrialType: String,
    facilityType: String,
    landUse: String,
    naturalType: String,
    operator: String,

    source: {
      type: String,
      default: 'OpenStreetMap',
    },
    tileId: {
      type: String,
      required: true,
    },
    region: {
      type: String,
      default: 'india',
    },

    extractedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// ─── Indexes ─────────────────────────────────────────────────────────────────

// Primary spatial index for $nearSphere and $geoWithin queries
osmFeatureSchema.index({ geometry: '2dsphere' });

// Compound index: spatial + category (most common enrichment query pattern)
osmFeatureSchema.index({ featureCategory: 1, geometry: '2dsphere' });

// Category-only filtering
osmFeatureSchema.index({ featureCategory: 1 });

// Subcategory filtering
osmFeatureSchema.index({ featureSubcategory: 1 });

// Tile tracking (extraction progress)
osmFeatureSchema.index({ tileId: 1 });

// Region filtering
osmFeatureSchema.index({ region: 1 });

export const OsmFeature = mongoose.model<IOsmFeature>('OsmFeature', osmFeatureSchema);
