/**
 * Import India-wide OSM context from an Overpass-shaped element file into the
 * configured database (MONGODB_URI).
 *
 * The Overpass tile extractor (extractIndia.ts) is the live path but is rate
 * limited, and most tiles were never pulled — so most of India had no OSM
 * context and every detection there was gated to
 * `unclassified_insufficient_features`. The element file is produced by
 * ml/src/features/osm_elements.py from the Geofabrik India extract using the
 * same tag filter as buildOverpassQuery, with Overpass `out center` geometry.
 *
 * Elements go through the production normalizeOsmElement() and the same
 * upsert-by-sourceId bulk write as osmExtractor.service.ts, so a later Overpass
 * run over the same area updates these documents instead of duplicating them.
 * Tile states are left untouched: they record Overpass progress, not this import.
 *
 * Usage (from backend/):
 *   npx tsx src/scripts/importOsmElements.ts ../ml/data/interim/osm_elements_india.ndjson [--dry-run]
 */
import fs from 'node:fs';
import readline from 'node:readline';
import mongoose from 'mongoose';
import { connectDatabase, getDatabaseMode } from '../config/database';
import { OsmFeature } from '../modules/osm/osmFeature.model';
import { normalizeOsmElement, RawOsmElement } from '../modules/osm/osmExtractor';

const BATCH_SIZE = 1000;

async function main() {
  const file = process.argv[2];
  const dryRun = process.argv.includes('--dry-run');
  if (!file || !fs.existsSync(file)) throw new Error(`element file not found: ${file}`);

  // Never import into a throwaway in-memory database by accident.
  process.env.ALLOW_EPHEMERAL_DB = 'false';
  await connectDatabase();
  if (getDatabaseMode() !== 'atlas') throw new Error('not connected to the configured database');
  // Create-only: syncIndexes() would also drop any index not declared in the schema.
  await OsmFeature.createIndexes();

  const before = await OsmFeature.countDocuments();
  console.log(`[osm-import] osmfeatures before: ${before}${dryRun ? ' (dry run)' : ''}`);

  let read = 0, rejected = 0, upserted = 0, matched = 0;
  let batch: any[] = [];
  const t0 = Date.now();

  const flush = async () => {
    if (batch.length === 0 || dryRun) { batch = []; return; }
    const ops = batch.map((feat) => ({
      updateOne: { filter: { sourceId: feat.sourceId }, update: { $set: feat }, upsert: true },
    }));
    const result = await OsmFeature.bulkWrite(ops as any, { ordered: false });
    upserted += result.upsertedCount || 0;
    matched += result.matchedCount || 0;
    batch = [];
  };

  const rl = readline.createInterface({ input: fs.createReadStream(file) });
  for await (const line of rl) {
    if (!line.trim()) continue;
    read++;
    const el = JSON.parse(line);
    if (typeof el.tags === 'string') el.tags = JSON.parse(el.tags);
    if (el.lat === null) delete el.lat;
    if (el.lon === null) delete el.lon;
    if (el.center === null) delete el.center;
    const lat = el.lat ?? el.center?.lat ?? 0;
    const lon = el.lon ?? el.center?.lon ?? 0;
    const tileId = `tile_${Math.floor(lat / 3) * 3}_${Math.floor(lon / 3) * 3}`;
    const feat = normalizeOsmElement(el as RawOsmElement, tileId);
    if (!feat) { rejected++; continue; }
    batch.push(feat);
    if (batch.length >= BATCH_SIZE) {
      await flush();
      if (read % 50000 < BATCH_SIZE) {
        console.log(`[osm-import] ${read} read, ${upserted} new, ${matched} existing (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
      }
    }
  }
  await flush();

  const after = await OsmFeature.countDocuments();
  console.log(`[osm-import] done: read ${read}, rejected ${rejected}, new ${upserted}, already present ${matched}; osmfeatures ${before} -> ${after} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error('[osm-import] FAILED:', e.message);
  await mongoose.disconnect();
  process.exit(1);
});
