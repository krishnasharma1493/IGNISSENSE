import { Router, Request, Response } from 'express';
import { ingestFirmsDelhiNcr, ingestFirmsIndia, ingestFirmsArea, ALL_LIVE_SENSORS } from './ingestion.service';
import { config } from '../../config';

export const ingestionRoutes = Router();

/**
 * POST /api/v1/ingestion/firms
 * Trigger live real-time FIRMS data ingestion from NASA satellites.
 *
 * Body (optional):
 *   scope: 'delhi_ncr' | 'india' (default: 'india')
 *   sensors: Array of FIRMS sensors (default: all 4 VIIRS + MODIS sensors)
 *   dayRange: 1-10 (default: 2)
 *   date: YYYY-MM-DD (optional)
 *   bbox: { west, south, east, north } (optional)
 */
ingestionRoutes.post('/firms', async (req: Request, res: Response) => {
  try {
    const { scope = 'india', sensors = ALL_LIVE_SENSORS, dayRange = 2, date, bbox } = req.body || {};

    if (!config.firms.apiKey) {
      return res.status(503).json({
        success: false,
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message:
            'FIRMS API key not configured. Set FIRMS_API_KEY in .env. Register at https://firms.modaps.eosdis.nasa.gov/api/map_key',
        },
      });
    }

    let result;

    if (bbox) {
      result = await ingestFirmsArea(bbox, { sensors, dayRange, date });
    } else if (scope === 'delhi_ncr') {
      result = await ingestFirmsDelhiNcr({ sensors, dayRange, date });
    } else {
      result = await ingestFirmsIndia({ sensors, dayRange, date });
    }

    res.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    console.error('[Ingestion] Error:', error.message);
    res.status(500).json({
      success: false,
      error: { code: 'INGESTION_ERROR', message: error.message },
    });
  }
});

/**
 * GET /api/v1/ingestion/status
 * Get the latest authentic FIRMS ingestion provenance and metadata.
 */
ingestionRoutes.get('/status', async (_req: Request, res: Response) => {
  try {
    const { getLatestIngestionStatus } = await import('./ingestion.service');
    const status = await getLatestIngestionStatus();
    res.json({
      success: true,
      data: status,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: { code: 'STATUS_ERROR', message: error.message },
    });
  }
});


