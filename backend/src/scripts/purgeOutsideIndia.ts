/**
 * Remove stored detections that fall outside India's boundary, with a backup.
 *
 * Ingestion now drops these at the door (indiaBoundary.ts); this clears the ones
 * stored before that filter existed. Their classifications and alerts go with
 * them. Everything removed is first written as Extended JSON to
 * backend/logs/backups/ (git-ignored), which mongoimport or a short script can
 * restore.
 *
 * Usage (from backend/):
 *   npx tsx src/scripts/purgeOutsideIndia.ts           # dry run: counts only
 *   npx tsx src/scripts/purgeOutsideIndia.ts --apply   # back up, then delete
 */
import fs from 'node:fs';
import path from 'node:path';
import mongoose, { Types } from 'mongoose';
import { connectDatabase, getDatabaseMode } from '../config/database';
import { Hotspot } from '../modules/hotspots/hotspot.model';
import { Classification } from '../modules/classifications/classification.model';
import { Alert } from '../modules/alerts/alert.model';
import { isInsideIndia, INDIA_BOUNDARY_SOURCE } from '../modules/ingestion/indiaBoundary';

async function main() {
  const apply = process.argv.includes('--apply');
  process.env.ALLOW_EPHEMERAL_DB = 'false';
  await connectDatabase();
  if (getDatabaseMode() !== 'atlas') throw new Error('not connected to the configured database');
  console.log(`[purge] boundary: ${INDIA_BOUNDARY_SOURCE}`);

  const outside: Types.ObjectId[] = [];
  let total = 0;
  for await (const h of Hotspot.find({}, { location: 1 }).lean().cursor()) {
    total++;
    const [lon, lat] = (h as any).location.coordinates;
    if (!isInsideIndia(lon, lat)) outside.push((h as any)._id);
  }
  const [cls, alerts] = await Promise.all([
    Classification.countDocuments({ hotspotId: { $in: outside } }),
    Alert.countDocuments({ hotspotId: { $in: outside } }),
  ]);
  console.log(`[purge] ${outside.length} of ${total} hotspots are outside India (${cls} classifications, ${alerts} alerts)`);

  if (!apply) {
    console.log('[purge] dry run — nothing changed. Re-run with --apply to back up and delete.');
    await mongoose.disconnect();
    return;
  }
  if (outside.length === 0) {
    await mongoose.disconnect();
    return;
  }

  const [hotspotDocs, classificationDocs, alertDocs] = await Promise.all([
    Hotspot.find({ _id: { $in: outside } }).select('+rawSource').lean(),
    Classification.find({ hotspotId: { $in: outside } }).lean(),
    Alert.find({ hotspotId: { $in: outside } }).lean(),
  ]);
  const dir = path.join(__dirname, '..', '..', 'logs', 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `outside_india_${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  const EJSON = mongoose.mongo.BSON.EJSON;
  fs.writeFileSync(file, EJSON.stringify({
    createdAt: new Date(),
    boundary: INDIA_BOUNDARY_SOURCE,
    hotspots: hotspotDocs,
    classifications: classificationDocs,
    alerts: alertDocs,
  }, { relaxed: false }));
  console.log(`[purge] backup written: ${file} (${hotspotDocs.length} hotspots, ${classificationDocs.length} classifications, ${alertDocs.length} alerts)`);

  const a = await Alert.deleteMany({ hotspotId: { $in: outside } });
  const c = await Classification.deleteMany({ hotspotId: { $in: outside } });
  const h = await Hotspot.deleteMany({ _id: { $in: outside } });
  console.log(`[purge] deleted ${h.deletedCount} hotspots, ${c.deletedCount} classifications, ${a.deletedCount} alerts`);
  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error('[purge] FAILED:', e.message);
  await mongoose.disconnect();
  process.exit(1);
});
