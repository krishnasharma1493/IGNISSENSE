import { Router, Request, Response } from 'express';
import { Classification } from './classification.model';

export const classificationRoutes = Router();

/**
 * GET /api/v1/classifications
 * List classifications (bulk endpoint for map rendering)
 */
classificationRoutes.get('/', async (req: Request, res: Response) => {
  try {
    const { hotspotIds, limit = '2000' } = req.query;
    const filter: any = {};

    if (hotspotIds && typeof hotspotIds === 'string') {
      const ids = hotspotIds.split(',').filter(Boolean);
      filter.hotspotId = { $in: ids };
    }

    const maxLimit = Math.min(parseInt(limit as string, 10) || 2000, 5000);
    const classifications = await Classification.find(filter)
      .limit(maxLimit)
      .lean();

    res.json({
      success: true,
      data: {
        classifications,
        count: classifications.length,
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
 * GET /api/v1/classifications/:hotspotId
 * Get the classification result for a specific hotspot.
 */
classificationRoutes.get('/:hotspotId', async (req: Request, res: Response) => {
  try {
    const classification = await Classification.findOne({
      hotspotId: req.params.hotspotId,
    })
      .populate('nearestFacilityId')
      .lean();

    if (!classification) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Classification not found for this hotspot',
        },
      });
    }

    res.json({ success: true, data: classification });
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
