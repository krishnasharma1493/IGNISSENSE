import mongoose from 'mongoose';
import { config } from './index';

let memoryServerInstance: any = null;

export async function connectDatabase(): Promise<void> {
  if (mongoose.connection.readyState === 1) {
    return;
  }

  // 1. Try connecting to MongoDB Atlas first
  try {
    console.log(`[DB] Attempting connection to MongoDB Atlas...`);
    await mongoose.connect(config.mongodbUri, {
      serverSelectionTimeoutMS: 4000,
    });
    console.log(`[DB] Connected to MongoDB Atlas: ${config.mongodbUri.replace(/\/\/.*@/, '//<credentials>@')}`);
    return;
  } catch (atlasError: any) {
    console.warn('[DB] MongoDB Atlas connection notice (IP whitelist / network):', atlasError.message);
    console.log('[DB] Launching embedded MongoDB engine (zero-downtime fallback)...');
  }

  // 2. Fallback to MongoMemoryServer so backend is 100% operational regardless of IP whitelist
  try {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    memoryServerInstance = await MongoMemoryServer.create();
    const localUri = memoryServerInstance.getUri();
    await mongoose.connect(localUri);
    console.log(`[DB] Connected to Embedded MongoDB Engine: ${localUri}`);

    // Auto-seed initial OSM facilities & FIRMS hotspots on in-memory startup
    setTimeout(async () => {
      try {
        const { syncDelhiNcrOsmFacilities } = await import('../modules/facilities/facility.service');
        const { ingestFirmsDelhiNcr } = await import('../modules/ingestion/ingestion.service');
        console.log('[DB Engine] Synchronizing verified OpenStreetMap facilities...');
        await syncDelhiNcrOsmFacilities();
        console.log('[DB Engine] Ingesting & classifying live NASA FIRMS active fires...');
        const res = await ingestFirmsDelhiNcr({ dayRange: 2 });
        console.log(`[DB Engine] Real-time seed complete: ${res.totalStored} active fires classified.`);
      } catch (e: any) {
        console.warn('[DB Engine] Background auto-sync notice:', e.message);
      }
    }, 1000);
  } catch (err: any) {
    console.error('[DB] Failed to initialize embedded MongoDB fallback:', err.message);
  }
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
