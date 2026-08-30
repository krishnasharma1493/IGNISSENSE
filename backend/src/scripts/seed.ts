/**
 * Real Data Pipeline Ingestion & Orchestration Script
 *
 * SIH 2026 — Problem Statement 26162
 *
 * PROVENANCE & REAL DATA PIPELINE:
 * 1. Queries OpenStreetMap Overpass API for authentic Delhi NCR industrial infrastructure.
 * 2. Queries NASA FIRMS API for authentic multi-sensor active fire satellite observations.
 * 3. Runs Feature Extractor layer (spatial distance to OSM, thermal delta, temporal history).
 * 4. Computes genuine Persistence ($S_{persist}$) from spatiotemporal clustering.
 * 5. Computes genuine Anomaly ($S_{anomaly}$) from statistical FRP Z-scores.
 * 6. Executes grounded ML classification pipeline.
 * 7. Derives operational alert candidates from verified high-anomaly industrial events.
 *
 * ZERO synthetic hotspots, ZERO synthetic facilities, ZERO fake records.
 */

import { connectDatabase, disconnectDatabase } from '../config/database';
import { syncDelhiNcrOsmFacilities } from '../modules/facilities/facility.service';
import { ingestFirmsDelhiNcr, ingestFirmsIndia } from '../modules/ingestion/ingestion.service';
import { reclassifyAllHotspots } from '../modules/classifications/classification.service';
import { Hotspot } from '../modules/hotspots/hotspot.model';
import { Facility } from '../modules/facilities/facility.model';
import { Classification } from '../modules/classifications/classification.model';
import { Alert } from '../modules/alerts/alert.model';
import { IngestionLog } from '../modules/ingestion/ingestion.model';

async function main() {
  console.log('====================================================');
  console.log('🚀 SIH 26162 — Real Data Pipeline Execution (Delhi NCR)');
  console.log('====================================================\n');

  console.log('[1/5] Connecting to MongoDB Atlas...');
  await connectDatabase();

  // 1. Ingest real OpenStreetMap facilities
  console.log('\n[2/5] Ingesting authentic OpenStreetMap industrial facilities for Delhi NCR...');
  const osmResult = await syncDelhiNcrOsmFacilities();
  console.log(`  ✓ OpenStreetMap Facilities Ingested: ${osmResult.totalStored}`);

  // 2. Ingest real NASA FIRMS multi-sensor thermal observations
  console.log('\n[3/5] Ingesting authentic NASA FIRMS satellite observations for Delhi NCR (5-day window)...');
  const firmsDelhiResult = await ingestFirmsDelhiNcr({ dayRange: 5 });
  console.log(`  ✓ Delhi NCR Real Satellite Detections: ${firmsDelhiResult.totalStored} stored, ${firmsDelhiResult.totalDuplicates} existing`);

  console.log('\n[4/5] Ingesting parent India satellite observations (2-day window)...');
  const firmsIndiaResult = await ingestFirmsIndia({ dayRange: 2 });
  console.log(`  ✓ Pan-India Real Satellite Detections: ${firmsIndiaResult.totalStored} stored, ${firmsIndiaResult.totalDuplicates} existing`);

  // 3. Re-run feature extraction and ML classification on all stored records
  console.log('\n[5/5] Executing genuine feature extraction & ML classification pipeline...');
  await reclassifyAllHotspots();

  // Final summary
  const summary = {
    realHotspotsInDb: await Hotspot.countDocuments(),
    realOsmFacilitiesInDb: await Facility.countDocuments(),
    realClassificationsInDb: await Classification.countDocuments(),
    realDerivedAlertsInDb: await Alert.countDocuments(),
    ingestionLogsCount: await IngestionLog.countDocuments(),
  };

  console.log('\n====================================================');
  console.log('✅ End-to-End Real Data Pipeline Execution Complete!');
  console.log('====================================================');
  console.log(JSON.stringify(summary, null, 2));

  await disconnectDatabase();
}

main().catch((err) => {
  console.error('[Pipeline Error] Fatal error:', err);
  process.exit(1);
});
