import { OsmFeature } from './osmFeature.model';
import { OsmTile } from './osmTile.model';
import {
  generateIndiaTiles,
  fetchTileFromOverpass,
  normalizeOsmElement,
  sleep,
  DEFAULT_TILE_SIZE,
  TileBbox,
} from './osmExtractor';
import type { FeatureCategory } from './taxonomy';

/**
 * OSM Extractor Service — Orchestration Layer
 *
 * Manages the end-to-end India-wide OSM extraction:
 * 1. Initializes tile grid in MongoDB
 * 2. Processes tiles sequentially with rate limiting
 * 3. Supports resumability (skips completed tiles)
 * 4. Generates extraction reports
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ExtractionReport {
  totalTiles: number;
  completedTiles: number;
  failedTiles: number;
  skippedTiles: number;
  totalFeatures: number;
  featuresByCategory: Record<string, number>;
  duplicatesSkipped: number;
  invalidGeometries: number;
  startedAt: Date;
  completedAt: Date;
  durationMs: number;
  source: 'OpenStreetMap Overpass API';
  datasetVersion: string;
}

// ─── Inter-Tile Delay ────────────────────────────────────────────────────────
// 3 seconds between tiles to stay well within Overpass API rate limits.
const INTER_TILE_DELAY_MS = 3000;

// Maximum attempts per tile before marking as permanently failed
const MAX_TILE_ATTEMPTS = 3;

// ─── Main Extraction Orchestrator ────────────────────────────────────────────

export async function runIndiaOsmExtraction(options: {
  retryFailed?: boolean;
  specificTiles?: string[];
  tileSize?: number;
  dryRun?: boolean;
} = {}): Promise<ExtractionReport> {
  const startedAt = new Date();
  const tileSize = options.tileSize || DEFAULT_TILE_SIZE;

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('🌍 IGNISSENSE India-Wide OSM Spatial Data Extraction');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`Tile size: ${tileSize}° × ${tileSize}°`);

  // 1. Generate or resume tile grid
  const tiles = generateIndiaTiles(tileSize);
  console.log(`Total geographic tiles: ${tiles.length}`);

  // Initialize tiles in DB (upsert to preserve existing progress)
  for (const tile of tiles) {
    await OsmTile.updateOne(
      { tileId: tile.tileId },
      {
        $setOnInsert: {
          tileId: tile.tileId,
          bbox: tile.bbox,
          status: 'pending',
          featuresExtracted: 0,
          attempts: 0,
        },
      },
      { upsert: true }
    );
  }

  // 2. Determine which tiles to process
  let tilesToProcess: Array<{ tileId: string; bbox: TileBbox }>;

  if (options.specificTiles && options.specificTiles.length > 0) {
    tilesToProcess = tiles.filter((t) => options.specificTiles!.includes(t.tileId));
    console.log(`Processing ${tilesToProcess.length} specific tiles`);
  } else if (options.retryFailed) {
    const failedTiles = await OsmTile.find({ status: 'failed' }).lean();
    const failedIds = new Set(failedTiles.map((t) => t.tileId));
    tilesToProcess = tiles.filter((t) => failedIds.has(t.tileId));
    console.log(`Retrying ${tilesToProcess.length} failed tiles`);
  } else {
    // Process pending and failed tiles (skip completed)
    const nonCompleteTiles = await OsmTile.find({
      status: { $in: ['pending', 'failed'] },
    }).lean();
    const nonCompleteIds = new Set(nonCompleteTiles.map((t) => t.tileId));
    tilesToProcess = tiles.filter((t) => nonCompleteIds.has(t.tileId));
    const completedCount = tiles.length - tilesToProcess.length;
    if (completedCount > 0) {
      console.log(`Resuming: ${completedCount} tiles already completed, ${tilesToProcess.length} remaining`);
    }
  }

  if (options.dryRun) {
    console.log('[DRY RUN] Would process these tiles:');
    tilesToProcess.forEach((t) =>
      console.log(`  ${t.tileId}: [${t.bbox.south}, ${t.bbox.west}] → [${t.bbox.north}, ${t.bbox.east}]`)
    );
    return generateReport(startedAt, 0);
  }

  // 3. Process tiles sequentially
  let totalFeaturesInserted = 0;
  let totalDuplicates = 0;
  let totalInvalid = 0;
  let completedCount = 0;
  let failedCount = 0;

  for (let i = 0; i < tilesToProcess.length; i++) {
    const tile = tilesToProcess[i];
    const progress = `[${i + 1}/${tilesToProcess.length}]`;

    // Check if tile was already completed (race condition protection)
    const tileDoc = await OsmTile.findOne({ tileId: tile.tileId }).lean();
    if (tileDoc?.status === 'completed') {
      console.log(`${progress} Skipping already completed tile ${tile.tileId}`);
      continue;
    }

    // Check max attempts
    if (tileDoc && tileDoc.attempts >= MAX_TILE_ATTEMPTS) {
      console.warn(`${progress} Tile ${tile.tileId} exceeded max attempts (${MAX_TILE_ATTEMPTS}). Skipping.`);
      failedCount++;
      continue;
    }

    console.log(
      `\n${progress} Processing tile ${tile.tileId} ` +
      `[${tile.bbox.south}°,${tile.bbox.west}°] → [${tile.bbox.north}°,${tile.bbox.east}°]`
    );

    // Mark tile as in_progress
    await OsmTile.updateOne(
      { tileId: tile.tileId },
      {
        $set: { status: 'in_progress', startedAt: new Date() },
        $inc: { attempts: 1 },
      }
    );

    const tileStart = Date.now();

    try {
      // Fetch from Overpass
      const { elements, endpoint } = await fetchTileFromOverpass(tile.bbox);
      console.log(`  Fetched ${elements.length} raw OSM elements from ${endpoint}`);

      // Normalize elements
      const normalized = [];
      let invalid = 0;

      for (const el of elements) {
        const feature = normalizeOsmElement(el, tile.tileId);
        if (feature) {
          normalized.push(feature);
        } else {
          invalid++;
        }
      }

      totalInvalid += invalid;
      console.log(`  Normalized: ${normalized.length} features (${invalid} invalid/skipped)`);

      // Bulk upsert into MongoDB
      let inserted = 0;
      let duplicates = 0;

      if (normalized.length > 0) {
        const BATCH_SIZE = 500;
        for (let b = 0; b < normalized.length; b += BATCH_SIZE) {
          const batch = normalized.slice(b, b + BATCH_SIZE);
          const ops = batch.map((feat) => ({
            updateOne: {
              filter: { sourceId: feat.sourceId },
              update: { $set: feat },
              upsert: true,
            },
          }));

          try {
            const result = await OsmFeature.bulkWrite(ops as any, { ordered: false });
            inserted += result.upsertedCount || 0;
            duplicates += (result.modifiedCount || 0);
          } catch (bulkErr: any) {
            // Handle partial failures in bulk write
            if (bulkErr.result) {
              inserted += bulkErr.result.nUpserted || 0;
              duplicates += bulkErr.result.nModified || 0;
            }
            console.warn(`  Bulk write partial error: ${bulkErr.message}`);
          }
        }
      }

      totalFeaturesInserted += inserted;
      totalDuplicates += duplicates;

      // Mark tile as completed
      const durationMs = Date.now() - tileStart;
      await OsmTile.updateOne(
        { tileId: tile.tileId },
        {
          $set: {
            status: 'completed',
            featuresExtracted: normalized.length,
            completedAt: new Date(),
            durationMs,
            overpassEndpoint: endpoint,
            errorMessage: undefined,
          },
        }
      );

      completedCount++;
      console.log(
        `  ✓ Tile ${tile.tileId} complete: ${inserted} new, ${duplicates} updated (${durationMs}ms)`
      );
    } catch (err: any) {
      failedCount++;
      const durationMs = Date.now() - tileStart;

      await OsmTile.updateOne(
        { tileId: tile.tileId },
        {
          $set: {
            status: 'failed',
            errorMessage: err.message,
            durationMs,
          },
        }
      );

      console.error(`  ✗ Tile ${tile.tileId} FAILED: ${err.message} (${durationMs}ms)`);
    }

    // Inter-tile delay (skip after last tile)
    if (i < tilesToProcess.length - 1) {
      await sleep(INTER_TILE_DELAY_MS);
    }
  }

  // 4. Generate and log report
  const report = await generateReport(startedAt, totalDuplicates);

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('📊 EXTRACTION REPORT');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`Tiles Processed: ${completedCount} completed, ${failedCount} failed`);
  console.log(`Total Features: ${report.totalFeatures}`);
  console.log('Features by Category:');
  for (const [cat, count] of Object.entries(report.featuresByCategory)) {
    console.log(`  ${cat}: ${count}`);
  }
  console.log(`Duplicates Updated: ${totalDuplicates}`);
  console.log(`Invalid Geometries Dropped: ${totalInvalid}`);
  console.log(`Duration: ${((Date.now() - startedAt.getTime()) / 1000).toFixed(1)}s`);
  console.log('═══════════════════════════════════════════════════════════════');

  return report;
}

// ─── Report Generator ────────────────────────────────────────────────────────

export async function generateReport(
  startedAt: Date = new Date(),
  duplicatesSkipped: number = 0
): Promise<ExtractionReport> {
  const completedAt = new Date();

  // Tile stats
  const [totalTiles, completedTiles, failedTiles] = await Promise.all([
    OsmTile.countDocuments(),
    OsmTile.countDocuments({ status: 'completed' }),
    OsmTile.countDocuments({ status: 'failed' }),
  ]);
  const skippedTiles = totalTiles - completedTiles - failedTiles;

  // Feature stats
  const totalFeatures = await OsmFeature.countDocuments();

  // Features by category aggregation
  const categoryAgg = await OsmFeature.aggregate([
    { $group: { _id: '$featureCategory', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);

  const featuresByCategory: Record<string, number> = {};
  for (const entry of categoryAgg) {
    featuresByCategory[entry._id] = entry.count;
  }

  return {
    totalTiles,
    completedTiles,
    failedTiles,
    skippedTiles,
    totalFeatures,
    featuresByCategory,
    duplicatesSkipped,
    invalidGeometries: 0, // Tracked during extraction, not persisted
    startedAt,
    completedAt,
    durationMs: completedAt.getTime() - startedAt.getTime(),
    source: 'OpenStreetMap Overpass API',
    datasetVersion: `india-osm-${completedAt.toISOString().split('T')[0]}`,
  };
}

/**
 * Get a summary of failed tiles for debugging.
 */
export async function getFailedTilesSummary(): Promise<
  Array<{ tileId: string; errorMessage?: string; attempts: number }>
> {
  return OsmTile.find({ status: 'failed' })
    .select('tileId errorMessage attempts')
    .lean();
}

/**
 * Reset all tiles to pending (for a fresh re-extraction).
 * Optionally also clears the osm_features collection.
 */
export async function resetExtraction(clearFeatures: boolean = false): Promise<void> {
  await OsmTile.updateMany({}, { $set: { status: 'pending', attempts: 0, featuresExtracted: 0 } });
  if (clearFeatures) {
    await OsmFeature.deleteMany({});
  }
  console.log('[OSM Extractor] Extraction state reset.');
}
