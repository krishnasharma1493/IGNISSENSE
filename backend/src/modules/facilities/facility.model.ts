import mongoose, { Schema, Document } from 'mongoose';

/**
 * Facility Document
 *
 * Represents an authenticated industrial facility ingested from OpenStreetMap Overpass API.
 * Preserves complete provenance: real OSM object IDs, element types, coordinates, tags, and timestamps.
 */
export interface IFacility extends Document {
  source: string; // 'OpenStreetMap'
  sourceId: string; // 'node/12345', 'way/67890'
  sourceType: 'node' | 'way' | 'relation';
  osmId: number;
  name: string;
  facilityType:
    | 'refinery'
    | 'power_plant'
    | 'substation'
    | 'industrial'
    | 'industrial_area'
    | 'mine'
    | 'oil_gas'
    | 'works'
    | 'other';
  location: {
    type: 'Point';
    coordinates: [number, number]; // [longitude, latitude]
  };
  tags: Record<string, string>; // Raw OSM tags
  region: string;
  dataQuality: 'external';
  retrievedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const facilitySchema = new Schema<IFacility>(
  {
    source: {
      type: String,
      required: true,
      default: 'OpenStreetMap',
    },
    sourceId: {
      type: String,
      required: true,
      unique: true,
    },
    sourceType: {
      type: String,
      enum: ['node', 'way', 'relation'],
      default: 'node',
    },
    osmId: {
      type: Number,
      required: true,
    },
    name: {
      type: String,
      default: 'Industrial Facility',
    },
    facilityType: {
      type: String,
      required: true,
      enum: [
        'refinery',
        'power_plant',
        'substation',
        'industrial',
        'industrial_area',
        'mine',
        'oil_gas',
        'works',
        'other',
      ],
    },
    location: {
      type: {
        type: String,
        enum: ['Point'],
        required: true,
      },
      coordinates: {
        type: [Number],
        required: true,
      },
    },
    tags: {
      type: Schema.Types.Mixed,
      default: {},
    },
    region: {
      type: String,
      default: 'delhi_ncr',
    },
    dataQuality: {
      type: String,
      enum: ['external'],
      default: 'external',
    },
    retrievedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// 2dsphere index for spatial proximity queries
facilitySchema.index({ location: '2dsphere' });
facilitySchema.index({ facilityType: 1 });
facilitySchema.index({ region: 1 });

export const Facility = mongoose.model<IFacility>('Facility', facilitySchema);
