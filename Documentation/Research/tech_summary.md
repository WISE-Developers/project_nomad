# FireSTARR Technology Summary

## Executive Summary

FireSTARR is a probabilistic fire growth model developed by the Canadian Wildland Fire Modelling Framework (CWFMF), evolved from Ontario's FireGUARD decision support system. It generates burn probability maps through Monte Carlo-style replicated simulations under stochastic weather and fire behavior scenarios, making it well-suited for wildfire response decision-making.

The system consists of a high-performance **C++20 simulation core** with a **Python orchestration layer** that handles data acquisition, job management, and output processing. Docker containers are production-ready, and Azure Batch integration exists for parallel processing at scale. The architecture is CLI-driven with no existing REST API, making **containerized microservice wrapping** the recommended integration approach for TypeScript/React applications.

For your enterprise platform, integration will require developing a REST API wrapper around the Docker container, implementing a job queue for simulation requests, and creating data pipelines to transform between your platform's data formats and FireSTARR's expected inputs/outputs. The system's use of standard CFFDRS/FBP calculations and Prometheus-compatible fuel lookup tables should feel familiar given your Prometheus certification.

---

## Technical Architecture

### Language & Stack

| Component | Technology | Version/Standard |
|-----------|------------|-----------------|
| **Simulation Core** | C++ | C++20 |
| **Build System** | CMake | 3.x+ |
| **Orchestration** | Python | 3.x (GDAL, pandas, geopandas) |
| **Containerization** | Docker | Multi-stage builds |
| **Cloud Scaling** | Azure Batch | Optional |
| **Geospatial Libraries** | GDAL/OGR, GeoTIFF, PROJ | System packages |

**Key Dependencies (C++):**
- `libgeotiff` / `libtiff` - Raster I/O
- `PROJ` - Coordinate transformations
- Standard C++20 features (no Boost dependency)

**Key Dependencies (Python):**
- `gdal` / `osgeo` - Geospatial processing
- `pandas` / `geopandas` - Data manipulation
- `azure-batch` / `azure-storage-blob` - Cloud integration (optional)

### Repository Structure

```
FireSTARR/
├── firestarr/
│   ├── src/
│   │   ├── cpp/           # C++ simulation core
│   │   │   ├── Main.cpp   # Entry point & CLI parsing
│   │   │   ├── Model.cpp  # Scenario orchestration
│   │   │   ├── Scenario.cpp
│   │   │   ├── FireSpread.cpp
│   │   │   ├── FWI.cpp    # FWI calculations
│   │   │   ├── FBP45.h    # FBP fuel type implementations
│   │   │   ├── StandardFuel.h
│   │   │   ├── ProbabilityMap.cpp
│   │   │   └── ...
│   │   └── py/
│   │       └── firestarr/  # Python orchestration
│   │           ├── run.py
│   │           ├── simulation.py
│   │           ├── sim_wrapper.py
│   │           ├── azurebatch.py
│   │           └── datasources/
│   │               ├── cwfis.py   # CWFIS data integration
│   │               ├── cwfif.py   # CWFIF API integration
│   │               └── spotwx.py  # SpotWx weather API
│   ├── CMakeLists.txt
│   ├── settings.ini       # Runtime configuration
│   └── fuel.lut           # Prometheus-format fuel lookup
├── gis/                   # Grid generation tools
│   ├── make_grids.py
│   ├── earthenv.py        # DEM acquisition
│   └── canvec/            # Water features
├── .docker/
│   └── Dockerfile         # Multi-stage build
├── docker-compose.yml
└── config                 # Environment configuration
```

### Core Components

**1. Simulation Engine (`firestarr` binary)**
- Probabilistic fire growth using elliptical spread model
- Monte Carlo replication for burn probability estimation
- Convergence-based termination (configurable confidence level)
- Hourly weather stream processing with diurnal variation

**2. Fire Behaviour Prediction (FBP45.h, StandardFuel.h, FireSpread.cpp)**
- Complete ST-X-3 implementation (1992 FBP System)
- GLC-X-10 updates incorporated
- All 16 standard FBP fuel types plus variants (M-1/M-2 mixed, M-3/M-4 dead fir percentages)
- Crown fire initiation and CFB calculations
- Smouldering/duff consumption (Anderson methodology)

**3. Fire Weather Index (FWI.cpp)**
- Full CFFDRS FWI System implementation
- FFMC, DMC, DC daily calculations
- Hourly FFMC diurnal adjustment (Van Wagner methodology)
- ISI, BUI, FWI derivation

**4. Spread Algorithm (SpreadAlgorithm.h, FireSpread.cpp)**
- Elliptical fire spread (Richards 1990)
- Length-to-breadth ratio from wind speed
- Slope influence on spread direction (RAZ calculation)
- Cell-based propagation with configurable resolution (default 100m)

**5. Python Orchestration (run.py, sim_wrapper.py)**
- Weather data acquisition from CWFIS, CWFIF, SpotWx APIs
- Fire perimeter retrieval from CIFFC
- Simulation job preparation and execution
- Azure Batch task scheduling (optional)
- Output collection and publishing

### Dependencies

**System Requirements:**
- Linux (Ubuntu 24 recommended) or Windows
- CMake 3.x+
- GCC with C++20 support or MSVC
- GDAL 3.x with Python bindings
- libgeotiff, libtiff, PROJ

**Python Packages:**
```
gdal
pandas
geopandas
numpy
shapely
azure-batch (optional)
azure-storage-blob (optional)
```

---

## Data Specifications

### Required Inputs

#### 1. Weather Data (CSV)
**File:** `{fire_name}_wx.csv`

| Column | Type | Description | Units |
|--------|------|-------------|-------|
| `datetime` | ISO 8601 | Timestamp (hourly) | UTC |
| `temp` | float | Temperature | °C |
| `rh` | float | Relative Humidity | % |
| `ws` | float | Wind Speed | km/h |
| `wd` | float | Wind Direction | degrees |
| `prec` | float | Precipitation (1hr) | mm |
| `ffmc` | float | Fine Fuel Moisture Code | 0-101 |
| `dmc` | float | Duff Moisture Code | 0+ |
| `dc` | float | Drought Code | 0+ |
| `isi` | float | Initial Spread Index | 0+ |
| `bui` | float | Build-up Index | 0+ |
| `fwi` | float | Fire Weather Index | 0+ |

**Notes:**
- Hourly data required for simulation duration
- Startup indices (FFMC, DMC, DC) from previous day required for initialization
- Previous day precipitation (`apcp_prev`) required for FFMC calculation

#### 2. Fuel Grid (GeoTIFF)
**File:** `fuel_{zone}.tif`

- UTM projection (NAD83)
- 100m cell size (configurable)
- Integer fuel codes mapped via `.lut` file
- NoData value: 0

**Fuel Lookup Table (.lut):**
Prometheus-compatible CSV format:
```csv
grid_value,export_value,descriptive_name
1,1,C-1
2,2,C-2
...
102,102,Water
```

#### 3. Elevation Grid (GeoTIFF)
**File:** `dem_{zone}.tif`

- UTM projection matching fuel grid
- Same cell size and extent as fuel grid
- Int16 elevation values (meters)
- Used for slope/aspect derivation via Horn's algorithm

#### 4. Ignition Specification

**Option A: Point ignition**
- CLI arguments: `<lat> <lon>` with optional `--size <hectares>`
- Creates circular initial perimeter

**Option B: Perimeter file (GeoTIFF)**
- Rasterized fire perimeter
- Same projection/alignment as fuel grid
- Non-zero values indicate burned area
- CLI: `--perim <path>`

#### 5. Startup Parameters

| Parameter | CLI Flag | Description |
|-----------|----------|-------------|
| Start Date | positional | `yyyy-mm-dd` |
| Start Time | positional | `HH:MM` (local) |
| Latitude | positional | Decimal degrees |
| Longitude | positional | Decimal degrees |
| FFMC (previous) | `--ffmc` | Yesterday's noon FFMC |
| DMC (previous) | `--dmc` | Yesterday's noon DMC |
| DC (previous) | `--dc` | Yesterday's noon DC |
| Precip (previous) | `--apcp_prev` | Precip since yesterday noon |
| Weather file | `--wx` | Path to weather CSV |
| Perimeter | `--perim` | Optional perimeter raster |

### Produced Outputs

#### 1. Burn Probability Grids (GeoTIFF)
**Files:** `probability_{date_offset}day.tif`

- Float32 values [0.0, 1.0] representing burn probability
- Same projection/extent as input fuel grid
- Generated for configurable date offsets (default: 1, 2, 3, 7, 14 days)
- NoData for areas outside simulation extent

**Interim outputs:** `interim_probability_{date_offset}day.tif`
- Generated periodically during long simulations
- Replaced by final outputs upon completion

#### 2. Fire Perimeter Raster (GeoTIFF)
**File:** `{fire_name}_{date_offset}day.tif`

- Binary raster indicating fire extent
- Can include intensity classification

#### 3. Simulation Metadata (GeoJSON)
**File:** `firestarr_{fire_name}.geojson`

Contains fire properties:
```json
{
  "type": "FeatureCollection",
  "features": [{
    "type": "Feature",
    "properties": {
      "lat": 49.5,
      "lon": -117.2,
      "ffmc_old": 89.5,
      "dmc_old": 45.2,
      "dc_old": 320.1,
      "apcp_prev": 0.0,
      "start_date": "2024-07-15",
      "start_time": "14:00"
    },
    "geometry": { "type": "Point", "coordinates": [-117.2, 49.5] }
  }]
}
```

#### 4. Log File
**File:** `firestarr.log`

- Simulation progress and statistics
- Success indicator: `"Total simulation time was"` in output
- Used by orchestration layer for job completion detection

### File Formats

| Format | Use | Notes |
|--------|-----|-------|
| GeoTIFF | All rasters | LZW compression, tiled, UTM projection |
| CSV | Weather inputs | Hourly records, standard headers |
| GeoJSON | Fire metadata | Point geometry with properties |
| .lut | Fuel lookup | Prometheus-compatible CSV |
| .ini | Settings | Key=value configuration |

---

## Integration Analysis

### Recommended Integration Pattern

**Architecture: Containerized Microservice with Job Queue**

```
┌─────────────────────────────────────────────────────────────────┐
│                    React Frontend                                │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐  │
│  │ MapBox GL    │  │ Simulation   │  │ Results               │  │
│  │ Visualization│  │ Request Form │  │ Display               │  │
│  └──────────────┘  └──────────────┘  └───────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    TypeScript API Layer                          │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐  │
│  │ REST         │  │ Job Queue    │  │ Data                  │  │
│  │ Endpoints    │  │ Manager      │  │ Transformer           │  │
│  │ (Express/    │  │ (Bull/       │  │ (GeoTIFF↔GeoJSON,    │  │
│  │  Fastify)    │  │  BullMQ)     │  │  COG generation)      │  │
│  └──────────────┘  └──────────────┘  └───────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    FireSTARR Service Layer                       │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐  │
│  │ Docker       │  │ Input        │  │ Output                │  │
│  │ Container    │  │ Staging      │  │ Collection            │  │
│  │ (firestarr)  │  │ (volumes)    │  │ (volumes)             │  │
│  └──────────────┘  └──────────────┘  └───────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Data Storage                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐  │
│  │ PostgreSQL/  │  │ Object       │  │ Redis                 │  │
│  │ PostGIS      │  │ Storage      │  │ (job state)           │  │
│  │ (metadata)   │  │ (rasters)    │  │                       │  │
│  └──────────────┘  └──────────────┘  └───────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### API/Interface Options

**Option 1: REST API Wrapper (Recommended)**

Develop a TypeScript service that:
1. Accepts simulation requests via REST
2. Validates inputs and stages data
3. Invokes FireSTARR container
4. Monitors completion
5. Transforms and returns outputs

**Sample API Contract:**

```typescript
// POST /api/simulations
interface SimulationRequest {
  fire_id: string;
  ignition: {
    type: 'point' | 'perimeter';
    latitude?: number;
    longitude?: number;
    perimeter_geojson?: GeoJSON.FeatureCollection;
    size_ha?: number;
  };
  start_time: string;  // ISO 8601
  weather_source: 'cwfis' | 'spotwx' | 'custom';
  weather_data?: WeatherRecord[];
  startup_indices: {
    ffmc: number;
    dmc: number;
    dc: number;
    apcp_prev: number;
  };
  duration_days: number;
  output_intervals: number[];  // e.g., [1, 2, 3, 7, 14]
}

interface SimulationResponse {
  job_id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  created_at: string;
  estimated_duration_minutes?: number;
}

// GET /api/simulations/{job_id}
interface SimulationStatus {
  job_id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  progress_percent?: number;
  current_simulation?: number;
  total_simulations?: number;
  started_at?: string;
  completed_at?: string;
  error_message?: string;
}

// GET /api/simulations/{job_id}/results
interface SimulationResults {
  job_id: string;
  fire_id: string;
  burn_probabilities: {
    day_offset: number;
    cog_url: string;        // Cloud-optimized GeoTIFF
    geojson_url?: string;   // Vectorized contours
    statistics: {
      max_probability: number;
      area_above_10pct_ha: number;
      area_above_50pct_ha: number;
    };
  }[];
  perimeters: {
    day_offset: number;
    geojson_url: string;
  }[];
  metadata: {
    simulations_run: number;
    convergence_achieved: boolean;
    runtime_seconds: number;
  };
}
```

**Option 2: WebSocket for Real-time Updates**

```typescript
// WebSocket /ws/simulations/{job_id}
interface SimulationUpdate {
  type: 'progress' | 'interim' | 'complete' | 'error';
  job_id: string;
  timestamp: string;
  data: {
    progress_percent?: number;
    interim_results?: SimulationResults;  // Partial results
    final_results?: SimulationResults;
    error?: string;
  };
}
```

### Containerization Approach

**Docker Compose for Development:**

```yaml
version: '3.8'
services:
  firestarr-api:
    build:
      context: ./api
      dockerfile: Dockerfile
    ports:
      - "3001:3001"
    environment:
      - REDIS_URL=redis://redis:6379
      - FIRESTARR_CONTAINER=firestarr-worker
    volumes:
      - simulation-data:/data
    depends_on:
      - redis
      - firestarr-worker

  firestarr-worker:
    image: ghcr.io/cwfmf/firestarr:latest
    volumes:
      - simulation-data:/appl/data
      - grid-data:/appl/data/generated/grid
    command: tail -f /dev/null  # Keep alive for exec

  redis:
    image: redis:alpine
    ports:
      - "6379:6379"

volumes:
  simulation-data:
  grid-data:
```

**Production Kubernetes:**

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: firestarr-{job_id}
spec:
  template:
    spec:
      containers:
        - name: firestarr
          image: ghcr.io/cwfmf/firestarr:latest
          command: ["/appl/firestarr/firestarr"]
          args: 
            - "/data/output/{job_id}"
            - "{start_date}"
            - "{lat}"
            - "{lon}"
            - "{start_time}"
            - "--wx"
            - "/data/input/{job_id}/weather.csv"
            - "--ffmc"
            - "{ffmc}"
            # ... additional args
          volumeMounts:
            - name: data
              mountPath: /data
            - name: grids
              mountPath: /appl/data/generated/grid
          resources:
            requests:
              memory: "4Gi"
              cpu: "2"
            limits:
              memory: "8Gi"
              cpu: "4"
      restartPolicy: Never
      volumes:
        - name: data
          persistentVolumeClaim:
            claimName: firestarr-data
        - name: grids
          persistentVolumeClaim:
            claimName: firestarr-grids
  backoffLimit: 2
```

### Frontend Communication Strategy

**MapBox GL Integration:**

```typescript
// React component for burn probability visualization
import { useEffect, useState } from 'react';
import mapboxgl from 'mapbox-gl';

interface BurnProbabilityLayerProps {
  map: mapboxgl.Map;
  simulationId: string;
  dayOffset: number;
}

export function BurnProbabilityLayer({ 
  map, 
  simulationId, 
  dayOffset 
}: BurnProbabilityLayerProps) {
  
  useEffect(() => {
    const sourceId = `burn-prob-${simulationId}-${dayOffset}`;
    const layerId = `${sourceId}-layer`;
    
    // Add COG raster source
    map.addSource(sourceId, {
      type: 'raster',
      tiles: [
        `/api/tiles/${simulationId}/${dayOffset}/{z}/{x}/{y}.png`
      ],
      tileSize: 256,
      bounds: /* from simulation metadata */
    });
    
    map.addLayer({
      id: layerId,
      type: 'raster',
      source: sourceId,
      paint: {
        'raster-opacity': 0.7,
        'raster-resampling': 'nearest'
      }
    });
    
    return () => {
      map.removeLayer(layerId);
      map.removeSource(sourceId);
    };
  }, [map, simulationId, dayOffset]);
  
  return null;
}
```

**Probability Color Ramp (from FireSTARR QGIS styles):**

```typescript
const PROBABILITY_COLOR_RAMP = [
  { value: 0.0, color: 'rgba(255, 255, 255, 0)' },      // Transparent
  { value: 0.1, color: 'rgba(0, 177, 242, 0.44)' },     // Light blue
  { value: 0.2, color: 'rgba(250, 246, 142, 0.51)' },   // Yellow
  { value: 0.3, color: 'rgba(252, 223, 75, 0.58)' },    // Gold
  { value: 0.4, color: 'rgba(250, 192, 68, 0.65)' },    // Orange-yellow
  { value: 0.5, color: 'rgba(245, 162, 61, 0.72)' },    // Orange
  { value: 0.6, color: 'rgba(242, 137, 56, 0.79)' },    // Dark orange
  { value: 0.7, color: 'rgba(240, 108, 51, 0.86)' },    // Red-orange
  { value: 0.8, color: 'rgba(238, 79, 44, 0.93)' },     // Red
  { value: 0.9, color: 'rgba(235, 51, 38, 1.0)' },      // Dark red
  { value: 1.0, color: 'rgba(230, 21, 31, 1.0)' },      // Intense red
];
```

---

## Implementation Roadmap

### Phase 1: Setup & Validation (2-3 weeks)

**Week 1: Environment Setup**
- [ ] Clone FireSTARR repository
- [ ] Build Docker container locally
- [ ] Set up test grid data for target region
  - Run GIS scripts: `earthenv.py`, `canvec.py`, `make_grids.py`
  - Generate fuel/elevation grids for your operational area
- [ ] Verify successful test run: `docker compose run firestarr /appl/firestarr/firestarr test /appl/firestarr/dir_test --hours 5`

**Week 2: Data Pipeline Validation**
- [ ] Test weather data acquisition from CWFIS/CWFIF
- [ ] Validate startup index retrieval
- [ ] Confirm output raster generation and format
- [ ] Document any regional fuel type mappings needed

**Week 3: Integration Proof of Concept**
- [ ] Create minimal TypeScript wrapper that invokes container
- [ ] Parse and display output GeoTIFF in MapBox GL
- [ ] Validate coordinate systems and projections align

### Phase 2: API Wrapper Development (3-4 weeks)

**Week 4-5: Core API**
- [ ] Implement REST endpoints (Express/Fastify)
- [ ] Job queue integration (Bull/BullMQ with Redis)
- [ ] Input validation and staging
- [ ] Container invocation and monitoring
- [ ] Output collection and storage

**Week 6-7: Data Transformations**
- [ ] GeoTIFF → Cloud-Optimized GeoTIFF (COG) conversion
- [ ] Probability raster → GeoJSON contour generation
- [ ] Tile server for MapBox GL consumption
- [ ] Metadata extraction and storage (PostGIS)

### Phase 3: React Integration (2-3 weeks)

**Week 8-9: UI Components**
- [ ] Simulation request form component
- [ ] Job status monitoring component
- [ ] Burn probability visualization layer
- [ ] Time-slider for multi-day results
- [ ] Fire perimeter overlay

**Week 10: Polish & Testing**
- [ ] Error handling and user feedback
- [ ] Loading states and progress indicators
- [ ] Integration tests
- [ ] Performance optimization

### Estimated Effort & Resources

| Phase | Duration | FTE | Skills Required |
|-------|----------|-----|-----------------|
| Phase 1 | 2-3 weeks | 1 | DevOps, GIS, Fire science |
| Phase 2 | 3-4 weeks | 1-2 | TypeScript, Docker, GIS |
| Phase 3 | 2-3 weeks | 1-2 | React, MapBox GL, UX |
| **Total** | **7-10 weeks** | **1-2 FTE** | |

**Infrastructure Requirements:**
- Container registry access (GHCR already configured)
- Persistent storage for grid data (~10-50GB per region)
- Redis for job queue
- Object storage for simulation outputs
- Compute resources: 4+ CPU cores, 8+ GB RAM per concurrent simulation

---

## Risk Assessment

### Technical Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Grid data generation complexity | Medium | High | Pre-generate grids for operational area; document process |
| Long simulation runtimes | Medium | Medium | Implement interim output streaming; set reasonable timeouts |
| Memory consumption for large fires | Low | High | Set resource limits; implement extent clipping |
| Weather data API availability | Medium | Medium | Implement fallback sources; cache historical data |
| UTM zone boundary handling | Low | Medium | Implement zone-aware processing; test edge cases |

### Compatibility Considerations

**Prometheus Comparison:**

| Aspect | FireSTARR | Prometheus | Notes |
|--------|-----------|------------|-------|
| Spread model | Elliptical | Elliptical | Same underlying model |
| FBP implementation | ST-X-3 + GLC-X-10 | ST-X-3 | FireSTARR includes updates |
| Fuel lookup | .lut (compatible) | .lut | Direct compatibility |
| Output format | GeoTIFF | Various | May need conversion |
| Probabilistic | Native Monte Carlo | Requires Burn-P3 | FireSTARR built for this |
| Weather input | Hourly CSV | Various | Format translation needed |

**Key Differences from Prometheus:**
1. FireSTARR is purpose-built for probabilistic analysis (replicated simulations)
2. No GUI - entirely CLI/container based
3. Weather format differs - requires hourly FWI-enhanced CSV
4. Outputs probability surfaces directly vs. deterministic perimeters

### Performance Concerns

**Typical Runtimes (100m grid, 1000 simulations):**
- Small fire (<1000 ha): 5-15 minutes
- Medium fire (1000-10000 ha): 15-60 minutes  
- Large fire (>10000 ha): 60+ minutes

**Factors Affecting Performance:**
- Grid resolution (100m default; 50m doubles computation)
- Number of Monte Carlo simulations (default: 10000 max, convergence-based)
- Simulation duration (days)
- Fire complexity (crowning, spotting scenarios)
- CPU architecture (AVX2 optimized)

**Optimization Strategies:**
- Reduce `MAXIMUM_SIMULATIONS` for quick previews
- Increase `CONFIDENCE_LEVEL` threshold for faster convergence
- Use Azure Batch for parallel multi-fire processing
- Generate interim outputs for progressive display

---

## Appendices

### Appendix A: Build Instructions

**Linux (Ubuntu 24):**

```bash
# Clone repository
git clone https://github.com/CWFMF/FireSTARR.git
cd FireSTARR

# Install dependencies
sudo apt-get update
sudo apt-get install -y cmake gcc g++ make \
  libtiff-dev libgeotiff-dev libproj-dev \
  python3-gdal python3-pip

# Build C++ binary
cd firestarr
mkdir build && cd build
cmake -DCMAKE_BUILD_TYPE=Release ..
make -j$(nproc)

# Binary output: ../firestarr
```

**Docker:**

```bash
# Build all containers
docker compose build

# Run test
docker compose run firestarr /appl/firestarr/firestarr test /appl/firestarr/dir_test --hours 5

# Production container
docker compose run firestarr /appl/firestarr/firestarr \
  /output \
  2024-07-15 \
  49.5 \
  -117.2 \
  14:00 \
  --wx /input/weather.csv \
  --ffmc 89.5 \
  --dmc 45.2 \
  --dc 320.1 \
  --apcp_prev 0.0
```

### Appendix B: Sample API Contracts

**Complete TypeScript Interfaces:**

```typescript
// types/firestarr.ts

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface WeatherRecord {
  datetime: string;  // ISO 8601
  temp: number;      // °C
  rh: number;        // %
  ws: number;        // km/h
  wd: number;        // degrees
  prec: number;      // mm
  ffmc: number;
  dmc: number;
  dc: number;
  isi: number;
  bui: number;
  fwi: number;
}

export interface StartupIndices {
  ffmc: number;  // Previous day noon FFMC
  dmc: number;   // Previous day noon DMC
  dc: number;    // Previous day noon DC
  apcp_prev: number;  // Precip since yesterday noon
}

export interface PointIgnition {
  type: 'point';
  coordinates: Coordinates;
  size_ha?: number;  // Default: ~0.01 ha (1 cell)
}

export interface PerimeterIgnition {
  type: 'perimeter';
  geojson: GeoJSON.FeatureCollection;
}

export type Ignition = PointIgnition | PerimeterIgnition;

export interface CreateSimulationRequest {
  fire_id: string;
  fire_name?: string;
  ignition: Ignition;
  start_time: string;  // ISO 8601
  startup_indices: StartupIndices;
  weather: {
    source: 'auto' | 'cwfis' | 'spotwx' | 'custom';
    custom_data?: WeatherRecord[];
  };
  options?: {
    duration_days?: number;  // Default: 14
    output_intervals?: number[];  // Default: [1, 2, 3, 7, 14]
    max_simulations?: number;  // Default: 10000
    confidence_level?: number;  // Default: 0.1
  };
}

export interface SimulationJob {
  job_id: string;
  fire_id: string;
  status: 'queued' | 'preparing' | 'running' | 'completed' | 'failed';
  created_at: string;
  started_at?: string;
  completed_at?: string;
  progress?: {
    percent: number;
    simulations_completed: number;
    simulations_total: number;
    current_convergence?: number;
  };
  error?: {
    code: string;
    message: string;
    details?: any;
  };
}

export interface BurnProbabilityResult {
  day_offset: number;
  timestamp: string;  // ISO 8601 of this day's end
  raster: {
    cog_url: string;
    bounds: [number, number, number, number];  // [minX, minY, maxX, maxY]
    crs: string;  // e.g., "EPSG:32610"
    resolution_m: number;
  };
  contours?: {
    geojson_url: string;
    levels: number[];  // e.g., [0.1, 0.25, 0.5, 0.75, 0.9]
  };
  statistics: {
    max_probability: number;
    mean_probability: number;
    area_burned_any_ha: number;
    area_above_10pct_ha: number;
    area_above_50pct_ha: number;
    area_above_90pct_ha: number;
  };
}

export interface SimulationResults {
  job_id: string;
  fire_id: string;
  completed_at: string;
  burn_probabilities: BurnProbabilityResult[];
  metadata: {
    simulations_run: number;
    convergence_achieved: boolean;
    final_convergence: number;
    runtime_seconds: number;
    weather_source: string;
    grid_resolution_m: number;
  };
  inputs: {
    ignition: Ignition;
    start_time: string;
    startup_indices: StartupIndices;
  };
}
```

### Appendix C: Data Schema Examples

**Weather CSV Example:**

```csv
datetime,temp,rh,ws,wd,prec,ffmc,dmc,dc,isi,bui,fwi
2024-07-15T12:00:00Z,28.5,25,15,270,0,92.1,48.3,325.6,12.4,68.2,28.5
2024-07-15T13:00:00Z,29.2,23,18,265,0,92.8,48.3,325.6,15.1,68.2,32.1
2024-07-15T14:00:00Z,30.1,21,20,260,0,93.2,48.3,325.6,17.3,68.2,35.8
...
```

**settings.ini Key Parameters:**

```ini
# Simulation behavior
MINIMUM_ROS = 0.0
MAX_SPREAD_DISTANCE = 0.4
MINIMUM_FFMC = 65.0
MINIMUM_FFMC_AT_NIGHT = 85.0
MAXIMUM_SIMULATIONS = 10000
CONFIDENCE_LEVEL = 0.1
MAXIMUM_TIME = 36000

# Output configuration
OUTPUT_DATE_OFFSETS = [1,2,3,7,14]
INTERIM_OUTPUT_INTERVAL = 240

# Fuel defaults
DEFAULT_PERCENT_CONIFER = 50
DEFAULT_PERCENT_DEAD_FIR = 30

# Fire intensity thresholds (kW/m)
INTENSITY_MAX_LOW = 2000
INTENSITY_MAX_MODERATE = 4000

# Paths
RASTER_ROOT = ../data/generated/grid/100m
FUEL_LOOKUP_TABLE = ./fuel.lut
```

**Fire GeoJSON Example:**

```json
{
  "type": "FeatureCollection",
  "features": [{
    "type": "Feature",
    "properties": {
      "fire_id": "BC-2024-001",
      "fire_name": "Example Creek",
      "lat": 49.5123,
      "lon": -117.2456,
      "ffmc_old": 89.5,
      "dmc_old": 45.2,
      "dc_old": 320.1,
      "apcp_prev": 0.0,
      "start_date": "2024-07-15",
      "start_time": "14:00",
      "size_ha": 150.5,
      "status": "OC"
    },
    "geometry": {
      "type": "Point",
      "coordinates": [-117.2456, 49.5123]
    }
  }]
}
```

---

## References

1. Forestry Canada. (1992). Development and Structure of the Canadian Forest Fire Behaviour Prediction System (ST-X-3). https://cfs.nrcan.gc.ca/pubwarehouse/pdfs/10068.pdf

2. Wotton, B.M., Alexander, M.E., Taylor, S.W. (2009). Updates and Revisions to the 1992 Canadian Forest Fire Behavior Prediction System (GLC-X-10). https://cfs.nrcan.gc.ca/pubwarehouse/pdfs/31414.pdf

3. Anderson, K. (2009). Incorporating Smoldering Into Fire Growth Modelling. https://www.cfs.nrcan.gc.ca/pubwarehouse/pdfs/19950.pdf

4. FireSTARR Repository: https://github.com/CWFMF/FireSTARR

5. FireGUARD Weather Forecast Model: https://doi.org/10.3390/fire3020016

6. FireGUARD Impact Model: https://doi.org/10.1071/WF18189