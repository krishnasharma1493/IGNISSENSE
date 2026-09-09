import { Router, Request, Response } from 'express';
import { Hotspot } from '../hotspots/hotspot.model';
import { Classification, CLASSIFICATION_CLASSES } from '../classifications/classification.model';
import { Alert } from '../alerts/alert.model';
import { CURRENT_MODEL_METADATA } from '../classifications/classification.service';
import { haversineMeters } from '../facilities/facility.service';

export const analyticsRoutes = Router();

/**
 * GET /api/v1/analytics/summary
 * Returns 100% database-derived aggregate statistics for Delhi NCR and parent India geography.
 */
analyticsRoutes.get('/summary', async (req: Request, res: Response) => {
  try {
    const { region } = req.query;
    const hotspotFilter: any = {};
    if (region) {
      hotspotFilter.region = region;
    }

    const totalHotspots = await Hotspot.countDocuments(hotspotFilter);

    // Count classifications by predicted class — only rows where inference actually ran.
    const classCounts: Record<string, number> = {};
    for (const cls of CLASSIFICATION_CLASSES) {
      classCounts[cls] = await Classification.countDocuments({
        pipelineStatus: 'classified',
        predictedClass: cls,
      });
    }

    // Detections with no prediction, split by why inference produced none:
    // features that could not be measured, versus a service that did not answer.
    const [insufficientFeatures, modelUnavailable] = await Promise.all([
      Classification.countDocuments({ pipelineStatus: 'unclassified_insufficient_features' }),
      Classification.countDocuments({ pipelineStatus: 'unclassified_model_unavailable' }),
    ]);
    const unclassified = insufficientFeatures + modelUnavailable;

    // Persistent sources (persistence >= 0.50)
    const persistentSources = await Classification.countDocuments({
      persistenceScore: { $gte: 0.5 },
    });

    // Anomalous sources (anomaly >= 0.65)
    const anomalousSources = await Classification.countDocuments({
      anomalyScore: { $gte: 0.65 },
    });

    // Open alerts
    const openAlerts = await Alert.countDocuments({ status: 'open' });

    // Last data update timestamp from genuine FIRMS documents
    const latestHotspot = await Hotspot.findOne()
      .sort({ detectedAt: -1 })
      .select('detectedAt satellite instrument version')
      .lean();

    // Region breakdown
    const delhiNcrHotspots = await Hotspot.countDocuments({ region: 'delhi_ncr' });
    const indiaHotspots = await Hotspot.countDocuments({ region: 'india' });

    res.json({
      success: true,
      data: {
        totalHotspots,
        classifications: {
          industrial_fire: classCounts.industrial_fire || 0,
          gas_flare: classCounts.gas_flare || 0,
          wildfire: classCounts.wildfire || 0,
          agricultural_burning: classCounts.agricultural_burning || 0,
          mining_thermal_activity: classCounts.mining_thermal_activity || 0,
          other_or_uncertain: classCounts.other_or_uncertain || 0,
        },
        persistentSources,
        anomalousSources,
        unclassified,
        unclassifiedBreakdown: {
          insufficientFeatures,
          modelUnavailable,
        },
        openAlerts,
        regions: {
          delhi_ncr: delhiNcrHotspots,
          india_supplementary: indiaHotspots,
        },
        lastDataUpdate: latestHotspot?.detectedAt || null,
        latestObservationMetadata: latestHotspot
          ? {
              satellite: latestHotspot.satellite,
              instrument: latestHotspot.instrument,
              version: latestHotspot.version,
            }
          : null,
        modelVersion: CURRENT_MODEL_METADATA.version,
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message },
    });
  }
});

/**
 * GET /api/v1/analytics/temporal-trend
 * Returns actual daily detection volume computed from MongoDB records.
 */
analyticsRoutes.get('/temporal-trend', async (req: Request, res: Response) => {
  try {
    const days = parseInt(req.query.days as string, 10) || 7;
    const sinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const trend = await Hotspot.aggregate([
      {
        $match: {
          detectedAt: { $gte: sinceDate },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$detectedAt' },
          },
          count: { $sum: 1 },
          meanFrp: { $avg: '$frp' },
          maxFrp: { $max: '$frp' },
        },
      },
      {
        $sort: { _id: 1 },
      },
    ]);

    res.json({
      success: true,
      data: {
        daysRequested: days,
        points: trend.map((t) => ({
          date: t._id,
          count: t.count,
          meanFrp: Number(t.meanFrp.toFixed(1)),
          maxFrp: Number(t.maxFrp.toFixed(1)),
        })),
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: { code: 'TREND_ERROR', message: error.message },
    });
  }
});

/**
 * GET /api/v1/analytics/hotspot-history/:id
 * Retrieves actual prior satellite overpasses within 1.5 km of the given hotspot.
 */
analyticsRoutes.get('/hotspot-history/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const target = await Hotspot.findById(id).lean();

    if (!target) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Hotspot not found' },
      });
    }

    const [lon, lat] = target.location.coordinates;

    // Find all observations within 1.5 km
    const history = await Hotspot.find({
      location: {
        $nearSphere: {
          $geometry: { type: 'Point', coordinates: [lon, lat] },
          $maxDistance: 1500,
        },
      },
    })
      .sort({ detectedAt: 1 })
      .select('detectedAt frp brightness satellite instrument dayNight location')
      .lean();

    const points = history.map((h) => ({
      hotspotId: h._id,
      detectedAt: h.detectedAt,
      frp: h.frp || 0,
      brightness: h.brightness || 0,
      satellite: h.satellite,
      instrument: h.instrument,
      dayNight: h.dayNight,
      distanceMeters: haversineMeters(
        lon,
        lat,
        h.location.coordinates[0],
        h.location.coordinates[1]
      ),
      isCurrentSelection: h._id.toString() === id,
    }));

    res.json({
      success: true,
      data: {
        hotspotId: id,
        totalHistoricalPasses: points.length,
        points,
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: { code: 'HISTORY_ERROR', message: error.message },
    });
  }
});
