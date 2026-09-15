import mongoose from 'mongoose';
import { config } from '../../config';

/**
 * Connection helper for the offline training-data scripts.
 *
 * These scripts bulk-load years of FIRMS archive rows and all of India's OSM
 * context, so they must never touch the production database. The URI comes from
 * TRAINING_MONGODB_URI only, must point at this machine, and must differ from
 * MONGODB_URI.
 */
export const DEFAULT_TRAINING_URI = 'mongodb://127.0.0.1:27018/ignissense_training';

export function resolveTrainingUri(): string {
  const uri = process.env.TRAINING_MONGODB_URI || DEFAULT_TRAINING_URI;
  const host = new URL(uri.replace(/^mongodb(\+srv)?:\/\//, 'http://')).hostname;
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
    throw new Error(`TRAINING_MONGODB_URI must be a local mongod, got host "${host}"`);
  }
  if (config.mongodbUri && uri === config.mongodbUri) {
    throw new Error('TRAINING_MONGODB_URI must not be the production MONGODB_URI');
  }
  return uri;
}

export async function connectTrainingDb(): Promise<string> {
  const uri = resolveTrainingUri();
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 4000 });
  return uri;
}

/** Minimal `--flag value` / `--flag` parser for the scripts in this folder. */
export function parseArgs(argv: string[]): Record<string, string | true> {
  const out: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[a.slice(2)] = true;
    else {
      out[a.slice(2)] = next;
      i++;
    }
  }
  return out;
}
