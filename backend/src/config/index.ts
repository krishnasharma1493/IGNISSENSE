import dotenv from 'dotenv';
dotenv.config();

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '5000', 10),
  demoMode: process.env.DEMO_MODE === 'true',

  // When false (default) the server refuses to start rather than silently
  // serving an in-memory database as if it were live data.
  allowEphemeralDb: process.env.ALLOW_EPHEMERAL_DB === 'true',

  // MongoDB
  mongodbUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/sih26162',

  // CORS
  clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173').split(','),

  // NASA FIRMS
  firms: {
    apiKey: process.env.FIRMS_MAP_KEY || process.env.FIRMS_API_KEY || '',
    baseUrl: process.env.FIRMS_API_BASE_URL || 'https://firms.modaps.eosdis.nasa.gov',
  },


  // Overpass (OSM)
  osm: {
    overpassUrl: process.env.OSM_OVERPASS_URL || 'https://overpass-api.de/api/interpreter',
  },

  // ML inference
  modelServiceUrl: process.env.MODEL_SERVICE_URL || 'http://localhost:8000',

  // Delhi NCR bounding box (west, south, east, north)
  delhiNcr: {
    bbox: {
      west: 76.8,
      south: 28.3,
      east: 77.6,
      north: 28.9,
    },
    center: {
      longitude: 77.2,
      latitude: 28.6,
    },
  },
} as const;
