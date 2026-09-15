/**
 * Load FIRMS archive detections and India-wide OSM context into the LOCAL
 * training database, through the same normalisers production ingestion uses.
 *
 *   FIRMS rows  → normalizeFirmsRecord  → hotspots      (history + cluster context)
 *   OSM elements→ normalizeOsmElement   → osmfeatures   (enrichment context)
 *
 * Using the production normalisers is the point: the feature extractor then sees
 * documents that are byte-for-byte shaped like live ones, so the training vector
 * and the serving vector come from one code path.
 *
 * Usage (from backend/):
 *   npx tsx src/scripts/training/loadTrainingContext.ts \
 *     --firms-dir ../ml/data/raw/firms --osm ../ml/data/interim/osm_elements_india.ndjson [--reset]
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import mongoose from 'mongoose';
import { parse } from 'csv-parse';
import { Hotspot } from '../../modules/hotspots/hotspot.model';
import { OsmFeature } from '../../modules/osm/osmFeature.model';
import { normalizeFirmsRecord } from '../../modules/ingestion/firms.client';
import { normalizeOsmElement, RawOsmElement } from '../../modules/osm/osmExtractor';
import { connectTrainingDb, parseArgs } from './trainingDb';

const BATCH = 5000;

async function insertBatch(collection: any, docs: any[]): Promise<{ inserted: number; duplicates: number }> {
  if (docs.length === 0) return { inserted: 0, duplicates: 0 };
  try {
    const r = await collection.insertMany(docs, { ordered: false });
    return { inserted: r.insertedCount, duplicates: 0 };
  } catch (err: any) {
    const writeErrors = err.writeErrors ?? [];
    const dup = writeErrors.filter((e: any) => (e.code ?? e.err?.code) === 11000).length;
    if (dup !== writeErrors.length) throw err;
    return { inserted: err.result?.insertedCount ?? docs.length - dup, duplicates: dup };
  }
}

async function loadFirms(dir: string) {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.csv')).sort();
  // The normaliser warns once per dropped row; count instead of flooding the log.
  const warn = console.warn;
  let dropped = 0;
  console.warn = () => { dropped++; };
  try {
    for (const file of files) {
      const t0 = Date.now();
      let batch: any[] = [];
      let read = 0, inserted = 0, duplicates = 0;
      const parser = fs.createReadStream(path.join(dir, file)).pipe(parse({ columns: true, skip_empty_lines: true }));
      for await (const raw of parser) {
        read++;
        const doc: any = normalizeFirmsRecord(raw);
        if (!doc) continue;
        // rawSource is excluded from queries in production and unused by the
        // extractor; dropping it halves the training database.
        delete doc.rawSource;
        doc.createdAt = doc.ingestedAt;
        doc.updatedAt = doc.ingestedAt;
        batch.push(doc);
        if (batch.length >= BATCH) {
          const r = await insertBatch(Hotspot.collection, batch);
          inserted += r.inserted; duplicates += r.duplicates; batch = [];
        }
      }
      const r = await insertBatch(Hotspot.collection, batch);
      inserted += r.inserted; duplicates += r.duplicates;
      warn(`[load] ${file}: read ${read}, inserted ${inserted}, duplicates ${duplicates} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    }
  } finally {
    console.warn = warn;
  }
  console.log(`[load] FIRMS rows dropped by normalizeFirmsRecord validation: ${dropped}`);
}

async function loadOsm(file: string) {
  const t0 = Date.now();
  let batch: any[] = [];
  let read = 0, inserted = 0, rejected = 0;
  const rl = readline.createInterface({ input: fs.createReadStream(file) });
  for await (const line of rl) {
    if (!line.trim()) continue;
    read++;
    const el = JSON.parse(line) as RawOsmElement & { tags: Record<string, string> | string };
    if (typeof el.tags === 'string') el.tags = JSON.parse(el.tags);
    if (el.lat === null) delete el.lat;
    if (el.lon === null) delete el.lon;
    if (el.center === null) delete el.center;
    const lat = el.lat ?? el.center?.lat ?? 0;
    const lon = el.lon ?? el.center?.lon ?? 0;
    const tileId = `tile_${Math.floor(lat / 3) * 3}_${Math.floor(lon / 3) * 3}`;
    const doc: any = normalizeOsmElement(el as RawOsmElement, tileId);
    if (!doc) { rejected++; continue; }
    doc.createdAt = doc.extractedAt;
    doc.updatedAt = doc.extractedAt;
    batch.push(doc);
    if (batch.length >= BATCH) {
      inserted += (await insertBatch(OsmFeature.collection, batch)).inserted;
      batch = [];
    }
  }
  inserted += (await insertBatch(OsmFeature.collection, batch)).inserted;
  console.log(`[load] OSM elements: read ${read}, inserted ${inserted}, rejected by normalizer ${rejected} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const uri = await connectTrainingDb();
  console.log(`[load] training database: ${uri}`);

  if (args.reset) {
    await mongoose.connection.db!.dropDatabase();
    console.log('[load] dropped training database');
  }
  await Hotspot.syncIndexes();
  await OsmFeature.syncIndexes();

  if (typeof args['osm'] === 'string') await loadOsm(args['osm']);
  if (typeof args['firms-dir'] === 'string') await loadFirms(args['firms-dir']);

  const [h, o] = await Promise.all([Hotspot.estimatedDocumentCount(), OsmFeature.estimatedDocumentCount()]);
  console.log(`[load] totals — hotspots: ${h}, osmfeatures: ${o}`);
  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await mongoose.disconnect();
  process.exit(1);
});
