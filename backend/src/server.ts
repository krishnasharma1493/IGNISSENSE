import app from './app';
import { config } from './config';
import { connectDatabase } from './config/database';
import { ingestFirmsDelhiNcr, ingestFirmsIndia } from './modules/ingestion/ingestion.service';

async function startServer() {
  // Start Express immediately
  app.listen(config.port, () => {
    console.log(`[Server] SIH 26162 backend running on port ${config.port}`);
    console.log(`[Server] Environment: ${config.env}`);
    console.log(`[Server] Health: http://localhost:${config.port}/api/v1/health`);
  });

  // Connect to MongoDB with retry
  try {
    await connectDatabase();

    // Schedule automated periodic NASA FIRMS ingestion + ML classification loop
    console.log('[Scheduler] Initializing NASA FIRMS Real-Time Ingestion & ML Classifier Loop...');

    const runLiveSyncLoop = async () => {
      try {
        console.log('[Live NASA FIRMS] Checking for latest satellite passes (VIIRS/MODIS)...');
        const syncResult = await ingestFirmsIndia({ dayRange: 2 });
        console.log(
          `[Live NASA FIRMS + ML] Synced & Classified: ${syncResult.totalStored} new fire records, ${syncResult.totalDuplicates} existing.`
        );
      } catch (err: any) {
        console.warn('[Live NASA FIRMS] Periodic sync notice:', err.message);
      }
    };

    // Run first sync 5 seconds after boot, then every 5 minutes
    setTimeout(runLiveSyncLoop, 5000);
    setInterval(runLiveSyncLoop, 5 * 60 * 1000);
  } catch (err: any) {
    console.error('[DB] Initial background connection error:', err.message);
    process.exit(1);
  }
}

startServer();

