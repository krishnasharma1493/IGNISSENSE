import { Router, Request, Response } from 'express';
import { OsmFeature } from './osmFeature.model';
import { OsmTile } from './osmTile.model';
import { Facility } from '../facilities/facility.model';
import { enrichHotspot, haversineMeters } from './enrichment.service';
import {
  fetchTileFromOverpass,
  normalizeOsmElement,
  NormalizedOsmFeature,
} from './osmExtractor';
import {
  runIndiaOsmExtraction,
  generateReport,
  getFailedTilesSummary,
} from './osmExtractor.service';

export const osmRoutes = Router();

/**
 * GET /api/v1/osm/report
 * Get the current extraction report (feature counts, tile status, etc.)
 */
osmRoutes.get('/report', async (_req: Request, res: Response) => {
  try {
    const report = await generateReport();
    res.json({ success: true, data: report });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: { code: 'REPORT_ERROR', message: error.message },
    });
  }
});

/**
 * GET /api/v1/osm/tiles
 * List tile extraction statuses.
 */
osmRoutes.get('/tiles', async (req: Request, res: Response) => {
  try {
    const { status } = req.query;
    const filter: any = {};
    if (status) filter.status = status;

    const tiles = await OsmTile.find(filter)
      .sort({ tileId: 1 })
      .lean();

    res.json({
      success: true,
      data: {
        tiles,
        count: tiles.length,
        summary: {
          pending: tiles.filter((t) => t.status === 'pending').length,
          in_progress: tiles.filter((t) => t.status === 'in_progress').length,
          completed: tiles.filter((t) => t.status === 'completed').length,
          failed: tiles.filter((t) => t.status === 'failed').length,
        },
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: { code: 'TILES_ERROR', message: error.message },
    });
  }
});

/**
 * GET /api/v1/osm/tiles/failed
 * Get details of failed tiles for debugging.
 */
osmRoutes.get('/tiles/failed', async (_req: Request, res: Response) => {
  try {
    const failed = await getFailedTilesSummary();
    res.json({ success: true, data: { failed, count: failed.length } });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: { code: 'FAILED_TILES_ERROR', message: error.message },
    });
  }
});

/**
 * GET /api/v1/osm/features/nearby
 * Query nearby OSM features for a given coordinate.
 * Query params: longitude, latitude, radius (meters, default 5000), category (optional)
 */
osmRoutes.get('/features/nearby', async (req: Request, res: Response) => {
  try {
    const { longitude, latitude, radius = '5000', category, limit = '50' } = req.query;

    if (!longitude || !latitude) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_REQUEST', message: 'longitude and latitude are required' },
      });
    }

    const lng = parseFloat(longitude as string);
    const lat = parseFloat(latitude as string);
    const rad = parseFloat(radius as string);
    const maxLimit = Math.min(parseInt(limit as string, 10) || 50, 200);

    if (isNaN(lng) || isNaN(lat) || isNaN(rad)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_REQUEST', message: 'Invalid coordinate or radius values' },
      });
    }

    const filter: any = {
      geometry: {
        $nearSphere: {
          $geometry: { type: 'Point', coordinates: [lng, lat] },
          $maxDistance: rad,
        },
      },
    };

    if (category) {
      filter.featureCategory = category;
    }

    const features = await OsmFeature.find(filter)
      .limit(maxLimit)
      .select('-tags') // Exclude raw tags in list view for performance
      .lean();

    let formattedFeatures: any[] = features.map((f) => ({
      ...f,
      distance_m: haversineMeters(lng, lat, f.longitude, f.latitude),
    }));

    if (formattedFeatures.length === 0) {
      // Fallback to legacy Facility collection if osm_features has no hits in this area
      const legacyFacilities = await Facility.find({
        location: {
          $nearSphere: {
            $geometry: { type: 'Point', coordinates: [lng, lat] },
            $maxDistance: rad,
          },
        },
      })
        .limit(maxLimit)
        .lean();

      if (legacyFacilities.length > 0) {
        formattedFeatures = legacyFacilities.map((fac) => {
          const [fLng, fLat] = fac.location.coordinates;
          return {
            _id: fac._id,
            sourceId: fac.sourceId,
            osmId: fac.osmId,
            osmType: fac.sourceType || 'node',
            name: fac.name,
            featureCategory: 'industrial',
            featureSubcategory: fac.facilityType,
            geometry: fac.location,
            latitude: fLat,
            longitude: fLng,
            distance_m: haversineMeters(lng, lat, fLng, fLat),
            source: 'OpenStreetMap',
            region: fac.region,
          };
        });
      } else {
        // Fast targeted on-demand fetch for this anomaly's surrounding area (~20km bbox)
        try {
          const delta = Math.min((rad / 111000) * 1.1, 0.25);
          const bbox = {
            south: Number((lat - delta).toFixed(4)),
            west: Number((lng - delta).toFixed(4)),
            north: Number((lat + delta).toFixed(4)),
            east: Number((lng + delta).toFixed(4)),
          };
          const tileId = `ondemand_${bbox.south}_${bbox.west}`;
          const { elements } = await fetchTileFromOverpass(bbox, 1);
          const normalized = elements
            .map((el) => normalizeOsmElement(el, tileId))
            .filter((f): f is NormalizedOsmFeature => f !== null);

          if (normalized.length > 0) {
            const ops = normalized.map((feat) => ({
              updateOne: {
                filter: { sourceId: feat.sourceId },
                update: { $set: feat },
                upsert: true,
              },
            }));
            await OsmFeature.bulkWrite(ops as any, { ordered: false });

            // Re-query from indexed local collection
            const newlySaved = await OsmFeature.find(filter).limit(maxLimit).lean();
            formattedFeatures = newlySaved.map((f) => ({
              ...f,
              distance_m: haversineMeters(lng, lat, f.longitude, f.latitude),
            }));
          }
        } catch (onDemandErr: any) {
          console.warn(`[OSM On-Demand] ${onDemandErr.message}`);
        }
      }
    }

    // Sort by distance ascending
    formattedFeatures.sort((a, b) => (a.distance_m || 0) - (b.distance_m || 0));

    res.json({
      success: true,
      data: {
        features: formattedFeatures,
        count: formattedFeatures.length,
        query: { longitude: lng, latitude: lat, radius: rad, category: category || 'all' },
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: { code: 'NEARBY_ERROR', message: error.message },
    });
  }
});

/**
 * GET /api/v1/osm/enrich
 * Enrich a coordinate pair with full spatial context.
 * Query params: longitude, latitude
 */
osmRoutes.get('/enrich', async (req: Request, res: Response) => {
  try {
    const { longitude, latitude } = req.query;

    if (!longitude || !latitude) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_REQUEST', message: 'longitude and latitude are required' },
      });
    }

    const lng = parseFloat(longitude as string);
    const lat = parseFloat(latitude as string);

    if (isNaN(lng) || isNaN(lat)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_REQUEST', message: 'Invalid coordinates' },
      });
    }

    const enrichment = await enrichHotspot(lng, lat);
    res.json({ success: true, data: enrichment });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: { code: 'ENRICHMENT_ERROR', message: error.message },
    });
  }
});

/**
 * POST /api/v1/osm/extract
 * Trigger India-wide OSM extraction.
 * Body (optional): { retryFailed: boolean, specificTiles: string[] }
 *
 * NOTE: This is a long-running operation (~60-90 min for full India).
 * It runs in the background and returns immediately with an acknowledgment.
 */
osmRoutes.post('/extract', async (req: Request, res: Response) => {
  try {
    const { retryFailed, specificTiles } = req.body || {};

    // Start extraction in background (don't await)
    runIndiaOsmExtraction({ retryFailed, specificTiles }).catch((err) => {
      console.error('[OSM Extract API] Background extraction error:', err.message);
    });

    res.json({
      success: true,
      data: {
        message: 'India-wide OSM extraction started in background',
        retryFailed: !!retryFailed,
        specificTiles: specificTiles || null,
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: { code: 'EXTRACT_ERROR', message: error.message },
    });
  }
});

/**
 * POST /api/v1/osm/extract/retry
 * Retry only failed tiles.
 */
osmRoutes.post('/extract/retry', async (_req: Request, res: Response) => {
  try {
    runIndiaOsmExtraction({ retryFailed: true }).catch((err) => {
      console.error('[OSM Extract API] Background retry error:', err.message);
    });

    res.json({
      success: true,
      data: { message: 'Retrying failed OSM extraction tiles in background' },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: { code: 'RETRY_ERROR', message: error.message },
    });
  }
});
