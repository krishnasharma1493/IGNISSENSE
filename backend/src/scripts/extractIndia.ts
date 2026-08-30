#!/usr/bin/env tsx
/**
 * India-Wide OSM Spatial Data Extraction CLI
 *
 * Usage:
 *   npx tsx src/scripts/extractIndia.ts              # Full India extraction (resume from last state)
 *   npx tsx src/scripts/extractIndia.ts --retry       # Retry failed tiles only
 *   npx tsx src/scripts/extractIndia.ts --report      # Print extraction report (no extraction)
 *   npx tsx src/scripts/extractIndia.ts --reset       # Reset all tiles to pending
 *   npx tsx src/scripts/extractIndia.ts --tile tile_28.0_77.0  # Extract a specific tile
 */

import { config } from '../config';
import { connectDatabase, disconnectDatabase } from '../config/database';
import {
  runIndiaOsmExtraction,
  generateReport,
  getFailedTilesSummary,
  resetExtraction,
} from '../modules/osm/osmExtractor.service';

async function main() {
  const args = process.argv.slice(2);
  const isRetry = args.includes('--retry');
  const isReport = args.includes('--report');
  const isReset = args.includes('--reset');
  const isDryRun = args.includes('--dry-run');
  const tileIdx = args.indexOf('--tile');
  const specificTile = tileIdx >= 0 ? args[tileIdx + 1] : undefined;

  console.log('[India OSM Extraction] Connecting to database...');
  await connectDatabase();

  try {
    if (isReset) {
      const clearData = args.includes('--clear-data');
      console.log(`[India OSM Extraction] Resetting extraction state...${clearData ? ' (clearing features too)' : ''}`);
      await resetExtraction(clearData);
      console.log('[India OSM Extraction] Reset complete.');
      return;
    }

    if (isReport) {
      console.log('[India OSM Extraction] Generating extraction report...\n');
      const report = await generateReport();

      console.log('═══════════════════════════════════════════════════════════════');
      console.log('📊 INDIA OSM CONTEXT DATASET REPORT');
      console.log('═══════════════════════════════════════════════════════════════');
      console.log(`Dataset Version: ${report.datasetVersion}`);
      console.log(`Source: ${report.source}`);
      console.log(`Generated: ${report.completedAt.toISOString()}`);
      console.log('');
      console.log(`Tiles: ${report.completedTiles} completed / ${report.failedTiles} failed / ${report.totalTiles} total`);
      console.log(`Total Features: ${report.totalFeatures}`);
      console.log('');
      console.log('Features by Category:');
      for (const [cat, count] of Object.entries(report.featuresByCategory)) {
        const bar = '█'.repeat(Math.min(50, Math.round(count / Math.max(1, report.totalFeatures) * 50)));
        console.log(`  ${cat.padEnd(15)} ${String(count).padStart(8)}  ${bar}`);
      }

      if (report.failedTiles > 0) {
        console.log('\nFailed Tiles:');
        const failed = await getFailedTilesSummary();
        for (const t of failed) {
          console.log(`  ${t.tileId} (${t.attempts} attempts): ${t.errorMessage}`);
        }
      }

      console.log('═══════════════════════════════════════════════════════════════');
      return;
    }

    // Run extraction
    const options: Parameters<typeof runIndiaOsmExtraction>[0] = {};

    if (isRetry) {
      options.retryFailed = true;
    }
    if (specificTile) {
      options.specificTiles = [specificTile];
    }
    if (isDryRun) {
      options.dryRun = true;
    }

    await runIndiaOsmExtraction(options);
  } finally {
    await disconnectDatabase();
  }
}

main().catch((err) => {
  console.error('[India OSM Extraction] Fatal error:', err);
  process.exit(1);
});
