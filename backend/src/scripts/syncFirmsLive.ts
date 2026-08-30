/**
 * NASA FIRMS Real-Time Data Ingestion & Classification Script
 *
 * Pulls ACTUAL, UNFABRICATED satellite detections from NASA FIRMS API
 * (VIIRS NOAA-20, NOAA-21, Suomi-NPP, MODIS) for the current active observation window.
 *
 * Runs geospatial enrichment with OpenStreetMap industrial facilities and
 * performs multi-class ML classification for all live hotspots into MongoDB Atlas.
 */

import { connectDatabase, disconnectDatabase } from '../config/database';
import { ingestFirmsIndia, ingestFirmsDelhiNcr } from '../modules/ingestion/ingestion.service';
import { Hotspot } from '../modules/hotspots/hotspot.model';
import { Classification } from '../modules/classifications/classification.model';
import { Alert } from '../modules/alerts/alert.model';
import { Facility } from '../modules/facilities/facility.model';

async function runLiveSync() {
  console.log('====================================================');
  console.log('📡 NASA FIRMS LIVE REAL-TIME INGESTION ENGINE');
  console.log('====================================================\n');

  await connectDatabase();

  console.log('[1/4] Checking existing database state...');
  const initialHotspots = await Hotspot.countDocuments();
  const initialFacilities = await Facility.countDocuments();
  console.log(`Current DB: ${initialHotspots} hotspots, ${initialFacilities} facilities.`);

  console.log('\n[2/4] Pulling LIVE NASA FIRMS satellite data across India (last 2 days)...');
  console.log('Sensors: VIIRS (Suomi-NPP, NOAA-20, NOAA-21) + MODIS (Terra/Aqua)\n');

  const liveResult = await ingestFirmsIndia({ dayRange: 2 });

  console.log('\n[3/4] Live Ingestion & ML Classification Summary:');
  console.log(`  - Total Real NASA Detections Fetched: ${liveResult.totalFetched}`);
  console.log(`  - Total Validated Coordinates:        ${liveResult.totalValid}`);
  console.log(`  - Newly Stored & Classified:          ${liveResult.totalStored}`);
  console.log(`  - Existing/Deduplicated:              ${liveResult.totalDuplicates}`);
  console.log(`  - In Delhi NCR Focus Area:            ${liveResult.delhiNcrCount}`);

  console.log('\n[4/4] Final MongoDB Database Summary:');
  const finalHotspots = await Hotspot.countDocuments();
  const finalClassifications = await Classification.countDocuments();
  const finalAlerts = await Alert.countDocuments({ status: 'open' });
  const delhiCount = await Hotspot.countDocuments({ region: 'delhi_ncr' });
  const indiaCount = await Hotspot.countDocuments({ region: 'india' });

  console.log(`  - Total Real Hotspots:        ${finalHotspots}`);
  console.log(`  - Total ML Classifications:   ${finalClassifications}`);
  console.log(`  - Active Operational Alerts:  ${finalAlerts}`);
  console.log(`  - Delhi NCR Region Hotspots:  ${delhiCount}`);
  console.log(`  - Pan-India Region Hotspots:  ${indiaCount}`);

  console.log('\nSample Live Real-Time Hotspot Classifications:');
  const sampleClassifications = await Classification.find()
    .populate('hotspotId')
    .populate('nearestFacilityId')
    .sort({ createdAt: -1 })
    .limit(5)
    .lean();

  sampleClassifications.forEach((c: any, i) => {
    const h = c.hotspotId;
    if (h) {
      console.log(`\n  [${i + 1}] Class: ${c.predictedClass.toUpperCase()} (Confidence: ${(c.confidence * 100).toFixed(0)}%)`);
      console.log(`      Location: [${h.location.coordinates[0].toFixed(4)}°E, ${h.location.coordinates[1].toFixed(4)}°N]`);
      console.log(`      FRP: ${h.frp || 'N/A'} MW | Satellite: ${h.instrument} (${h.satellite}) | Detected: ${h.detectedAt}`);
      console.log(`      Persistence: ${(c.persistenceScore * 100).toFixed(0)}% | Anomaly: ${(c.anomalyScore * 100).toFixed(0)}%`);
      if (c.nearestFacilityId) {
        console.log(`      Nearest Facility: ${c.nearestFacilityId.name} (${c.facilityDistanceMeters}m)`);
      }
      console.log(`      Evidence: ${c.explanation?.[0] || 'N/A'}`);
    }
  });

  console.log('\n====================================================');
  console.log('✅ Real-time NASA FIRMS data successfully synced & stored in Atlas!');
  console.log('====================================================');

  await disconnectDatabase();
}

runLiveSync().catch((err) => {
  console.error('Fatal error during live sync:', err);
  process.exit(1);
});
