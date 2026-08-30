import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config } from './config';
import { hotspotRoutes } from './modules/hotspots/hotspot.routes';
import { facilityRoutes } from './modules/facilities/facility.routes';
import { classificationRoutes } from './modules/classifications/classification.routes';
import { alertRoutes } from './modules/alerts/alert.routes';
import { ingestionRoutes } from './modules/ingestion/ingestion.routes';
import { analyticsRoutes } from './modules/analytics/analytics.routes';

const app = express();

// -- Middleware --

app.use(helmet());

app.use(
  cors({
    origin: config.corsOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    credentials: true,
  })
);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting for public endpoints
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500,
  message: {
    success: false,
    error: { code: 'RATE_LIMIT', message: 'Too many requests, please try again later' },
  },
});
app.use('/api/', limiter);

// -- Health Check --

app.get('/api/v1/health', (_req, res) => {
  res.json({
    success: true,
    data: {
      status: 'ok',
      service: 'SIH 26162 - Industrial Fire Detection',
      timestamp: new Date().toISOString(),
      environment: config.env,
    },
  });
});

import { systemRoutes } from './modules/system/system.routes';

// -- API Routes --

app.use('/api/v1/system', systemRoutes);
app.use('/api/v1/hotspots', hotspotRoutes);
app.use('/api/v1/facilities', facilityRoutes);
app.use('/api/v1/classifications', classificationRoutes);
app.use('/api/v1/alerts', alertRoutes);
app.use('/api/v1/ingestion', ingestionRoutes);
app.use('/api/v1/analytics', analyticsRoutes);


// -- 404 Handler --

app.use((_req, res) => {
  res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: 'Endpoint not found' },
  });
});

// -- Error Handler --

app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error('[App] Unhandled error:', err.message);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: config.env === 'production' ? 'Internal server error' : err.message,
      },
    });
  }
);

export default app;
