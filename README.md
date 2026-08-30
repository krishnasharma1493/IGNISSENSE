# SIH 26162 — AI-Based Detection and Classification of Industrial Fires

**Smart India Hackathon 2026 | Problem Statement 26162**

An AI-enabled GIS platform that classifies satellite-detected thermal hotspots (NASA FIRMS) into industrial fires, gas flares, wildfires, agricultural burning, mining thermal activity, and uncertain sources — with persistence analysis, anomaly detection, and explainable geospatial visualization.

## Geographic Scope

- **Country:** India
- **Primary Demo Region:** Delhi NCR (Delhi, Gurugram, Noida, Ghaziabad, Faridabad)

## Architecture

```
FIRMS thermal anomaly
→ geospatial/context enrichment (OSM + land cover)
→ feature engineering (thermal + spatial + temporal)
→ ML classification (XGBoost)
→ persistence/anomaly analysis
→ MongoDB storage
→ Express API
→ React + MapLibre GIS dashboard
```

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React + TypeScript + Vite + MapLibre GL JS |
| Backend | Node.js + Express + TypeScript |
| Database | MongoDB Atlas |
| ML | Python + XGBoost |
| API Testing | Postman |

## Project Structure

```
├── frontend/          # React + Vite + MapLibre
├── backend/           # Express + MongoDB
├── ml/                # Python ML pipeline
├── docs/              # Documentation
└── tests/             # Integration tests
```

## Getting Started

### Prerequisites

- Node.js >= 18
- Python >= 3.10
- MongoDB Atlas account (free tier)
- NASA FIRMS MAP_KEY (free — https://firms.modaps.eosdis.nasa.gov/api/map_key)

### Backend

```bash
cd backend
cp .env.example .env
# Edit .env with your MongoDB URI and FIRMS API key
npm install
npm run dev
```

### Frontend

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

### ML Pipeline

```bash
cd ml
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

## License

This project is developed for SIH 2026 demonstration purposes.
