# SIH 2026 FULL-STACK PROJECT BLUEPRINT & MASTER PROMPT

## AI-Based Detection and Classification of Industrial Fires and Persistent Thermal Sources Using NASA FIRMS, OSM & Satellite Data

**SIH Problem Statement:** 26162  
**Event:** Smart India Hackathon 2026  
**Project Type:** AI + GIS + Full-Stack Web Application  
**Audience:** Student development team, AI coding assistants, ML/data developers, backend developers, frontend developers, GIS developers, testers  
**Primary Purpose:** Single source of truth for building the complete SIH MVP

---

# 0. SIH PROJECT CONTEXT

## 0.1 Problem

Satellite thermal anomaly systems such as NASA FIRMS identify locations where thermal activity is detected.

However:

```text
Thermal anomaly detected
≠
Industrial fire confirmed
```

A thermal hotspot may represent:

- industrial fire
- gas flare
- wildfire
- agricultural burning
- mining-related thermal activity
- another/uncertain thermal source

The SIH solution must use contextual information to classify and segregate these events, with particular emphasis on distinguishing industrial fires from forest and other natural fires.

---

# 0.2 Product Objective

Build an AI-enabled GIS platform that:

```text
NASA FIRMS
+
Historical Thermal Behaviour
+
OpenStreetMap Industrial Context
+
Land Cover
+
Spatial Relationships
+
Optional Satellite Context
        ↓
Feature Engineering
        ↓
ML Classification
        ↓
Persistence + Anomaly Analysis
        ↓
MongoDB
        ↓
API
        ↓
Interactive GIS Dashboard
```

The product must answer:

1. Where is the thermal event?
2. What type of event is it?
3. How confident is the classification?
4. Why was it classified that way?
5. Is the source persistent or anomalous?
6. Is there relevant industrial infrastructure nearby?

---

# 0.3 Core SIH Classification Classes

The MVP must support:

```text
industrial_fire
gas_flare
wildfire
agricultural_burning
mining_thermal_activity
other_or_uncertain
```

The `other_or_uncertain` class is mandatory.

The system must not force an unreliable classification simply to produce a label.

---

# 0.4 What This Project Is Not

Do not turn the project into:

- an emergency dispatch platform
- an industrial control system
- a fire-control system
- an enterprise disaster-management suite
- a mobile application
- an authentication-heavy SaaS application
- a microservices platform
- a Kubernetes deployment
- a production-scale global monitoring company

This is an **SIH demonstration-oriented AI + GIS decision-support system**.

---

# 1. VERSION & IMPLEMENTATION SAFETY RULES

Dependency versions in this document are not authoritative.

Before installing or modifying dependencies:

1. Search the official package source/documentation.
2. Verify the currently supported version.
3. Check compatibility with the selected Node.js/Python runtime.
4. Check current security advisories.
5. Never blindly copy a version from an old prompt or tutorial.
6. Run the project's dependency/security checks after installation.

For AI coding assistants:

- do not invent APIs
- do not invent package names
- do not invent dataset fields
- do not invent FIRMS endpoints
- do not invent OSM query structures
- do not invent model accuracy
- do not invent benchmark results
- do not replace project requirements with generic architecture

When uncertain about an external API, verify the current official documentation before coding.

---

# 2. TECHNOLOGY STACK

## 2.1 Frontend

| Layer | Technology |
|---|---|
| Framework | React |
| Language | TypeScript |
| Build Tool | Vite |
| GIS | MapLibre GL JS |
| Charts | Recharts or equivalent verified library |
| Server State | TanStack Query |
| HTTP Client | Axios or fetch |
| Validation | Zod |

---

## 2.2 Backend

| Layer | Technology |
|---|---|
| Runtime | Node.js |
| Framework | Express |
| Language | TypeScript |
| Validation | Zod |
| Database Driver | MongoDB Node.js Driver or Mongoose |
| API Testing | Postman |

Python is reserved for the ML/data-processing pipeline if required.

---

## 2.3 Database

**MongoDB Atlas**

Use MongoDB geospatial capabilities for:

- hotspot locations
- facility locations
- spatial filtering
- nearby facility searches
- historical event queries

Geospatial collections should use `2dsphere` indexes.

---

## 2.4 Machine Learning

Primary model:

**XGBoost multiclass classifier**

Supporting tooling may include:

- Python
- Pandas
- NumPy
- scikit-learn
- XGBoost
- SHAP where useful

The ML layer may be exposed to the Node backend through:

- a Python inference service, or
- an offline/precomputed inference pipeline,

depending on the final team architecture.

Keep the integration simple.

---

# 3. MCP CONFIGURATION

The project should support the following MCP setup for development and AI-assisted workflows.

```json
{
  "mcpServers": {
    "MongoDB": {
      "command": "npx",
      "args": [
        "-y",
        "mongodb-mcp-server",
        "--connectionString",
        "mongodb+srv://<username>:<password>@<cluster>.mongodb.net/<dbname>"
      ]
    },
    "Postman": {
      "url": "https://mcp.postman.com/mcp"
    }
  }
}
```

## MCP rules

### MongoDB MCP

Use MongoDB MCP for:

- inspecting collections
- checking stored hotspot records
- inspecting classification outputs
- validating indexes
- debugging geospatial queries
- inspecting demo data
- validating database state

Never expose the real MongoDB password in AI prompts.

Use environment variables or secure MCP configuration.

### Postman MCP

Use Postman MCP for:

- creating/updating API collections
- testing endpoints
- validating request/response contracts
- running API test cases
- checking error responses
- maintaining the team's API workflow

Postman should remain the team's shared API source of truth.

---

# 4. REPOSITORY STRUCTURE

Use a simple monorepo.

```text
IndustrialFireDetection/
│
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── features/
│   │   │   ├── dashboard/
│   │   │   ├── map/
│   │   │   ├── hotspots/
│   │   │   ├── alerts/
│   │   │   └── analytics/
│   │   ├── pages/
│   │   ├── hooks/
│   │   ├── lib/
│   │   ├── api/
│   │   └── types/
│   ├── public/
│   ├── .env.example
│   └── package.json
│
├── backend/
│   ├── src/
│   │   ├── config/
│   │   ├── middleware/
│   │   ├── modules/
│   │   │   ├── hotspots/
│   │   │   ├── facilities/
│   │   │   ├── classifications/
│   │   │   ├── alerts/
│   │   │   ├── ingestion/
│   │   │   └── analytics/
│   │   ├── services/
│   │   ├── utils/
│   │   ├── app.ts
│   │   └── server.ts
│   ├── postman/
│   │   ├── collection.json
│   │   └── environment.json
│   ├── .env.example
│   └── package.json
│
├── ml/
│   ├── data/
│   │   ├── raw/
│   │   ├── processed/
│   │   └── demo/
│   ├── notebooks/
│   ├── src/
│   │   ├── ingestion/
│   │   ├── preprocessing/
│   │   ├── features/
│   │   ├── labeling/
│   │   ├── training/
│   │   ├── evaluation/
│   │   └── inference/
│   ├── models/
│   └── requirements.txt
│
├── docs/
│   ├── PRD.md
│   ├── API.md
│   ├── ML.md
│   └── DATA.md
│
├── tests/
├── .gitignore
├── .cursorignore
└── README.md
```

Do not add folders merely because they exist in generic templates.

---

# 5. ENVIRONMENT VARIABLES

## Backend

```env
NODE_ENV=development
PORT=5000

MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>/<database>

CLIENT_URL=http://localhost:5173

CORS_ORIGINS=http://localhost:5173

FIRMS_API_KEY=<your_key>
FIRMS_API_BASE_URL=<verified_official_endpoint>

OSM_API_BASE_URL=<verified_endpoint>

MODEL_SERVICE_URL=http://localhost:<verified_port>
```

Only include variables that are actually used by the implementation.

---

## Frontend

```env
VITE_API_BASE_URL=http://localhost:5000
VITE_MAP_STYLE_URL=<verified_map_style>
```

Never put private API secrets in `VITE_*` variables.

---

# 6. DATABASE DESIGN

MongoDB collections:

```text
hotspots
facilities
classifications
alerts
historical_metrics
model_metadata
```

---

## 6.1 Hotspot Document

Conceptual structure:

```json
{
  "_id": "ObjectId",
  "source": "FIRMS",
  "location": {
    "type": "Point",
    "coordinates": [77.1, 28.6]
  },
  "detectedAt": "ISO timestamp",
  "frp": 125.4,
  "brightness": 341.2,
  "confidence": 85,
  "dayNight": "N",
  "satellite": "VIIRS",
  "ingestedAt": "ISO timestamp"
}
```

Coordinates must follow GeoJSON order:

```text
[longitude, latitude]
```

---

# 6.2 Facility Document

```json
{
  "_id": "ObjectId",
  "source": "OSM",
  "sourceId": "osm_identifier",
  "name": "Facility Name",
  "facilityType": "refinery",
  "location": {
    "type": "Point",
    "coordinates": [77.1, 28.6]
  }
}
```

---

# 6.3 Classification Document

```json
{
  "_id": "ObjectId",
  "hotspotId": "ObjectId",
  "predictedClass": "industrial_fire",
  "confidence": 0.87,
  "classProbabilities": {
    "industrial_fire": 0.87,
    "gas_flare": 0.06,
    "wildfire": 0.03,
    "agricultural_burning": 0.02,
    "mining_thermal_activity": 0.01,
    "other_or_uncertain": 0.01
  },
  "persistenceScore": 0.18,
  "anomalyScore": 0.84,
  "nearestFacilityId": "ObjectId",
  "facilityDistanceMeters": 80,
  "landCover": "built_up",
  "explanation": [],
  "modelVersion": "xgb-v1",
  "createdAt": "ISO timestamp"
}
```

---

# 6.4 Alert Document

```json
{
  "_id": "ObjectId",
  "hotspotId": "ObjectId",
  "severity": "high",
  "reason": "High anomaly near industrial facility",
  "status": "open",
  "createdAt": "ISO timestamp"
}
```

---

# 6.5 Required MongoDB Indexes

Use geospatial indexes for:

```text
hotspots.location
facilities.location
```

Add supporting indexes for:

```text
hotspots.detectedAt
classifications.hotspotId
classifications.predictedClass
alerts.status
```

Use additional compound indexes only after actual query patterns justify them.

---

# 7. DATA PIPELINE

```text
FIRMS
 ↓
Raw Data
 ↓
Validation
 ↓
Normalization
 ↓
Historical Storage
 ↓
OSM Enrichment
 ↓
Land-Cover Enrichment
 ↓
Feature Engineering
 ↓
ML Classification
 ↓
Persistence Analysis
 ↓
Anomaly Analysis
 ↓
MongoDB
 ↓
API
 ↓
GIS Dashboard
```

---

# 8. FIRMS REQUIREMENTS

FIRMS is the primary thermal anomaly data source.

The implementation must use the currently verified FIRMS access method.

Potential fields include:

```text
latitude
longitude
acquisition date
acquisition time
FRP
brightness
confidence
day/night
satellite
sensor
```

Do not assume every field is available across every FIRMS product.

The ingestion layer must normalize available FIRMS sources into the internal hotspot schema.

---

# 9. OSM REQUIREMENTS

OSM provides contextual information about nearby infrastructure.

Relevant categories may include:

```text
refinery
power plant
industrial facility
mine
oil/gas facility
industrial area
LNG-related infrastructure
```

The team must define the actual OSM tags used.

Do not label a facility category merely because its name "sounds industrial."

---

# 10. LAND-COVER REQUIREMENTS

The system should support broad contextual categories:

```text
forest
cropland
built_up
bare
water
other
```

Land cover is a contextual feature.

It must not independently determine the final classification.

---

# 11. FEATURE ENGINEERING

## Thermal

```text
FRP
brightness temperature
confidence
day/night
sensor
```

## Spatial

```text
distance to nearest facility
facility type
industrial area indicator
nearby hotspot count
cluster size
distance to known flare where available
```

## Land Cover

```text
land-cover class
forest indicator
cropland indicator
built-up indicator
vegetation indicator
```

## Temporal

```text
7-day recurrence
30-day recurrence
90-day recurrence
days since previous detection
historical FRP mean
historical FRP variance
FRP deviation from baseline
```

---

# 12. MACHINE LEARNING REQUIREMENTS

## Primary Model

Use:

```text
XGBoost Multiclass Classifier
```

Input:

```text
Thermal
+
Spatial
+
Land Cover
+
Temporal
```

Output:

```text
predicted class
class probabilities
confidence
```

---

# 13. TRAINING LABEL STRATEGY

The model may initially require weak supervision because comprehensive verified per-hotspot ground truth may not exist.

Possible label sources:

```text
known industrial facilities
known flare locations
forest fire regions
cropland burning regions
mining regions
manually reviewed samples
historical patterns
```

The training documentation must explicitly state which labels are:

```text
verified
weakly labelled
heuristically generated
manually reviewed
```

Never report weak-label training performance as independent real-world validation.

---

# 14. CLASSIFICATION LOGIC

The classifier must use multiple signals.

Bad implementation:

```text
distance_to_industry < threshold
→ industrial_fire
```

Required:

```text
thermal evidence
+
industrial context
+
land cover
+
historical behaviour
+
spatial behaviour
+
facility context
→
ML classification
```

---

# 15. INDUSTRIAL FIRE DETECTION

The system should identify candidate industrial fires using evidence such as:

- proximity to industrial infrastructure
- abnormal thermal intensity
- sudden appearance
- FRP deviation from historical behaviour
- industrial/built-up land cover
- lack of strong recurring flare pattern
- event clustering behaviour where relevant

Proximity alone must never be sufficient.

---

# 16. GAS FLARE DETECTION

Potential signals:

- industrial/oil-gas context
- repeated observations
- stable geographic position
- relatively consistent thermal output
- strong recurrence

A persistent industrial hotspot should not automatically become an emergency alert.

---

# 17. WILDFIRE DETECTION

Potential signals:

- forest/vegetation land cover
- spatial clustering
- spreading behaviour
- absence of relevant industrial infrastructure
- temporal fire patterns

---

# 18. AGRICULTURAL BURNING DETECTION

Potential signals:

- cropland
- seasonal timing
- repeated agricultural context
- absence of meaningful industrial relationship

---

# 19. MINING THERMAL ACTIVITY

Potential signals:

- mining land/use context
- nearby mining facility
- recurring activity
- spatial relationship with extraction areas

This class can be simplified or merged with `other_or_uncertain` if available training evidence is insufficient.

---

# 20. OTHER / UNCERTAIN

The system must support uncertainty.

A prediction may be classified as:

```text
other_or_uncertain
```

when:

- confidence is low
- features conflict
- contextual data is missing
- multiple classes have similar probabilities
- the event is outside the training distribution

---

# 21. PERSISTENCE ANALYSIS

Calculate persistence from:

```text
recurrence
+
location stability
+
historical duration
+
thermal consistency
```

Persistency must be independent from classification.

Output:

```text
low
medium
high
```

or an equivalent numerical score.

---

# 22. ANOMALY ANALYSIS

The system must compare current activity with historical behaviour.

Potential indicators:

```text
FRP deviation
new location
unexpected recurrence change
unusual clustering
industrial-context anomaly
```

Output:

```text
anomaly score
```

and optionally:

```text
low
medium
high
```

---

# 23. PERSISTENCE VS ANOMALY

Do not combine these into a single metric.

Examples:

```text
Persistent + Normal
Persistent + Anomalous
New + Anomalous
New + Low Anomaly
```

These describe different properties.

---

# 24. EXPLAINABILITY

Every classification must provide evidence.

Example:

```text
Classification:
Industrial Fire

Confidence:
87%

Evidence:
• Nearby refinery
• 80 m facility distance
• FRP significantly above historical baseline
• Low recurrence
• Built-up land cover
```

The explanation must be generated from the actual feature values.

Do not hard-code generic explanations.

---

# 25. BACKEND ARCHITECTURE

```text
backend/src/

config/
middleware/
modules/
services/
utils/
app.ts
server.ts
```

Each major module should follow:

```text
routes
controller
service
schema
model
```

Where model complexity requires it.

---

# 26. BACKEND MODULES

## Hotspots

Responsible for:

- querying hotspots
- filters
- geographic bounds
- details

## Facilities

Responsible for:

- industrial facility retrieval
- nearby facility queries

## Classifications

Responsible for:

- classification results
- probabilities
- explanation
- model metadata

## Ingestion

Responsible for:

- FIRMS ingestion
- normalization
- validation

## Analytics

Responsible for:

- persistence
- anomaly analysis
- summary statistics

## Alerts

Responsible for:

- high-priority candidate events

---

# 27. API DESIGN

Every endpoint must be documented in:

```text
Method
Path
Purpose
Request
Response
Validation
Error cases
Postman test
```

This follows the original blueprint's API documentation discipline, but is adapted here to the SIH resources rather than generic CRUD resources.

---

# 28. REQUIRED API ENDPOINTS

## GET `/api/v1/health`

Returns service status.

---

## GET `/api/v1/hotspots`

Query parameters:

```text
startDate
endDate
minConfidence
class
minAnomaly
minPersistence
bbox
limit
```

Returns hotspot summaries.

---

## GET `/api/v1/hotspots/:id`

Returns complete hotspot information.

---

## GET `/api/v1/facilities`

Supports:

```text
bbox
facilityType
```

---

## GET `/api/v1/facilities/nearby`

Inputs:

```text
longitude
latitude
radius
```

Returns nearby facilities.

---

## GET `/api/v1/classifications/:hotspotId`

Returns:

```text
predicted class
confidence
probabilities
persistence
anomaly
explanation
```

---

## GET `/api/v1/alerts`

Supports:

```text
severity
status
date
bbox
```

---

## POST `/api/v1/ingestion/firms`

Starts or triggers FIRMS ingestion.

---

## POST `/api/v1/classify`

Classifies an individual hotspot or prepared feature vector.

---

## GET `/api/v1/analytics/summary`

Returns:

```text
total hotspots
industrial fires
wildfires
gas flares
agricultural burning
mining activity
uncertain
persistent sources
anomalous sources
```

---

# 29. RESPONSE FORMAT

Success:

```json
{
  "success": true,
  "data": {}
}
```

Error:

```json
{
  "success": false,
  "error": {
    "code": "INVALID_REQUEST",
    "message": "Invalid coordinates"
  }
}
```

The same response contract must be used consistently.

---

# 30. FRONTEND ARCHITECTURE

The frontend is an analyst-style GIS dashboard.

Primary sections:

```text
Dashboard
Map
Hotspot Investigation
Alerts
Analytics
```

Do not create unnecessary pages.

---

# 31. DASHBOARD

Display:

```text
Total Hotspots
Industrial Fire Candidates
Gas Flares
Wildfires
Agricultural Burning
Mining Thermal Activity
Uncertain
Persistent Sources
Anomalous Sources
Last Data Update
```

---

# 32. GIS MAP

The map is the central product interface.

Required layers:

```text
Thermal Hotspots
Industrial Facilities
Optional Land Cover
Persistent Sources
Anomalous Sources
```

Hotspots must be visually distinguishable by classification.

---

# 33. MAP FILTERS

Required:

```text
Date
Classification
Confidence
Persistence
Anomaly
```

Optional:

```text
Facility Type
Land Cover
Region
```

---

# 34. HOTSPOT INVESTIGATION PANEL

When a hotspot is selected:

```text
Event Type
Confidence
FRP
Brightness
Detection Time
Coordinates

Nearest Facility
Facility Type
Facility Distance

Land Cover

Persistence
Anomaly

Historical Activity

Classification Evidence
```

---

# 35. HISTORICAL VIEW

Where data exists, show:

```text
detections over time
FRP over time
recurrence
historical baseline
current deviation
```

This view is especially important for distinguishing:

```text
gas flare
```

from:

```text
new industrial fire
```

---

# 36. ALERT VIEW

Show high-priority candidate events.

Each alert must provide:

```text
severity
classification
confidence
anomaly
facility context
reason
status
```

The UI must explicitly distinguish:

```text
AI candidate / decision support
```

from:

```text
confirmed incident
```

---

# 37. FRONTEND STATE MANAGEMENT

Use:

- TanStack Query for server state
- local component state for temporary UI state
- clear loading states
- clear error states
- cached query results where helpful

Avoid introducing global state libraries unless the UI actually requires one.

---

# 38. GIS PERFORMANCE

The frontend must not download an enormous global dataset at once.

Use:

- bounding-box queries
- date filters
- pagination where appropriate
- clustering
- server-side filtering

The map should remain usable during the SIH demonstration.

---

# 39. POSTMAN WORKFLOW

The original blueprint treats Postman as a repeatable API-testing workflow rather than merely a place to store requests.

For this project, the collection should be organized as:

```text
SIH 26162
│
├── Health
│
├── Hotspots
│   ├── List
│   ├── Filter
│   └── Detail
│
├── Facilities
│   ├── List
│   └── Nearby
│
├── Classification
│   ├── Classify
│   └── Get Result
│
├── Analytics
│   └── Summary
│
├── Alerts
│   └── List
│
└── Ingestion
    └── FIRMS Ingestion
```

---

# 40. POSTMAN ENVIRONMENT

Use:

```text
baseUrl
hotspotId
facilityId
```

Do not store secrets in the committed environment file.

---

# 41. POSTMAN TESTING

Each endpoint should test at least:

```text
successful response
validation failure
invalid ID
missing parameter
invalid coordinate
empty result
server error handling where reproducible
```

Example:

```javascript
pm.test("Status is successful", () => {
  pm.expect(pm.response.code).to.be.oneOf([200, 201]);
});

pm.test("Response has success flag", () => {
  const json = pm.response.json();
  pm.expect(json.success).to.be.true;
});

pm.test("Response contains data", () => {
  const json = pm.response.json();
  pm.expect(json.data).to.exist;
});
```

The original source similarly requires endpoint-level status, response-shape, and chaining tests.

---

# 42. SECURITY REQUIREMENTS

This is not an authentication-heavy product.

Therefore:

## Required

- secrets in environment variables
- no API keys in frontend source
- input validation
- CORS configuration
- request body limits
- basic rate limiting for public endpoints
- secure MongoDB credentials
- safe error messages
- no secrets in Git

## Not required for MVP

- Google OAuth
- email/password accounts
- JWT refresh-token infrastructure
- RBAC
- invitation systems
- payment security
- user ownership models

Do not copy these from the generic blueprint.

---

# 43. DATA SECURITY

Never commit:

```text
.env
MongoDB passwords
FIRMS API keys
private credentials
private certificates
```

Use:

```text
.env.example
```

for placeholders.

Do not pass real secrets into Claude, Cursor, Copilot, or Postman MCP context.

---

# 44. AI CODING WORKFLOW

AI assistants may be used for implementation.

However:

```text
AI output = untrusted implementation
```

The developer responsible for the module must:

1. understand the generated code
2. review the diff
3. run tests
4. verify API assumptions
5. verify database queries
6. verify external integrations

The original source explicitly treats AI output as untrusted and recommends keeping secrets out of model context.

---

# 45. AI ASSISTANT RULES FOR THIS PROJECT

Before changing code:

```text
1. Read the existing implementation.
2. Identify dependencies.
3. Identify the API/database contract.
4. Make the smallest necessary change.
5. Do not rewrite unrelated modules.
6. Test the change.
```

Never:

```text
invent missing functionality
replace APIs with fake implementations
mock success as if it were real
fabricate ML metrics
fabricate satellite observations
```

---

# 46. GIT & CI

The project should at minimum verify:

```text
install
lint
typecheck
test
```

For Node dependencies, run an appropriate vulnerability check.

The source blueprint recommends CI checks for install, lint, typechecking, testing and dependency/security scanning.

---

# 47. TESTING STRATEGY

## Data Tests

Verify:

- valid coordinates
- timestamps
- missing fields
- duplicates
- normalized FIRMS records

## GIS Tests

Verify:

- nearest facility calculation
- geographic distance
- bounding-box filtering
- geospatial queries

## ML Tests

Verify:

- feature generation
- prediction
- probability output
- class validity
- model loading
- evaluation metrics

## Backend Tests

Verify:

- endpoints
- validation
- database queries
- error responses

## Frontend Tests

Verify:

- map loading
- filters
- hotspot selection
- detail panel
- classification rendering

## End-to-End

Verify:

```text
hotspot
→ classification
→ API
→ map
→ investigation panel
```

---

# 48. MODEL EVALUATION

Required:

```text
Macro F1
Precision per class
Recall per class
Confusion Matrix
Industrial Fire Precision
Industrial Fire Recall
```

Do not report only:

```text
accuracy
```

When possible, use location-aware or time-aware evaluation to reduce leakage.

---

# 49. IMPORTANT ML LIMITATION

If weak labels are used to generate the training data, the model may learn the rules used to create those labels.

Therefore:

```text
High training/test performance
≠
Proven real-world performance
```

The team should create a small independently reviewed validation set wherever practical.

This limitation should be stated in the final presentation.

---

# 50. OFFLINE DEMO DATASET

The demo must work without live external API availability.

Required examples:

```text
Industrial Fire
Wildfire
Gas Flare
Agricultural Burning
Mining Thermal Activity
Uncertain Event
```

The demo data should preserve the same schema used by the live system.

---

# 51. DEMO FLOW

```text
Open Dashboard
        ↓
View thermal hotspots
        ↓
Filter by event type
        ↓
Select Industrial Fire candidate
        ↓
Show facility proximity
        ↓
Show FRP
        ↓
Show historical behaviour
        ↓
Show persistence/anomaly
        ↓
Show confidence
        ↓
Show evidence
        ↓
Compare with wildfire
        ↓
Compare with persistent gas flare
```

---

# 52. DEMO REQUIREMENT

The demo must clearly communicate:

```text
FIRMS detects the thermal anomaly.
Our system classifies the likely source.
```

That distinction must be obvious within the first few minutes of the demonstration.

---

# 53. TEAM RESPONSIBILITIES

## ML / Data

Own:

```text
FIRMS
historical data
labeling
feature engineering
XGBoost
evaluation
persistence
anomaly
```

## GIS

Own:

```text
OSM
land cover
geospatial enrichment
MongoDB geospatial queries
map layers
```

## Backend

Own:

```text
Express
MongoDB
API contracts
ingestion
classification APIs
analytics APIs
Postman
```

## Frontend

Own:

```text
React
MapLibre
dashboard
filters
hotspot investigation
analytics
```

## Integration / QA

Own:

```text
end-to-end integration
demo dataset
testing
bug fixing
final demonstration
```

---

# 54. SHARED CONTRACTS

ML output:

```json
{
  "predictedClass": "industrial_fire",
  "confidence": 0.87,
  "classProbabilities": {},
  "persistenceScore": 0.18,
  "anomalyScore": 0.84,
  "explanation": [],
  "modelVersion": "xgb-v1"
}
```

Backend output must preserve these concepts.

Frontend must not independently recalculate classification.

The model is the source of classification truth.

---

# 55. ERROR HANDLING

The application must handle:

```text
FIRMS unavailable
OSM unavailable
missing land cover
invalid coordinates
missing hotspot
MongoDB unavailable
model unavailable
classification failure
empty query
```

When enrichment data is unavailable, the system should use degraded functionality where possible rather than crashing.

Example:

```text
OSM unavailable
→ hotspot still visible
→ classification may have reduced confidence
→ UI clearly indicates missing contextual data
```

---

# 56. ACCEPTANCE CRITERIA

The SIH MVP is complete only when:

### Data

- [ ] FIRMS data can be loaded
- [ ] historical observations can be stored
- [ ] OSM facilities can be loaded
- [ ] land-cover information can be attached
- [ ] demo data exists

### ML

- [ ] features are generated
- [ ] classifier runs
- [ ] classification classes are returned
- [ ] confidence is returned
- [ ] class probabilities are returned
- [ ] persistence is calculated
- [ ] anomaly is calculated
- [ ] evaluation metrics are available

### Backend

- [ ] health endpoint works
- [ ] hotspot endpoints work
- [ ] facility endpoints work
- [ ] classification endpoints work
- [ ] analytics endpoint works
- [ ] alerts endpoint works
- [ ] FIRMS ingestion works or demo ingestion works

### Database

- [ ] hotspots stored
- [ ] facilities stored
- [ ] classifications stored
- [ ] alerts stored
- [ ] geospatial indexes created

### Frontend

- [ ] dashboard works
- [ ] GIS map works
- [ ] hotspot markers work
- [ ] facility overlay works
- [ ] filters work
- [ ] hotspot detail works
- [ ] classification evidence works
- [ ] persistence works
- [ ] anomaly works

### API / Postman

- [ ] collection exists
- [ ] environment exists
- [ ] endpoint tests exist
- [ ] success cases pass
- [ ] failure cases pass

### Demonstration

- [ ] industrial fire example works
- [ ] wildfire example works
- [ ] gas flare example works
- [ ] agricultural burning example works
- [ ] uncertain example works
- [ ] demo works without live API dependency

---

# 57. MASTER FULL-STACK AI CODING PROMPT

Copy this entire section into Claude/Cursor when starting the project.

```text
Build the SIH 2026 project for Problem Statement 26162:

"AI-Based Detection and Classification of Industrial Fires and Persistent Thermal Sources Using NASA FIRMS, OSM & Satellite Data."

The project is an AI + GIS decision-support web application.

PRIMARY OBJECTIVE

The system must classify satellite-detected thermal hotspots into:

industrial_fire
gas_flare
wildfire
agricultural_burning
mining_thermal_activity
other_or_uncertain

The key SIH objective is to distinguish likely industrial fires from forest, agricultural and other natural/non-industrial thermal events.

The system must answer:

1. Where is the thermal event?
2. What type is it?
3. What is the classification confidence?
4. Why was it classified that way?
5. Is it persistent or anomalous?
6. Is relevant industrial infrastructure nearby?

TECH STACK

Frontend:
React + TypeScript + Vite
MapLibre GL JS
TanStack Query
Axios or fetch
Zod

Backend:
Node.js
Express
TypeScript
MongoDB
MongoDB Atlas
Zod

ML:
Python
Pandas
NumPy
scikit-learn
XGBoost
optional SHAP

Testing:
Postman

DATABASE

Use MongoDB Atlas.

Use GeoJSON Point geometry for:
hotspots
facilities

Use 2dsphere indexes.

Collections:
hotspots
facilities
classifications
alerts
historical_metrics
model_metadata

DATA SOURCES

Primary:
NASA FIRMS

Context:
OpenStreetMap

Additional:
land-cover data

Optional:
satellite imagery

Never invent an API endpoint or field.

Verify current official documentation before implementing external integrations.

DATA FEATURES

Thermal:
FRP
brightness
confidence
day/night
sensor

Spatial:
distance to nearest facility
facility type
industrial indicator
nearby hotspot count
cluster size

Land cover:
forest
cropland
built-up
vegetation
other

Temporal:
7-day recurrence
30-day recurrence
90-day recurrence
days since previous detection
historical FRP mean
historical FRP variance
FRP deviation

ML

Use XGBoost multiclass classification.

Do not use a CNN as the core model unless image data actually becomes a demonstrated requirement.

Weakly supervised labels may be used initially, but clearly distinguish weak labels from independently validated data.

Never fabricate accuracy.

Report:
Macro F1
precision
recall
confusion matrix
industrial-fire precision
industrial-fire recall

CLASSIFICATION

Do not classify based on one rule.

Do not implement:
"near industry = industrial fire"

Use multiple features.

Every prediction must return:
predicted class
confidence
class probabilities
persistence score
anomaly score
explanation
model version

PERSISTENCE

Use:
recurrence
location stability
historical duration
thermal consistency

ANOMALY

Compare current behaviour against historical behaviour.

Use:
FRP deviation
new appearance
unusual recurrence
spatial anomaly
industrial context

FRONTEND

Build an analyst-style GIS dashboard.

Pages:
Dashboard
Map
Hotspot Investigation
Alerts
Analytics

Map must support:
thermal hotspots
industrial facilities
optional land cover
persistent sources
anomalies
filters

Hotspot detail must show:
classification
confidence
FRP
brightness
time
location
facility
distance
land cover
persistence
anomaly
historical behaviour
explanation

BACKEND

Required endpoints:

GET /api/v1/health
GET /api/v1/hotspots
GET /api/v1/hotspots/:id
GET /api/v1/facilities
GET /api/v1/facilities/nearby
GET /api/v1/classifications/:hotspotId
GET /api/v1/alerts
GET /api/v1/analytics/summary
POST /api/v1/ingestion/firms
POST /api/v1/classify

Use consistent responses:

Success:
{
  success: true,
  data: {}
}

Error:
{
  success: false,
  error: {
    code: "...",
    message: "..."
  }
}

POSTMAN

Create:
backend/postman/collection.json
backend/postman/environment.json

Organize requests by:
Health
Hotspots
Facilities
Classification
Analytics
Alerts
Ingestion

Use Postman tests for:
status
response shape
required data
validation errors
invalid IDs
empty results

MCP

Support:

MongoDB MCP for database inspection and debugging.

Postman MCP for API testing and collection management.

Do not expose real credentials to AI context.

SECURITY

Required:
environment variables
input validation
CORS
request limits
basic rate limiting
secure database configuration
safe errors
.gitignore
.cursorignore

Do NOT add:
OAuth
JWT
RBAC
email systems
payments
multi-user account management

unless explicitly required later.

REPOSITORY

Use:

frontend/
backend/
ml/
docs/
tests/

Keep the project understandable to a student team.

AI CODING RULES

Before modifying code:
read the existing code
understand dependencies
check interfaces
make the smallest reasonable change

Never:
invent APIs
invent data
invent metrics
fake external responses
silently replace the architecture
rewrite unrelated modules

The final system must prioritize:
1. correct SIH functionality
2. credible classification
3. GIS visualization
4. explainability
5. reliable demonstration

Do not optimize for enterprise architecture.

OFFLINE DEMO

The project must work with a prepared demo dataset containing:
industrial fire
wildfire
gas flare
agricultural burning
mining activity
uncertain event

The demo must not depend entirely on live APIs.

FINAL DELIVERABLE

Produce a working full-stack SIH MVP where:

FIRMS thermal hotspot
→ enrichment
→ feature engineering
→ XGBoost classification
→ persistence/anomaly analysis
→ MongoDB
→ Express API
→ React/MapLibre GIS dashboard

The user should be able to select a thermal hotspot and understand:
what it is,
how confident the model is,
why it was classified that way,
whether it is persistent,
whether it is anomalous,
and what industrial infrastructure is nearby.
```

---

# 58. BACKEND-ONLY MASTER PROMPT

```text
Build the backend for SIH 2026 Problem Statement 26162.

Stack:
Node.js
Express
TypeScript
MongoDB Atlas
Zod

Domain resources:
hotspots
facilities
classifications
alerts
analytics
ingestion

Requirements:

1. MongoDB connection through environment variables.
2. GeoJSON Point storage for hotspots and facilities.
3. 2dsphere indexes for geospatial queries.
4. FIRMS ingestion module.
5. OSM facility module.
6. Hotspot filtering by date, class, confidence, persistence and anomaly.
7. Nearby facility geospatial query.
8. Classification API.
9. Persistence and anomaly fields.
10. Consistent API response format.
11. Zod validation.
12. /health endpoint.
13. Postman collection.
14. Postman tests.
15. No authentication unless explicitly requested.
16. No invented external API fields.
17. No fake model accuracy.

The backend must integrate with an external/precomputed ML pipeline without coupling the entire codebase to the ML implementation.

Deliver:
.env.example
README
MongoDB schemas/models
API routes
controllers
services
validation
Postman collection
Postman environment
tests
```

---

# 59. ML-ONLY MASTER PROMPT

```text
Build the ML/data pipeline for SIH 2026 Problem Statement 26162.

Objective:
Classify FIRMS thermal observations into:

industrial_fire
gas_flare
wildfire
agricultural_burning
mining_thermal_activity
other_or_uncertain

Inputs:
FIRMS
OSM-derived facility context
land cover
historical thermal observations

Feature groups:
thermal
spatial
land cover
temporal

Model:
XGBoost multiclass classifier

Required outputs:
predicted class
class probabilities
confidence
persistence score
anomaly score
feature explanation
model version

Requirements:

1. Validate and normalize FIRMS data.
2. Preserve historical observations.
3. Generate reproducible features.
4. Document labeling logic.
5. Clearly distinguish weak labels from verified labels.
6. Avoid obvious geographic/time leakage.
7. Produce macro F1.
8. Produce per-class precision/recall.
9. Produce confusion matrix.
10. Report industrial-fire precision/recall.
11. Save model metadata.
12. Support inference on a single hotspot.
13. Do not fabricate ground truth.
14. Do not fabricate evaluation results.

The model must not classify an event as an industrial fire solely because it is near industrial infrastructure.
```

---

# 60. FRONTEND-ONLY MASTER PROMPT

```text
Build the frontend for SIH 2026 Problem Statement 26162.

Stack:
React
TypeScript
Vite
MapLibre GL JS
TanStack Query
Zod

Build an analyst-oriented GIS dashboard.

Required screens:

Dashboard
Map
Hotspot Investigation
Alerts
Analytics

Dashboard:
show counts by classification
persistent source count
anomaly count
latest update

Map:
show FIRMS hotspots
classification-aware markers
industrial facility overlay
filters
date filtering
confidence filtering
persistence filtering
anomaly filtering

Hotspot Investigation:
show classification
confidence
class probabilities
FRP
brightness
timestamp
facility
facility distance
land cover
persistence
anomaly
historical behaviour
explanation

The frontend must never independently infer or alter the ML prediction.

Use backend results as the classification source of truth.

Handle:
loading
empty state
error state
missing enrichment
no classification

Make the main map and hotspot investigation workflow the center of the interface.
```

---

# 61. SECURITY / QUALITY PROMPT

```text
Audit the SIH 26162 project without expanding its scope.

Check:

1. No secrets committed.
2. No MongoDB credentials in frontend code.
3. Environment variables are used correctly.
4. API inputs are validated.
5. Geospatial inputs are validated.
6. CORS is configured.
7. Public endpoints have reasonable rate limits.
8. Database queries are safe.
9. Errors do not expose credentials or internal secrets.
10. Postman tests cover the main endpoints.
11. TypeScript type errors are absent.
12. Frontend handles loading/error states.
13. ML output schema is consistent.
14. The demo still works offline.

Do not add OAuth, JWT, RBAC, payments or unrelated enterprise security features.
```

---

# 62. POSTMAN MASTER PROMPT

```text
Create and maintain the Postman API collection for SIH Problem Statement 26162.

Collection:
SIH 26162 Industrial Fire Detection

Folders:
Health
Hotspots
Facilities
Classification
Analytics
Alerts
Ingestion

Environment variables:
baseUrl
hotspotId
facilityId

Every request must include:
description
sample input
expected response
tests

Test:
HTTP status
success boolean
data existence
required fields
validation failures
invalid IDs
empty result behavior

Save returned IDs into environment variables where useful.

Do not include secrets in the committed environment.

Keep Postman synchronized with the actual backend API.
```

---

# 63. MONGODB MASTER PROMPT

```text
Inspect and validate the MongoDB database for SIH Problem Statement 26162.

Collections:
hotspots
facilities
classifications
alerts
historical_metrics
model_metadata

Verify:

1. GeoJSON structure.
2. Coordinate order is [longitude, latitude].
3. 2dsphere indexes exist.
4. Detection timestamps are valid.
5. Classification references valid hotspot IDs.
6. Facility references are valid.
7. No unnecessary duplicate records.
8. Classification probabilities are valid.
9. Persistence and anomaly values follow documented ranges.
10. Model version is stored.

Use MongoDB MCP where available.

Do not modify production data destructively without explicit instruction.
```

---

# 64. DOMAIN-SPECIFIC IMPLEMENTATION RULES

This SIH project has five domain pillars:

```text
Thermal Intelligence
Geospatial Context
Temporal Intelligence
ML Classification
GIS Visualization
```

Every major feature must map to at least one of these.

If a proposed feature does not improve one of them, question whether it belongs in the MVP.

---

# 65. IMPLEMENTATION PRIORITY

The team should prioritize:

```text
1. FIRMS data
2. Historical observations
3. OSM enrichment
4. Feature engineering
5. Classification
6. Persistence
7. Anomaly
8. MongoDB
9. Backend API
10. GIS map
11. Investigation panel
12. Demo dataset
13. Postman testing
14. Final polish
```

Do not sacrifice the classification pipeline to build decorative frontend functionality.

---

# 66. MVP BOUNDARY

Must exist:

```text
FIRMS
OSM
Historical data
Features
XGBoost
Classification
Persistence
Anomaly
MongoDB
Express API
Postman
React
MapLibre
Interactive investigation
Offline demo
```

Can be added later:

```text
advanced satellite imagery
deep learning
additional satellite products
advanced forecasting
automated notifications
large-scale streaming
```

---

# 67. FINAL DEFINITION OF DONE

The project is complete when a judge can perform this sequence:

```text
1. Open the application.
2. See thermal hotspots on the map.
3. See industrial facilities.
4. Filter hotspots.
5. Select an event.
6. See its predicted class.
7. See confidence.
8. See historical behaviour.
9. See persistence.
10. See anomaly.
11. See nearby facility.
12. Read evidence explaining the classification.
13. Compare it with a wildfire.
14. Compare it with a persistent flare.
15. See that the system separates the different thermal-source categories.
```

The technical stack, database, API, ML and frontend must all support this flow.

---

# 68. SINGLE SOURCE OF TRUTH RULE

This document defines:

```text
Product scope
Architecture
Data contracts
ML requirements
API requirements
Database requirements
UI requirements
Testing requirements
MCP usage
AI coding rules
```

If another document conflicts with this one, the team must resolve the conflict before implementation.

The PRD should be updated when a technical decision changes the actual system contract.

Do not silently let:

```text
frontend assumptions
backend assumptions
ML assumptions
database assumptions
Postman assumptions
```

diverge.

---

# 69. FINAL PROJECT STATEMENT

The project is:

> **An AI-enabled GIS platform that uses NASA FIRMS thermal observations, historical thermal behaviour, OpenStreetMap industrial infrastructure, land-cover context and machine-learning classification to identify and segregate industrial fires, gas flares, wildfires, agricultural burning, mining-related thermal activity and uncertain thermal sources, while providing persistence, anomaly analysis and explainable geospatial visualization.**

The central product distinction is:

```text
FIRMS:
"Thermal anomaly detected."

SIH 26162 System:
"This thermal anomaly is most likely an industrial fire,
gas flare, wildfire, agricultural burn, mining activity
or uncertain source — and these data-driven factors
support that classification."
```