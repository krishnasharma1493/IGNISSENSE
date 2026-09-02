import mongoose from 'mongoose';
import { config } from './index';

let memoryServerInstance: any = null;

let databaseMode: 'atlas' | 'ephemeral' = 'atlas';

export function getDatabaseMode() {
  return databaseMode;
}

export async function connectDatabase(): Promise<void> {
  if (mongoose.connection.readyState === 1) return;

  try {
    console.log('[DB] Connecting to MongoDB...');
    await mongoose.connect(config.mongodbUri, { serverSelectionTimeoutMS: 4000 });
    databaseMode = 'atlas';
    console.log('[DB] Connected.');
    return;
  } catch (err: any) {
    if (!config.allowEphemeralDb) {
      console.error(
        `[DB] Connection failed: ${err.message}\n` +
        '[DB] Refusing to start with an ephemeral database. Data served from an\n' +
        '[DB] in-memory store is not live FIRMS data and must not be presented as such.\n' +
        '[DB] Fix MONGODB_URI, or set ALLOW_EPHEMERAL_DB=true to accept a degraded,\n' +
        '[DB] clearly-labelled development mode.'
      );
      throw err;
    }
  }

  const { MongoMemoryServer } = await import('mongodb-memory-server');
  memoryServerInstance = await MongoMemoryServer.create();
  await mongoose.connect(memoryServerInstance.getUri());
  databaseMode = 'ephemeral';
  console.warn('[DB] ⚠ EPHEMERAL MODE — data is not persistent and is not live.');
}

export async function disconnectDatabase(): Promise<void> {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
    console.log('[DB] MongoDB disconnected');
  }
  if (memoryServerInstance) {
    await memoryServerInstance.stop();
  }
}
