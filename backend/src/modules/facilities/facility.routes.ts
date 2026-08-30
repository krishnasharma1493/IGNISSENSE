import { Router, Request, Response } from 'express';
import { Facility } from './facility.model';

export const facilityRoutes = Router();

/**
 * GET /api/v1/facilities
 * List facilities with optional bbox and facilityType filters.
 */
facilityRoutes.get('/', async (req: Request, res: Response) => {
  try {
    const { bbox, facilityType, region, limit = '500' } = req.query;

    const filter: any = {};

    if (facilityType) {
      filter.facilityType = facilityType;
    }

    if (region) {
      filter.region = region;
    }

    if (bbox) {
      const parts = (bbox as string).split(',').map(Number);
      if (parts.length === 4 && parts.every((n) => !isNaN(n))) {
        const [west, south, east, north] = parts;
        filter.location = {
          $geoWithin: {
            $box: [
              [west, south],
              [east, north],
            ],
          },
        };
      }
    }

    const maxLimit = Math.min(parseInt(limit as string, 10) || 500, 2000);

    const facilities = await Facility.find(filter).limit(maxLimit).lean();

    res.json({
      success: true,
      data: {
        facilities,
        count: facilities.length,
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
 * GET /api/v1/facilities/nearby
 * Find facilities near a given point within a radius.
 * Query params: longitude, latitude, radius (meters, default 5000)
 */
facilityRoutes.get('/nearby', async (req: Request, res: Response) => {
  try {
    const { longitude, latitude, radius = '5000' } = req.query;

    if (!longitude || !latitude) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'longitude and latitude are required',
        },
      });
    }

    const lng = parseFloat(longitude as string);
    const lat = parseFloat(latitude as string);
    const rad = parseFloat(radius as string);

    if (isNaN(lng) || isNaN(lat) || isNaN(rad)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_REQUEST', message: 'Invalid coordinate or radius values' },
      });
    }

    if (lng < -180 || lng > 180 || lat < -90 || lat > 90) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_REQUEST', message: 'Coordinates out of valid range' },
      });
    }

    const facilities = await Facility.find({
      location: {
        $nearSphere: {
          $geometry: {
            type: 'Point',
            coordinates: [lng, lat],
          },
          $maxDistance: rad, // meters
        },
      },
    }).lean();

    res.json({
      success: true,
      data: {
        facilities,
        count: facilities.length,
        query: { longitude: lng, latitude: lat, radius: rad },
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
 * POST /api/v1/facilities/sync-osm
 * Trigger live OpenStreetMap Overpass ingestion for Delhi NCR.
 */
facilityRoutes.post('/sync-osm', async (_req: Request, res: Response) => {
  try {
    const { syncDelhiNcrOsmFacilities } = await import('./facility.service');
    const result = await syncDelhiNcrOsmFacilities();
    res.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: { code: 'OSM_SYNC_FAILED', message: error.message },
    });
  }
});
