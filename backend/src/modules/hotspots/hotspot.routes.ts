import { Router, Request, Response } from 'express';
import { Hotspot } from './hotspot.model';

export const hotspotRoutes = Router();

/**
 * GET /api/v1/hotspots
 * Query hotspots with filters: startDate, endDate, minConfidence,
 * class, bbox, limit, region
 */
hotspotRoutes.get('/', async (req: Request, res: Response) => {
  try {
    const {
      startDate,
      endDate,
      minConfidence,
      bbox,
      limit = '100',
      region,
    } = req.query;

    const filter: any = {};

    // Date range
    if (startDate || endDate) {
      filter.detectedAt = {};
      if (startDate) filter.detectedAt.$gte = new Date(startDate as string);
      if (endDate) filter.detectedAt.$lte = new Date(endDate as string);
    }

    // Confidence filter
    if (minConfidence) {
      // VIIRS confidence is string ('low','nominal','high'), so we filter by enum order
      const confOrder = ['low', 'nominal', 'high'];
      const minIdx = confOrder.indexOf(minConfidence as string);
      if (minIdx >= 0) {
        filter.confidence = { $in: confOrder.slice(minIdx) };
      }
    }

    // Region filter
    if (region) {
      filter.region = region;
    }

    // Bounding box: west,south,east,north
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

    const maxLimit = Math.min(parseInt(limit as string, 10) || 100, 1000);

    const hotspots = await Hotspot.find(filter)
      .sort({ detectedAt: -1 })
      .limit(maxLimit)
      .lean();

    res.json({
      success: true,
      data: {
        hotspots,
        count: hotspots.length,
        filters: { startDate, endDate, minConfidence, bbox, region, limit: maxLimit },
      },
    });
  } catch (error: any) {
    console.error('[Hotspots] List error:', error.message);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message },
    });
  }
});

/**
 * GET /api/v1/hotspots/:id
 * Get complete hotspot details by ID.
 */
hotspotRoutes.get('/:id', async (req: Request, res: Response) => {
  try {
    const hotspot = await Hotspot.findById(req.params.id).lean();

    if (!hotspot) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Hotspot not found' },
      });
    }

    res.json({ success: true, data: hotspot });
  } catch (error: any) {
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_ID', message: 'Invalid hotspot ID format' },
      });
    }
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message },
    });
  }
});
