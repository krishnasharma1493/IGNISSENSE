import { Router, Request, Response } from 'express';
import { reverseGeocode } from './geocode.service';

export const geocodeRoutes = Router();

geocodeRoutes.get('/reverse', async (req: Request, res: Response) => {
  const lat = parseFloat(String(req.query.lat));
  const lon = parseFloat(String(req.query.lon));

  if (!Number.isFinite(lat) || !Number.isFinite(lon) ||
      lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_COORDINATES', message: 'lat and lon must be valid coordinates' },
    });
  }

  try {
    res.json({ success: true, data: await reverseGeocode(lat, lon) });
  } catch (err: any) {
    res.status(502).json({
      success: false,
      error: { code: 'GEOCODE_UNAVAILABLE', message: err.message },
    });
  }
});
