import mongoose, { Schema, Document } from 'mongoose';

export interface IGeocodeCache extends Document {
  key: string;
  latitude: number;
  longitude: number;
  locality: string | null;
  city: string | null;
  district: string | null;
  state: string | null;
  country: string | null;
  displayName: string | null;
  fetchedAt: Date;
}

const schema = new Schema<IGeocodeCache>({
  key: { type: String, required: true, unique: true },
  latitude: { type: Number, required: true },
  longitude: { type: Number, required: true },
  locality: { type: String, default: null },
  city: { type: String, default: null },
  district: { type: String, default: null },
  state: { type: String, default: null },
  country: { type: String, default: null },
  displayName: { type: String, default: null },
  fetchedAt: { type: Date, default: Date.now },
});

// Expire after 90 days; administrative naming changes slowly but does change.
schema.index({ fetchedAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

export const GeocodeCache = mongoose.model<IGeocodeCache>('GeocodeCache', schema);
