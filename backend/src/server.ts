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

    // Run first sync 5 seconds after boot, then every 5 minutes.
    // Before the first sync, recover any FIRMS polls silently skipped by a
    // restart mid-cycle. A catch-up failure must never prevent the regular
    // interval from starting, and since this runs inside a setTimeout
    // callback, a rejection here would NOT be caught by the outer try/catch
    // (that block has already returned by the time this fires) — so it is
    // caught locally instead.
    setTimeout(async () => {
      try {
        const { runCatchupIfNeeded } = await import('./modules/ingestion/catchup.service');
        await runCatchupIfNeeded();
      } catch (err: any) {
        console.error('[Catchup] Failed to recover skipped polls:', err.message);
      } finally {
        setInterval(runLiveSyncLoop, 5 * 60 * 1000);
      }
    }, 5000);
  } catch (err: any) {
    console.error('[DB] Initial background connection error:', err.message);
    process.exit(1);
  }
}

startServer();

