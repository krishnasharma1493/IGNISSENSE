import mongoose, { Schema, Document } from 'mongoose';

/**
 * OsmTile Document
 *
 * Tracks the extraction progress of each geographic tile.
 * Enables resumability: if the extraction is interrupted, completed tiles
 * are skipped on retry. Failed tiles can be selectively re-attempted.
 */
export interface IOsmTile extends Document {
  tileId: string; // 'tile_28.0_77.0' (south-west corner as identifier)
  bbox: {
    south: number;
    west: number;
    north: number;
    east: number;
  };
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  featuresExtracted: number;
  errorMessage?: string;
  attempts: number;
  startedAt?: Date;
  completedAt?: Date;
  durationMs?: number;
  overpassEndpoint?: string; // Which mirror was used
  createdAt: Date;
  updatedAt: Date;
}

const osmTileSchema = new Schema<IOsmTile>(
  {
    tileId: {
      type: String,
      required: true,
      unique: true,
    },
    bbox: {
      south: { type: Number, required: true },
      west: { type: Number, required: true },
      north: { type: Number, required: true },
      east: { type: Number, required: true },
    },
    status: {
      type: String,
      enum: ['pending', 'in_progress', 'completed', 'failed'],
      default: 'pending',
    },
    featuresExtracted: {
      type: Number,
      default: 0,
    },
    errorMessage: String,
    attempts: {
      type: Number,
      default: 0,
    },
    startedAt: Date,
    completedAt: Date,
    durationMs: Number,
    overpassEndpoint: String,
  },
  {
    timestamps: true,
  }
);

osmTileSchema.index({ status: 1 });

export const OsmTile = mongoose.model<IOsmTile>('OsmTile', osmTileSchema);
