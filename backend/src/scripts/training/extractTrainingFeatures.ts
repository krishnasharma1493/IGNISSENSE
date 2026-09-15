/**
 * Compute the canonical 14-feature vector for labelled FIRMS archive detections
 * with the PRODUCTION feature code, against the local training database.
 *
 * For each labelled row this looks up the hotspot document that
 * loadTrainingContext.ts stored (by the same unique key production dedups on),
 * then runs exactly what classifyHotspot runs before inference:
 *
 *   extractFeaturesForHotspot(hotspot)  →  toCanonicalFeatureRecord(features)
 *
 * There is no Python reimplementation of any feature. What the model is trained
 * on is what the live pipeline will send to /predict.
 *
 * History and cluster queries only look backwards in time (detectedAt < t, and
 * [t-72h, t]), so no row sees detections from its own future.
 *
 * Input CSV columns: row_id,latitude,longitude,acq_date,acq_time,satellite,instrument
 * Output: NDJSON, one line per row, resumable (rows already present are skipped).
 *
 * Usage (from backend/):
 *   npx tsx src/scripts/training/extractTrainingFeatures.ts \
 *     --input ../ml/data/interim/labels_for_extraction.csv \
 *     --output ../ml/data/interim/features.ndjson --concurrency 24
 */
import fs from 'node:fs';
import readline from 'node:readline';
import mongoose from 'mongoose';
import { parse } from 'csv-parse';
import { Hotspot, IHotspot } from '../../modules/hotspots/hotspot.model';
import { extractFeaturesForHotspot, toCanonicalFeatureRecord } from '../../modules/classifications/feature.extractor';
import { FEATURE_VERSION } from '../../modules/classifications/featureContract';
import { connectTrainingDb, parseArgs } from './trainingDb';

interface InputRow {
  row_id: string;
  latitude: string;
  longitude: string;
  acq_date: string;
  acq_time: string;
  satellite: string;
  instrument: string;
}

/** Same timestamp construction as normalizeFirmsRecord. */
function detectedAtOf(r: InputRow): Date {
  const t = String(r.acq_time).trim().padStart(4, '0');
  return new Date(`${r.acq_date.trim()}T${t.substring(0, 2)}:${t.substring(2, 4)}:00Z`);
}

async function alreadyDone(output: string): Promise<Set<string>> {
  const done = new Set<string>();
  if (!fs.existsSync(output)) return done;
  const rl = readline.createInterface({ input: fs.createReadStream(output) });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try { done.add(String(JSON.parse(line).row_id)); } catch { /* truncated last line from an interrupted run */ }
  }
  return done;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const input = String(args.input);
  const output = String(args.output);
  const concurrency = Number(args.concurrency ?? 16);
  if (!fs.existsSync(input)) throw new Error(`input not found: ${input}`);

  const uri = await connectTrainingDb();
  console.log(`[extract] training database: ${uri}  feature version: ${FEATURE_VERSION}`);

  // --shard k/n processes every n-th row starting at k, so several processes can
  // share one input. Give each shard its own --output; --done lists extra output
  // files whose row_ids count as finished.
  const [shardK, shardN] = String(args.shard ?? '0/1').split('/').map(Number);
  const done = await alreadyDone(output);
  for (const f of String(args.done ?? '').split(',').filter(Boolean)) {
    for (const id of await alreadyDone(f)) done.add(id);
  }
  const rows: InputRow[] = [];
  const parser = fs.createReadStream(input).pipe(parse({ columns: true, skip_empty_lines: true }));
  let i = 0;
  for await (const r of parser) {
    if (i++ % shardN === shardK && !done.has(String(r.row_id))) rows.push(r);
  }
  console.log(`[extract] shard ${shardK}/${shardN}: ${rows.length} rows to process (${done.size} already done)`);

  const out = fs.createWriteStream(output, { flags: 'a' });
  let next = 0, processed = 0, missing = 0;
  const t0 = Date.now();

  async function worker() {
    while (next < rows.length) {
      const r = rows[next++];
      const lon = parseFloat(r.longitude);
      const lat = parseFloat(r.latitude);
      const hotspot = await Hotspot.findOne({
        'location.coordinates': [lon, lat],
        detectedAt: detectedAtOf(r),
        satellite: r.satellite,
        instrument: r.instrument,
      }).lean<IHotspot>();

      if (!hotspot) {
        missing++;
        out.write(JSON.stringify({ row_id: r.row_id, error: 'hotspot_not_found' }) + '\n');
        continue;
      }

      const features = await extractFeaturesForHotspot(hotspot);
      const canonical = toCanonicalFeatureRecord(features);
      out.write(JSON.stringify({
        row_id: r.row_id,
        ...canonical.values,
        unresolved: canonical.unresolved,
        enrichment_status: features.enrichmentStatus ?? null,
        facility_type: features.facilityType,
        land_cover: features.landCover,
      }) + '\n');

      processed++;
      if (processed % 5000 === 0) {
        const rate = processed / ((Date.now() - t0) / 1000);
        console.log(`[extract] ${processed}/${rows.length} (${rate.toFixed(0)} rows/s, missing ${missing})`);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  await new Promise<void>((resolve) => out.end(resolve));
  console.log(`[extract] done: ${processed} extracted, ${missing} not found, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await mongoose.disconnect();
  process.exit(1);
});
