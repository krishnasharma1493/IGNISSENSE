import mongoose, { Schema, Document } from 'mongoose';

/**
 * Hotspot Document
 *
 * Represents a single FIRMS thermal anomaly detection.
 * Coordinates follow GeoJSON order: [longitude, latitude]
 */
export interface IHotspot extends Document {
  source: string;
  location: {
    type: 'Point';
    coordinates: [number, number]; // [longitude, latitude]
  };
  detectedAt: Date;
  frp: number | null; // Fire Radiative Power (MW)
  brightness: number | null; // Brightness temperature (K)
  brightnessTi5: number | null; // VIIRS band I5 brightness (K)
  confidence: string | number; // VIIRS: 'low'|'nominal'|'high', MODIS: 0-100
  dayNight: string; // 'D' or 'N'
  satellite: string; // e.g. 'N' (Suomi NPP), '1' (NOAA-20)
  instrument: string; // e.g. 'VIIRS', 'MODIS'
  scan: number | null;
  track: number | null;
  version: string | null;
  ingestedAt: Date;
  region: string; // e.g. 'delhi_ncr', 'india'
  rawSource?: Record<string, string>;
}

const hotspotSchema = new Schema<IHotspot>(
  {
    source: {
      type: String,
      required: true,
      default: 'FIRMS',
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
        validate: {
          validator: (coords: number[]) =>
            coords.length === 2 &&
            coords[0] >= -180 && coords[0] <= 180 &&
            coords[1] >= -90 && coords[1] <= 90,
          message: 'Invalid coordinates. Must be [longitude, latitude] within valid ranges.',
        },
      },
    },
    detectedAt: {
      type: Date,
      required: true,
    },
    frp: {
      type: Number,
      default: null,
    },
    brightness: {
      type: Number,
      default: null,
    },
    brightnessTi5: {
      type: Number,
      default: null,
    },
    confidence: {
      type: Schema.Types.Mixed, // string or number depending on sensor
      required: true,
    },
    dayNight: {
      type: String,
      enum: ['D', 'N'],
      required: true,
    },
    satellite: {
      type: String,
      required: true,
    },
    instrument: {
      type: String,
      required: true,
    },
    scan: {
      type: Number,
      default: null,
    },
    track: {
      type: Number,
      default: null,
    },
    version: {
      type: String,
      default: null,
    },
    ingestedAt: {
      type: Date,
      default: Date.now,
    },
    region: {
      type: String,
      default: 'india',
    },
    rawSource: {
      type: Schema.Types.Mixed,
      default: null,
      select: false, // excluded unless explicitly requested
    },
  },
  {
    timestamps: true,
  }
);

// 2dsphere index for geospatial queries
hotspotSchema.index({ location: '2dsphere' });

// Deterministic uniqueness constraint: prevent duplicate FIRMS records
hotspotSchema.index(
  { 'location.coordinates': 1, detectedAt: 1, satellite: 1, instrument: 1 },
  { unique: true }
);

// Supporting indexes
hotspotSchema.index({ detectedAt: -1 });
hotspotSchema.index({ region: 1, detectedAt: -1 });
hotspotSchema.index({ confidence: 1 });
hotspotSchema.index({ ingestedAt: -1 });

export const Hotspot = mongoose.model<IHotspot>('Hotspot', hotspotSchema);

