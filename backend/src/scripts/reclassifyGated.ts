/**
 * Re-run the production classifier on detections that never reached the model.
 *
 * A detection is gated to `unclassified_insufficient_features` when its OSM
 * context could not be resolved, and to `unclassified_model_unavailable` when the
 * inference service did not answer. Neither is re-evaluated on its own once the
 * missing context arrives, so after an OSM import those rows stay unclassified.
 * This runs the unmodified classifyHotspot() on them again. A row that still has
 * no mapped facility within 25 km stays gated — nothing is filled in.
 *
 * --include-legacy also covers classifications written before pipelineStatus
 * existed (status missing). --stale-model also covers rows produced by any model
 * version other than the one the inference service is serving now, so every row
 * on the map comes from the current model.
 *
 * Usage (from backend/, inference service running):
 *   npx tsx src/scripts/reclassifyGated.ts [--include-legacy] [--stale-model] [--concurrency 8]
 */
import axios from 'axios';
import mongoose, { Types } from 'mongoose';
import { config } from '../config';
import { connectDatabase, getDatabaseMode } from '../config/database';
import { Hotspot, IHotspot } from '../modules/hotspots/hotspot.model';
import { Classification } from '../modules/classifications/classification.model';
import { classifyHotspot } from '../modules/classifications/classification.service';

async function main() {
  const includeLegacy = process.argv.includes('--include-legacy');
  const ci = process.argv.indexOf('--concurrency');
  const concurrency = ci > 0 ? Number(process.argv[ci + 1]) : 8;

  process.env.ALLOW_EPHEMERAL_DB = 'false';
  await connectDatabase();
  if (getDatabaseMode() !== 'atlas') throw new Error('not connected to the configured database');

  const health = (await axios.get(`${config.modelServiceUrl}/health`, { timeout: 3000 })).data;
  if (health.status !== 'ok') throw new Error('inference service is not healthy');
  console.log(`[reclassify] model service: ${health.model_version} (${health.data_source})`);

  const staleModel = process.argv.includes('--stale-model');
  const statuses: (string | null)[] = ['unclassified_insufficient_features', 'unclassified_model_unavailable'];
  const or: any[] = [{ pipelineStatus: { $in: statuses } }];
  if (includeLegacy) or.push({ pipelineStatus: { $exists: false } }, { pipelineStatus: null });
  // Rows whose prediction came from a model other than the one now being served
  // (e.g. the synthetic v1 artifact, or an -OFFLINE fallback version string).
  if (staleModel) or.push({ modelVersion: { $ne: health.model_version } });
  const filter: any = { $or: or };
  const ids = (await Classification.find(filter).select('hotspotId').lean()).map((c: any) => c.hotspotId as Types.ObjectId);
  // --missing: detections stored without any classification record (e.g. the
  // classify step failed or timed out during ingestion and was never retried).
  if (process.argv.includes('--missing')) {
    const classified = new Set((await Classification.distinct('hotspotId')).map(String));
    const orphans = (await Hotspot.find({}).select('_id').lean()).filter((h: any) => !classified.has(String(h._id)));
    ids.push(...orphans.map((h: any) => h._id as Types.ObjectId));
    console.log(`[reclassify] ${orphans.length} detections have no classification record`);
  }
  const hotspots = await Hotspot.find({ _id: { $in: ids } }).sort({ detectedAt: -1 }).lean<IHotspot[]>();
  console.log(`[reclassify] ${hotspots.length} detections to re-evaluate (newest first)`);

  const outcome: Record<string, number> = {};
  const classes: Record<string, number> = {};
  let next = 0, done = 0;
  const t0 = Date.now();
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < hotspots.length) {
      const h = hotspots[next++];
      try {
        const doc: any = await classifyHotspot(h);
        outcome[doc.pipelineStatus] = (outcome[doc.pipelineStatus] ?? 0) + 1;
        if (doc.predictedClass) classes[doc.predictedClass] = (classes[doc.predictedClass] ?? 0) + 1;
      } catch (e: any) {
        outcome.error = (outcome.error ?? 0) + 1;
        console.warn(`[reclassify] ${h._id}: ${e.message}`);
      }
      if (++done % 500 === 0) {
        console.log(`[reclassify] ${done}/${hotspots.length} ${JSON.stringify(outcome)} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
      }
    }
  }));

  console.log(`[reclassify] done in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  console.log('[reclassify] outcome:', JSON.stringify(outcome));
  console.log('[reclassify] predicted classes:', JSON.stringify(classes));
  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error('[reclassify] FAILED:', e.message);
  await mongoose.disconnect();
  process.exit(1);
});
