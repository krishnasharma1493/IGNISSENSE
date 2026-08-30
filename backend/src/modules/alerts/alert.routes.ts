import { Router, Request, Response } from 'express';
import { Alert } from './alert.model';

export const alertRoutes = Router();

/**
 * GET /api/v1/alerts
 * List alerts with optional severity, status, date filters.
 */
alertRoutes.get('/', async (req: Request, res: Response) => {
  try {
    const { severity, status, startDate, endDate, limit = '50' } = req.query;

    const filter: any = {};

    if (severity) filter.severity = severity;
    if (status) filter.status = status;

    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate as string);
      if (endDate) filter.createdAt.$lte = new Date(endDate as string);
    }

    const maxLimit = Math.min(parseInt(limit as string, 10) || 50, 200);

    const alerts = await Alert.find(filter)
      .sort({ createdAt: -1 })
      .limit(maxLimit)
      .populate('hotspotId')
      .lean();

    res.json({
      success: true,
      data: {
        alerts,
        count: alerts.length,
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
 * PATCH /api/v1/alerts/:id
 * Update status of an alert (open, acknowledged, resolved).
 */
alertRoutes.patch('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['open', 'acknowledged', 'resolved'].includes(status)) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid status value. Must be open, acknowledged, or resolved.' },
      });
      return;
    }

    const alert = await Alert.findByIdAndUpdate(
      id,
      { status },
      { new: true }
    ).populate('hotspotId');

    if (!alert) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Alert not found' },
      });
      return;
    }

    res.json({
      success: true,
      data: alert,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message },
    });
  }
});

