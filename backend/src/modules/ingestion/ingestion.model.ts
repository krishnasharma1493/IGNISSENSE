import mongoose, { Schema, Document } from 'mongoose';

/**
 * Ingestion Log Document
 *
 * Verifiable provenance log of every live/historical FIRMS and OSM ingestion run.
 */
export interface IIngestionLog extends Document {
  source: string; // 'NASA_FIRMS', 'OpenStreetMap'
  product: string; // 'VIIRS_NOAA21_NRT', 'VIIRS_NOAA20_NRT', 'VIIRS_SNPP_NRT', 'MODIS_NRT', 'OVERPASS_QL'
  region: string; // 'delhi_ncr', 'india'
  bbox: {
    west: number;
    south: number;
    east: number;
    north: number;
  };
  dayRange: number;
  date?: string;
  recordsReceived: number;
  recordsAccepted: number;
  recordsStored: number;
  recordsRejected: number;
  duplicates: number;
  delhiNcrCount: number;
  retrievedAt: Date;
  durationMs: number;
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED';
  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ingestionLogSchema = new Schema<IIngestionLog>(
  {
    source: {
      type: String,
      required: true,
    },
    product: {
      type: String,
      required: true,
    },
    region: {
      type: String,
      default: 'delhi_ncr',
    },
    bbox: {
      west: { type: Number, required: true },
      south: { type: Number, required: true },
      east: { type: Number, required: true },
      north: { type: Number, required: true },
    },
    dayRange: {
      type: Number,
      default: 2,
    },
    date: {
      type: String,
    },
    recordsReceived: {
      type: Number,
      default: 0,
    },
    recordsAccepted: {
      type: Number,
      default: 0,
    },
    recordsStored: {
      type: Number,
      default: 0,
    },
    recordsRejected: {
      type: Number,
      default: 0,
    },
    duplicates: {
      type: Number,
      default: 0,
    },
    delhiNcrCount: {
      type: Number,
      default: 0,
    },
    retrievedAt: {
      type: Date,
      default: Date.now,
    },
    durationMs: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: ['SUCCESS', 'PARTIAL', 'FAILED'],
      default: 'SUCCESS',
    },
    errorMessage: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

ingestionLogSchema.index({ retrievedAt: -1 });
ingestionLogSchema.index({ source: 1, product: 1 });

export const IngestionLog = mongoose.model<IIngestionLog>('IngestionLog', ingestionLogSchema);
