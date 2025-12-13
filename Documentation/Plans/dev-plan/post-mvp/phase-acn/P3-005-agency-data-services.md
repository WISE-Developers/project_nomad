# P3-005: Agency Data Services

**GitHub Milestone**: [P3-005: Agency Data Services](https://github.com/WISE-Developers/project_nomad/milestone/13)

## Overview

Enable Nomad to consume agency-specific data services for weather, fuel types, fire points, and other geospatial data. Agencies expose their data via standard protocols (REST, WFS, WCS) which Nomad consumes based on configuration.

## Tasks

### P3-005-01: Agency Data Service Interface

**Description**: Define interfaces for agency data service integration.

**Acceptance Criteria**:
- [ ] Create `IWeatherDataService` interface (fetch forecast, fetch historical)
- [ ] Create `IFuelDataService` interface (fetch fuel at location, fetch fuel grid)
- [ ] Create `IFirePointService` interface (fetch active fires, fetch fire by ID)
- [ ] Create `DataServiceConfig` type from configuration schema
- [ ] All interfaces return domain types (WeatherData, FuelType, etc.)

**Files to Create/Modify**:
- `backend/src/application/interfaces/IWeatherDataService.ts`
- `backend/src/application/interfaces/IFuelDataService.ts`
- `backend/src/application/interfaces/IFirePointService.ts`
- `backend/src/application/interfaces/index.ts` (exports)

**Dependencies**: P3-002-01

---

### P3-005-02: WFS Client Implementation

**Description**: Create client for consuming OGC Web Feature Service data.

**Acceptance Criteria**:
- [ ] Create `WFSClient` class for OGC WFS 2.0
- [ ] Support GetCapabilities to discover layers
- [ ] Support GetFeature with bbox filter
- [ ] Support GetFeature with property filter
- [ ] Parse GML/GeoJSON responses to domain types
- [ ] Handle pagination for large result sets
- [ ] Configurable timeout and retry

**Files to Create/Modify**:
- `backend/src/infrastructure/data/WFSClient.ts`
- `backend/src/infrastructure/data/WFSConfig.ts`
- `backend/src/infrastructure/data/parsers/GMLParser.ts`

**Dependencies**: P3-005-01

**External Dependencies**:
- `xml2js` or similar for GML parsing
- Existing GeoJSON handling

---

### P3-005-03: WCS Client Implementation

**Description**: Create client for consuming OGC Web Coverage Service data.

**Acceptance Criteria**:
- [ ] Create `WCSClient` class for OGC WCS 2.0
- [ ] Support GetCapabilities to discover coverages
- [ ] Support GetCoverage with bbox subset
- [ ] Support multiple output formats (GeoTIFF, NetCDF)
- [ ] Parse coverage data to domain types
- [ ] Handle large rasters (streaming/chunked)
- [ ] Configurable coordinate system transformations

**Files to Create/Modify**:
- `backend/src/infrastructure/data/WCSClient.ts`
- `backend/src/infrastructure/data/WCSConfig.ts`
- `backend/src/infrastructure/data/parsers/CoverageParser.ts`

**Dependencies**: P3-005-01

**External Dependencies**:
- `gdal-async` or similar for raster handling
- Coordinate system libraries (proj4)

---

### P3-005-04: Agency Data Integration Tests

**Description**: Test suite for agency data service integration.

**Acceptance Criteria**:
- [ ] Test: WFS client correctly fetches fire points
- [ ] Test: WCS client correctly fetches fuel grid
- [ ] Test: REST client correctly fetches weather data
- [ ] Test: Service factory returns correct implementation based on config
- [ ] Test: Data transforms to domain types correctly
- [ ] Test: Error handling for unreachable services
- [ ] Mock services for offline testing

**Files to Create/Modify**:
- `backend/src/infrastructure/data/__tests__/WFSClient.test.ts`
- `backend/src/infrastructure/data/__tests__/WCSClient.test.ts`
- `backend/src/infrastructure/data/__tests__/mocks/MockWFSServer.ts`
- `backend/src/infrastructure/data/__tests__/mocks/MockWCSServer.ts`

**Dependencies**: P3-005-01 through P3-005-03

---

## Architecture Notes

```
┌─────────────────────────────────────────────────────────┐
│                    Nomad Backend                        │
│  ┌─────────────────────────────────────────────────┐   │
│  │              Use Cases                          │   │
│  │   GetWeatherForLocation, GetFuelAtPoint, etc.  │   │
│  └───────────────────────┬─────────────────────────┘   │
│                          │                              │
│  ┌───────────────────────┴─────────────────────────┐   │
│  │           Data Service Interfaces               │   │
│  │  IWeatherDataService, IFuelDataService, etc.   │   │
│  └─────┬─────────────┬─────────────────┬──────────┘   │
│        │             │                 │               │
│  ┌─────┴─────┐ ┌─────┴─────┐ ┌────────┴────────┐     │
│  │ REST      │ │ WFS       │ │ WCS            │     │
│  │ Client    │ │ Client    │ │ Client         │     │
│  └─────┬─────┘ └─────┬─────┘ └────────┬────────┘     │
└────────┼─────────────┼────────────────┼──────────────┘
         │             │                │
         ▼             ▼                ▼
   ┌───────────┐ ┌───────────┐ ┌───────────────┐
   │ SpotWX    │ │ Agency    │ │ Agency        │
   │ API       │ │ GeoServer │ │ WCS Server    │
   │ (Weather) │ │ (Fires)   │ │ (Fuel/DEM)    │
   └───────────┘ └───────────┘ └───────────────┘
```

## Configuration Example

```json
{
  "dataSources": {
    "weather": {
      "type": "rest",
      "endpoint": "https://spotwx.com/api/v2",
      "apiKey": "${SPOTWX_API_KEY}",
      "suppressDefault": false
    },
    "fuel": {
      "type": "wcs",
      "endpoint": "https://gis.agency.gov/geoserver/wcs",
      "coverage": "agency:fuel_fbp",
      "format": "image/geotiff",
      "crs": "EPSG:3978"
    },
    "firePoints": {
      "type": "wfs",
      "endpoint": "https://gis.agency.gov/geoserver/wfs",
      "layer": "agency:active_fires",
      "version": "2.0.0"
    }
  }
}
```

## SST Alignment

From R3-nomad-frontend.md:
> Services -.->|ACN| AgencyData

The data service abstraction allows Nomad to consume agency data regardless of the underlying protocol.
