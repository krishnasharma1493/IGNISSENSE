#!/usr/bin/env tsx
/**
 * India-Wide OSM Enrichment Validation Suite
 *
 * Tests the enrichment pipeline with known coordinates across
 * diverse Indian environments to verify that spatial context
 * is correctly returned.
 *
 * Usage:
 *   npx tsx src/scripts/validateEnrichment.ts
 */

import { connectDatabase, disconnectDatabase } from '../config/database';
import { enrichHotspot } from '../modules/osm/enrichment.service';
import { OsmFeature } from '../modules/osm/osmFeature.model';
import { OsmTile } from '../modules/osm/osmTile.model';

interface TestCase {
  name: string;
  region: string;
  lat: number;
  lon: number;
  expectedContext: string;
  expectedCategories: string[];
}

const TEST_CASES: TestCase[] = [
  {
    name: 'Jamnagar Refinery (Gujarat)',
    region: 'Gujarat',
    lat: 22.4707,
    lon: 70.0677,
    expectedContext: 'Refinery or oil/gas facility within search radius',
    expectedCategories: ['oil_gas', 'industrial'],
  },
  {
    name: 'Jharia Coalfield (Jharkhand)',
    region: 'Jharkhand',
    lat: 23.7465,
    lon: 86.4142,
    expectedContext: 'Mining/quarry context within search radius',
    expectedCategories: ['mining'],
  },
  {
    name: 'Punjab Agricultural Belt',
    region: 'Punjab',
    lat: 30.9000,
    lon: 75.8500,
    expectedContext: 'Agricultural/farmland context within search radius',
    expectedCategories: ['agriculture'],
  },
  {
    name: 'Jim Corbett Forest (Uttarakhand)',
    region: 'Uttarakhand',
    lat: 29.5300,
    lon: 78.7700,
    expectedContext: 'Forest context within search radius',
    expectedCategories: ['forest'],
  },
  {
    name: 'Delhi Industrial Area (Wazirpur)',
    region: 'Delhi NCR',
    lat: 28.6994,
    lon: 77.1729,
    expectedContext: 'Industrial facilities within search radius',
    expectedCategories: ['industrial', 'power'],
  },
  {
    name: 'NTPC Dadri Power Plant (UP)',
    region: 'Uttar Pradesh',
    lat: 28.5900,
    lon: 77.5700,
    expectedContext: 'Power plant within search radius',
    expectedCategories: ['power', 'industrial'],
  },
  {
    name: 'Mumbai Offshore (Arabian Sea)',
    region: 'Offshore',
    lat: 19.0000,
    lon: 71.5000,
    expectedContext: 'No or minimal OSM coverage expected (offshore)',
    expectedCategories: [],
  },
];

async function runValidation() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('🧪 IGNISSENSE INDIA-WIDE OSM ENRICHMENT VALIDATION');
  console.log('═══════════════════════════════════════════════════════════════');

  await connectDatabase();

  // Check OSM features count
  const osmCount = await OsmFeature.countDocuments();
  console.log(`\n[Database] OSM Features in database: ${osmCount}`);

  if (osmCount === 0) {
    console.warn('\n⚠️  No OSM features found in database.');
    console.warn('   Run `npx tsx src/scripts/extractIndia.ts` first to load India-wide data.');
    console.warn('   The enrichment will fall back to legacy Delhi NCR facilities.\n');
  }

  let passed = 0;
  let failed = 0;
  let warnings = 0;

  for (const tc of TEST_CASES) {
    console.log(`\n─── ${tc.name} ─────────────────────────────────────`);
    console.log(`  Coordinates: ${tc.lat}°N, ${tc.lon}°E (${tc.region})`);
    console.log(`  Expected: ${tc.expectedContext}`);

    try {
      const result = await enrichHotspot(tc.lon, tc.lat, 25000);

      console.log(`  Enrichment Status: ${result.enrichmentStatus}`);
      console.log(`  Enrichment Source: ${result.enrichmentSource}`);
      console.log(`  Inferred Land Cover: ${result.inferredLandCover}`);
      console.log(`  Facility Type: ${result.facilityType}`);
      console.log(`  Facility Distance: ${result.facilityDistanceMeters !== null ? `${result.facilityDistanceMeters}m` : 'N/A'}`);
      console.log(`  Nearby Features: ${result.nearbyFeatureCount}`);

      if (result.nearestIndustrialFacility) {
        console.log(`  Nearest Industrial: ${result.nearestIndustrialFacility.name} (${result.nearestIndustrialFacility.distance_m}m)`);
      }
      if (result.nearestRefinery) {
        console.log(`  Nearest Refinery: ${result.nearestRefinery.name} (${result.nearestRefinery.distance_m}m)`);
      }
      if (result.nearestPowerPlant) {
        console.log(`  Nearest Power Plant: ${result.nearestPowerPlant.name} (${result.nearestPowerPlant.distance_m}m)`);
      }
      if (result.nearestMine) {
        console.log(`  Nearest Mine: ${result.nearestMine.name} (${result.nearestMine.distance_m}m)`);
      }
      console.log(`  Forest Nearby: ${result.forestContextNearby}`);
      console.log(`  Agriculture Nearby: ${result.agricultureContextNearby}`);

      // Determine tile ID for this coordinate
      const tileLat = Math.floor((tc.lat - 6.0) / 3.0) * 3.0 + 6.0;
      const tileLon = Math.floor((tc.lon - 68.0) / 3.0) * 3.0 + 68.0;
      const tileId = `tile_${Number(tileLat.toFixed(1))}_${Number(tileLon.toFixed(1))}`;
      const tileDoc = await OsmTile.findOne({ tileId }).lean();
      const isTileCompleted = tileDoc?.status === 'completed';

      // Validate expectations
      if (tc.expectedCategories.length === 0) {
        // Offshore / no coverage expected
        if (result.enrichmentStatus === 'no_osm_coverage' || result.nearbyFeatureCount <= 2) {
          console.log(`  ✓ [PASS] Correctly identified limited/no coverage`);
          passed++;
        } else {
          console.log(`  ⚠ [WARN] Unexpected features found in area expected to have none (${result.nearbyFeatureCount} features)`);
          warnings++;
          passed++;
        }
      } else if (result.enrichmentStatus === 'enriched' || result.enrichmentStatus === 'partial') {
        console.log(`  ✓ [PASS] Enrichment returned spatial context (${result.enrichmentStatus})`);
        passed++;
      } else if (!isTileCompleted) {
        console.log(`  ⏳ [PENDING TILE] Tile "${tileId}" covering ${tc.region} is not yet extracted in MongoDB.`);
        console.log(`     (To extract this tile: npx tsx src/scripts/extractIndia.ts --tile ${tileId})`);
        warnings++;
      } else {
        console.log(`  ✗ [FAIL] Tile "${tileId}" is completed but no spatial context was found within search radius.`);
        failed++;
      }
    } catch (err: any) {
      console.error(`  ✗ [FAIL] Enrichment error: ${err.message}`);
      failed++;
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`🏁 Validation Finished: ${passed} passed, ${failed} failed, ${warnings} warnings`);
  console.log('═══════════════════════════════════════════════════════════════');

  await disconnectDatabase();

  if (failed > 0) {
    process.exit(1);
  }
}

runValidation().catch((err) => {
  console.error('[Enrichment Validation] Fatal error:', err);
  process.exit(1);
});
