/**
 * End-to-end check of the live classification path against the running
 * inference service, using the local training database (never production).
 *
 *   1. GET  MODEL_SERVICE_URL/health — the service must be serving the real artifact
 *      whose version matches CURRENT_MODEL_METADATA.
 *   2. classifyHotspot() — the unmodified production function — on held-out 2024
 *      test detections, comparing stored predictions with their independent labels.
 *   3. --live: fetch today's NRT detections with the production FIRMS client, normalise
 *      them with the production normaliser, and classify a sample, exactly as the
 *      ingestion loop does. NRT rows carry no `type`, so this checks the path, not accuracy.
 *
 * Every hotspot, classification and alert this script creates is removed afterwards.
 *
 * Usage (from backend/, service running):
 *   MODEL_SERVICE_URL=http://127.0.0.1:8000 npx tsx src/scripts/training/verifyRealModel.ts \
 *     --test-csv ../ml/data/interim/verify_test_rows.csv --n 400 --live --live-n 300
 */
import fs from 'node:fs';
import axios from 'axios';
import mongoose, { Types } from 'mongoose';
import { parse } from 'csv-parse/sync';
import { config } from '../../config';
import { Hotspot, IHotspot } from '../../modules/hotspots/hotspot.model';
import { Classification } from '../../modules/classifications/classification.model';
import { Alert } from '../../modules/alerts/alert.model';
import { classifyHotspot, CURRENT_MODEL_METADATA } from '../../modules/classifications/classification.service';
import { fetchFirmsArea, normalizeFirmsRecord } from '../../modules/ingestion/firms.client';
import { connectTrainingDb, parseArgs } from './trainingDb';

const INDIA_BBOX = { west: 68.0, south: 6.5, east: 97.5, north: 37.5 };

async function classifyAll(hotspots: IHotspot[], concurrency = 8) {
  const out: { hotspot: IHotspot; doc: any }[] = [];
  let next = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < hotspots.length) {
      const h = hotspots[next++];
      out.push({ hotspot: h, doc: await classifyHotspot(h) });
    }
  }));
  return out;
}

function tally<T>(items: T[], key: (t: T) => string) {
  const m: Record<string, number> = {};
  for (const i of items) m[key(i)] = (m[key(i)] ?? 0) + 1;
  return m;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const created: Types.ObjectId[] = [];
  const touched: Types.ObjectId[] = [];
  let failed = false;

  await connectTrainingDb();
  try {
    const health = (await axios.get(`${config.modelServiceUrl}/health`, { timeout: 3000 })).data;
    console.log(`[verify] service ${config.modelServiceUrl}: ${health.model_version} (${health.data_source}), ${health.features.length} features, ${health.classes.length} classes`);
    if (health.data_source !== 'real') throw new Error('inference service is not serving the real-data artifact');
    if (health.model_version !== CURRENT_MODEL_METADATA.version) {
      throw new Error(`service version ${health.model_version} != backend CURRENT_MODEL_METADATA ${CURRENT_MODEL_METADATA.version}`);
    }

    if (typeof args['test-csv'] === 'string') {
      const n = Number(args.n ?? 400);
      const rows = parse(fs.readFileSync(args['test-csv'], 'utf8'), { columns: true }).slice(0, n) as any[];
      const hotspots: IHotspot[] = [];
      const labelOf = new Map<string, string>();
      for (const r of rows) {
        const t = String(r.acq_time).padStart(4, '0');
        const h = await Hotspot.findOne({
          'location.coordinates': [parseFloat(r.longitude), parseFloat(r.latitude)],
          detectedAt: new Date(`${r.acq_date}T${t.slice(0, 2)}:${t.slice(2)}:00Z`),
          satellite: r.satellite,
          instrument: r.instrument,
        }).lean<IHotspot>();
        if (!h) continue;
        hotspots.push(h);
        labelOf.set(String(h._id), r.label);
      }
      const results = await classifyAll(hotspots);
      results.forEach((r) => touched.push(r.hotspot._id as Types.ObjectId));
      const classified = results.filter((r) => r.doc.pipelineStatus === 'classified');
      const correct = classified.filter((r) => r.doc.predictedClass === labelOf.get(String(r.hotspot._id))).length;
      console.log(`[verify] held-out 2024 rows classified through classifyHotspot: ${results.length}`);
      console.log('[verify]   pipelineStatus:', tally(results, (r) => r.doc.pipelineStatus));
      console.log('[verify]   modelVersion:', tally(results, (r) => r.doc.modelVersion));
      console.log(`[verify]   agreement with independent label (classified rows): ${correct}/${classified.length}`);
      if (classified.some((r) => r.doc.modelVersion !== health.model_version)) {
        throw new Error('a classified row was stored with a model version other than the live service');
      }
      if (classified.length === 0) throw new Error('no held-out row reached the model');
    }

    if (args.live) {
      const sensor = String(args['live-sensor'] ?? 'VIIRS_NOAA20_NRT') as any;
      const raw = await fetchFirmsArea({ bbox: INDIA_BBOX, sensor, dayRange: 1 });
      const docs = raw.map((r) => normalizeFirmsRecord(r)).filter(Boolean) as any[];
      const liveN = Number(args['live-n'] ?? 300);
      const sample = docs.sort(() => 0.5 - Math.random()).slice(0, liveN);
      const inserted: IHotspot[] = [];
      for (const d of sample) {
        try {
          const h = await Hotspot.create(d);
          created.push(h._id as Types.ObjectId);
          inserted.push(h.toObject() as IHotspot);
        } catch (e: any) {
          if (e.code !== 11000) throw e;
        }
      }
      const results = await classifyAll(inserted);
      results.forEach((r) => touched.push(r.hotspot._id as Types.ObjectId));
      console.log(`[verify] live ${sensor} NRT detections classified: ${results.length} (fetched ${raw.length})`);
      console.log('[verify]   pipelineStatus:', tally(results, (r) => r.doc.pipelineStatus));
      console.log('[verify]   predictedClass:', tally(results.filter((r) => r.doc.predictedClass), (r) => r.doc.predictedClass));
      console.log('[verify]   modelVersion:', tally(results, (r) => r.doc.modelVersion));
      if (results.some((r) => r.doc.pipelineStatus === 'unclassified_model_unavailable')) {
        throw new Error('the service failed to answer for a complete live feature vector');
      }
    }
    console.log('[verify] OK');
  } catch (e) {
    failed = true;
    console.error('[verify] FAILED:', e);
  } finally {
    const [c, a, h] = await Promise.all([
      Classification.deleteMany({ hotspotId: { $in: touched } }),
      Alert.deleteMany({ hotspotId: { $in: touched } }),
      Hotspot.deleteMany({ _id: { $in: created } }),
    ]);
    console.log(`[verify] cleanup: ${c.deletedCount} classifications, ${a.deletedCount} alerts, ${h.deletedCount} live hotspots removed`);
    await mongoose.disconnect();
  }
  if (failed) process.exit(1);
}

main();
