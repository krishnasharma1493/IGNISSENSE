import axios from 'axios';
import { normalizeFirmsRecord } from '../modules/ingestion/firms.client';
import { toCanonicalFeatureRecord, ExtractedFeatures } from '../modules/classifications/feature.extractor';

async function runPipelineVerification() {
  console.log('===============================================================');
  console.log('🧪 IGNISSENSE PIPELINE & INTEGRITY VERIFICATION SUITE');
  console.log('===============================================================');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`  ✓ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`  ✗ [FAIL] ${testName} ${detail ? `(${detail})` : ''}`);
      failed++;
    }
  }

  // 1. FIRMS CSV Parser & Validation
  console.log('\n[1/4] Testing FIRMS Telemetry Parsing & Coordinate Validation...');
  const validRaw = {
    latitude: '28.6139',
    longitude: '77.2090',
    bright_ti4: '355.2',
    scan: '0.4',
    track: '0.4',
    acq_date: '2026-08-30',
    acq_time: '1430',
    satellite: 'N',
    instrument: 'VIIRS',
    confidence: 'nominal',
    version: '2.0NRT',
    bright_ti5: '302.1',
    frp: '22.8',
    daynight: 'D',
  };

  const parsed = normalizeFirmsRecord(validRaw as any);
  assert(parsed !== null, 'Valid VIIRS record parses successfully');
  assert(parsed?.location.coordinates[0] === 77.209, 'GeoJSON longitude parsed correctly');
  assert(parsed?.location.coordinates[1] === 28.6139, 'GeoJSON latitude parsed correctly');
  assert(parsed?.detectedAt.toISOString() === '2026-08-30T14:30:00.000Z', 'Acquisition UTC timestamp converted accurately');
  assert(parsed?.frp === 22.8, 'FRP extracted accurately');
  assert(parsed?.region === 'delhi_ncr', 'Delhi NCR geographic bbox detected');

  const invalidCoords = normalizeFirmsRecord({ ...validRaw, latitude: '128.0' } as any);
  assert(invalidCoords === null, 'Out-of-bounds latitude (+128) safely dropped');

  const invalidDate = normalizeFirmsRecord({ ...validRaw, acq_date: 'bad-date' } as any);
  assert(invalidDate === null, 'Malformed acquisition date safely dropped');

  // 2. Canonical 14-Feature Schema Alignment
  console.log('\n[2/4] Testing Canonical 14-Feature Alignment (Zero Drift)...');
  const mockExtracted: ExtractedFeatures = {
    frp: 45.0,
    brightness: 365.0,
    brightnessTi5: 330.0,
    tempDelta: 35.0,
    dayNight: 'N',
    instrument: 'VIIRS',
    satellite: 'NOAA-20',
    confidence: 'high',
    nearestFacility: null,
    facilityDistanceMeters: 150.0,
    facilityType: 'refinery',
    isInsideIndustrialPerimeter: true,
    isNearIndustrialPerimeter: true,
    nearbyClusterCount3km: 3,
    landCover: 'built_up',
    historicalOverpassesWithin1_5km: 4,
    historicalMeanFrp: 18.0,
    historicalStdDevFrp: 3.5,
    frpZScore: 2.3,
    daysSinceLastDetection: 8.5,
    priorObservations: [],
  };

  const canonical = toCanonicalFeatureRecord(mockExtracted).values;
  assert(canonical.frp === 45.0, 'FRP mapped');
  assert(canonical.is_night === 1, 'is_night mapped');
  assert(canonical.facility_type_encoded === 1, 'refinery mapped to encoded 1');
  assert(canonical.landcover_encoded === 0, 'built_up mapped to encoded 0');
  assert(canonical.facility_distance_m === 150.0, 'facility distance preserved');
  assert(canonical.frp_z_score === 2.3, 'frp_z_score preserved');
  assert(canonical.confidence === 0.95, 'High confidence normalized to 0.95');

  // 3. Live ML Inference Service
  console.log('\n[3/4] Testing Trained Python XGBoost Inference Service...');
  try {
    const healthRes = await axios.get('http://localhost:8000/health');
    assert(healthRes.data?.status === 'ok', 'ML inference service is healthy');
    assert(healthRes.data?.classes?.length === 6, 'All 6 target fire classes supported');

    const predRes = await axios.post('http://localhost:8000/predict', {
      features: canonical,
    });
    assert(predRes.data?.success === true, 'ML prediction returned success');
    assert(typeof predRes.data?.data?.predicted_class === 'string', `Predicted class: "${predRes.data?.data?.predicted_class}"`);
    assert(predRes.data?.data?.confidence > 0.50, `Prediction confidence: ${predRes.data?.data?.confidence}`);

    const probs = predRes.data?.data?.class_probabilities;
    const probSum = Object.values(probs).reduce((a: any, b: any) => a + b, 0) as number;
    assert(Math.abs(probSum - 1.0) < 0.05, `Probabilities sum to 1.0 (actual: ${probSum.toFixed(4)})`);
  } catch (err: any) {
    assert(false, 'ML Inference Service Communication', err.message);
  }

  // 4. Truthful System Provenance API
  console.log('\n[4/4] Testing /api/v1/system/status System Provenance...');
  try {
    const statusRes = await axios.get('http://localhost:5001/api/v1/system/status');
    const d = statusRes.data?.data;
    assert(statusRes.status === 200, 'System status endpoint returned 200 OK');
    assert(d.firmsConnected === true, 'NASA FIRMS connection verified');
    assert(d.modelStatus === 'ready', 'ML model status reported as ready');
    assert(d.databaseStatus === 'connected', 'Database status reported as connected');
    assert(d.demoMode === false, 'DEMO_MODE is strictly false');
    assert(typeof d.pollStatusMessage === 'string', `Poll message: "${d.pollStatusMessage}"`);
    assert(d.counts.totalHotspots >= 0, `Authentic verified hotspots: ${d.counts.totalHotspots}`);
    assert(d.counts.openAlerts >= 0, `Authentic open alerts: ${d.counts.openAlerts}`);
  } catch (err: any) {
    assert(false, 'System Status API Communication', err.message);
  }

  console.log('\n===============================================================');
  console.log(`🏁 Verification Finished: ${passed} passed, ${failed} failed`);
  console.log('===============================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runPipelineVerification();
