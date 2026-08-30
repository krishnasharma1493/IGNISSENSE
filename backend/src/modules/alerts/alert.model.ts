import mongoose, { Schema, Document, Types } from 'mongoose';

/**
 * Alert Document
 *
 * High-priority candidate events flagged by the system.
 * These are AI candidates / decision support — NOT confirmed incidents.
 */
export interface IAlert extends Document {
  hotspotId: Types.ObjectId;
  severity: 'low' | 'medium' | 'high' | 'critical';
  reason: string;
  status: 'open' | 'acknowledged' | 'resolved';
  createdAt: Date;
}

const alertSchema = new Schema<IAlert>(
  {
    hotspotId: {
      type: Schema.Types.ObjectId,
      ref: 'Hotspot',
      required: true,
    },
    severity: {
      type: String,
      required: true,
      enum: ['low', 'medium', 'high', 'critical'],
    },
    reason: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      required: true,
      enum: ['open', 'acknowledged', 'resolved'],
      default: 'open',
    },
  },
  {
    timestamps: true,
  }
);

alertSchema.index({ status: 1 });
alertSchema.index({ severity: 1 });
alertSchema.index({ hotspotId: 1 });
alertSchema.index({ createdAt: -1 });

export const Alert = mongoose.model<IAlert>('Alert', alertSchema);
