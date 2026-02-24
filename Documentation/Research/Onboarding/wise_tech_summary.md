# WISE Technology Summary

> **Note:** WISE integration in Project Nomad is currently stubbed. The WISE engine type exists as an enum value and wizard entry point, but no actual WISE engine adapter is implemented. This document serves as future reference for when WISE integration is developed.

## Executive Summary

WISE (Wildfire Intelligence System for the Environment) is a deterministic fire growth model that simulates fire spread using the elliptical spread model based on the Canadian Forest Fire Behavior Prediction (FBP) System (ST-X-3). Unlike FireSTARR's probabilistic Monte Carlo approach, WISE produces deterministic perimeter predictions with configurable time-stepping.

The system architecture consists of a **C++ core simulation engine** wrapped by a **TypeScript/JavaScript API layer** (wise_js_api), with a **Node.js Builder service** that orchestrates job creation and execution. From an integrator's perspective, WISE can be treated as a **black box**—configure inputs via the TypeScript API, submit jobs to Builder, and collect outputs from the job folder.

For Project Nomad integration, the recommended pattern is a **REST API wrapper** around the WISE Builder service, with job submission via `beginJobPromise()`, status monitoring via `status.json` polling or MQTT subscription, and results collection from the job output directory.

---

## Technical Architecture

### Black Box Overview

```
┌────────────────────────────────────────────────────────────────────────┐
│                         WISE "Black Box"                                │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                                                                   │  │
│  │  ┌─────────────────┐    ┌─────────────────┐    ┌──────────────┐ │  │
│  │  │  wise_js_api    │───▶│  WISE Builder   │───▶│  WISE.EXE    │ │  │
│  │  │  (TypeScript)   │    │  (Node.js)      │    │  (C++ Core)  │ │  │
│  │  └─────────────────┘    └─────────────────┘    └──────────────┘ │  │
│  │         ▲                       │                      │         │  │
│  │         │                       ▼                      ▼         │  │
│  │    API Calls            job.fgmj + Inputs         Outputs       │  │
│  │                                                                   │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  IN: Fuel grids, weather data, ignition points, scenario config        │
│  OUT: KML/SHP perimeters, GeoTIFF grids, statistics, summaries        │
└────────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Role | Technology |
|-----------|------|------------|
| **wise_js_api** | API layer for job configuration | TypeScript/JavaScript |
| **WISE Builder** | Job orchestration, FGMJ generation | Node.js service |
| **WISE.EXE** | Fire growth simulation engine | C++ executable |

### Key Characteristics

| Aspect | WISE | FireSTARR |
|--------|------|-----------|
| **Simulation type** | Deterministic | Probabilistic (Monte Carlo) |
| **Primary output** | Time-stepped perimeters | Burn probability surfaces |
| **API style** | TypeScript Builder pattern | CLI with Python orchestration |
| **Job format** | FGMJ (XML-based) | CLI arguments |
| **Real-time monitoring** | MQTT + status.json | Log file parsing |

---

## Data Specifications

### Input Data Types

#### Grid Files

| Grid Type | Required | Purpose |
|-----------|----------|---------|
| Fuel Grid | Yes | FBP fuel type classification |
| Projection | Yes | Coordinate reference system |
| Fuel LUT | Yes | Fuel code → FBP type mapping |
| Elevation | No | Terrain effects (slope/aspect) |
| Percent Conifer | No | M-1/M-2 mixed fuel parameter |
| Percent Dead Fir | No | M-3/M-4 dead fir parameter |
| Crown Base Height | No | Crown fire initiation |

#### Weather Data

| Data | Format | Source |
|------|--------|--------|
| Hourly observations | Plain text (Temp, RH, WS, WD, Precip) | Weather file |
| Starting FWI indices | API parameters (FFMC, DMC, DC) | WeatherStream config |
| Station metadata | API parameters (location, elevation) | WeatherStation config |

#### Ignition Specifications

| Type | Format | Use Case |
|------|--------|----------|
| Point | LatLon coordinate | Single ignition point |
| Polygon | Array of LatLon | Area ignition |
| Polyline | Array of LatLon | Linear ignition |
| File | Shapefile path | Complex perimeters |

### Output Data Types

#### Vector Outputs (Fire Perimeters)

| Format | Extension | Features |
|--------|-----------|----------|
| KML | `.kml`, `.kmz` | Google Earth compatible, time-stamped |
| Shapefile | `.shp` | GIS standard, attribute table |

#### Grid Outputs (Statistics)

| Statistic Category | Examples |
|--------------------|----------|
| Fire Behavior | MAX_ROS, MAX_FI, MAX_FL, MAX_CFB |
| Spread Rates | HROS, FROS, BROS |
| Timing | FIRE_ARRIVAL_TIME, BURN_GRID |
| Fuel Consumption | TOTAL_FUEL_CONSUMED, SURFACE_FUEL_CONSUMED, CROWN_FUEL_CONSUMED |
| Weather Indices | FFMC, DMC, DC, ISI, BUI, FWI |

#### Tabular Outputs

| Type | Format | Content |
|------|--------|---------|
| Summary | `.txt` | Human-readable job summary |
| Statistics | `.csv`, `.json` | Time-series fire metrics |

---

## Integration Analysis

> **Note:** The integration patterns, API contracts, and TypeScript class definitions in this section are future guidance for when WISE integration is implemented, not a description of current state.

### Recommended Integration Pattern

**Architecture: REST API Wrapper with Job Queue**

```
┌─────────────────────────────────────────────────────────────────┐
│                    Nomad Frontend (React)                        │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐  │
│  │ MapBox GL    │  │ Simulation   │  │ Results               │  │
│  │ Visualization│  │ Request Form │  │ Display               │  │
│  └──────────────┘  └──────────────┘  └───────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Nomad API Layer (TypeScript)                  │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐  │
│  │ REST         │  │ Job Queue    │  │ Data                  │  │
│  │ Endpoints    │  │ (Bull/Redis) │  │ Transformer           │  │
│  └──────────────┘  └──────────────┘  └───────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    WISE Black Box                                │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐  │
│  │ wise_js_api  │  │ WISE Builder │  │ Job Folder            │  │
│  │ (config)     │  │ (execution)  │  │ (inputs/outputs)      │  │
│  └──────────────┘  └──────────────┘  └───────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Job Lifecycle

```
1. Configure    →  2. Validate    →  3. Submit      →  4. Monitor     →  5. Collect
   (wise_js_api)    (checkValid())    (beginJob       (status.json      (Outputs/)
                                       Promise())      or MQTT)
```

### API Contract: Simulation Request

```typescript
// POST /api/wise/simulations
interface WISESimulationRequest {
  simulation_id: string;
  simulation_name?: string;

  // Grid configuration
  grids: {
    fuel_grid: string;      // Path or URL to fuel GeoTIFF
    projection: string;     // Path or URL to .prj file
    lut_file: string;       // Path or URL to fuel LUT
    elevation_grid?: string; // Optional DEM
  };

  // Ignition specification
  ignition: {
    type: 'point' | 'polygon' | 'polyline' | 'file';
    start_time: string;     // ISO 8601
    coordinates?: { latitude: number; longitude: number }[];
    filename?: string;      // For type: 'file'
  };

  // Weather configuration
  weather: {
    station: {
      location: { latitude: number; longitude: number };
      elevation: number;    // meters
    };
    stream: {
      data_file: string;    // Path or URL to weather data
      start_date: string;   // ISO 8601 date
      end_date: string;     // ISO 8601 date
      starting_ffmc: number;
      starting_dmc: number;
      starting_dc: number;
      starting_precip: number;
      hffmc_value: number;
      hffmc_hour: number;   // 0-23
      hffmc_method: 'VAN_WAGNER' | 'LAWSON';
    };
  };

  // Scenario timing
  scenario: {
    start_time: string;     // ISO 8601
    end_time: string;       // ISO 8601
    display_interval: string; // ISO 8601 duration (e.g., "PT1H")
  };

  // Output configuration
  outputs: {
    perimeter_kml?: boolean;
    perimeter_shp?: boolean;
    grid_statistics?: GlobalStatistics[];
    summary?: boolean;
    stats_file?: {
      format: 'csv' | 'json_row' | 'json_column';
      statistics: GlobalStatistics[];
    };
  };

  // Optional timezone
  timezone?: {
    offset_hours: number;   // e.g., -7 for MST
    dst: boolean;
  };
}
```

### API Contract: Simulation Response

```typescript
// Response from POST /api/wise/simulations
interface WISESimulationResponse {
  job_id: string;
  job_name: string;
  status: 'queued' | 'validating' | 'running' | 'completed' | 'failed';
  created_at: string;       // ISO 8601
  job_folder: string;       // Path to job directory
}

// GET /api/wise/simulations/{job_id}/status
interface WISESimulationStatus {
  job_id: string;
  status: 'queued' | 'validating' | 'running' | 'completed' | 'failed';
  progress?: number;        // 0-100
  current_scenario?: string;
  started_at?: string;
  elapsed_seconds?: number;
  error_message?: string;
}

// GET /api/wise/simulations/{job_id}/results
interface WISESimulationResults {
  job_id: string;
  completed_at: string;
  outputs: {
    perimeters?: {
      kml_url?: string;
      shp_url?: string;
    };
    grids?: {
      statistic: string;
      url: string;
      bounds: [number, number, number, number]; // [minX, minY, maxX, maxY]
    }[];
    summary_url?: string;
    stats_url?: string;
  };
  metadata: {
    runtime_seconds: number;
    scenario_name: string;
    ignition_time: string;
    simulation_duration_hours: number;
  };
}
```

---

## Full TypeScript API Contracts

### Core Classes

#### WISE Class (Main Entry Point)

```typescript
export declare class WISE extends IWISESerializable {
    comments: string;
    inputs: WISEInputs;
    outputs: WISEOutputs;
    timestepSettings: TimestepSettings;
    streamInfo: Array<OutputStreamInfo>;
    exportUnits: UnitSettings;
    jobOptions: JobOptions;

    constructor();
    isValid(): boolean;
    checkValid(): Array<ValidationError>;
    setTimezone(zone: Duration, daylight: boolean): void;
    setProjectionFile(filename: string): void;
    setLutFile(filename: string): void;
    setFuelmapFile(filename: string): void;
    setElevationFile(filename: string): void;
    addGridFile(filename: string, proj: string, type: GridFileType): GridFile;

    // Job submission
    beginJob(callback: (job: StartJobWrapper) => void): void;
    beginJobPromise(): Promise<StartJobWrapper>;
}
```

#### GridFile Class

```typescript
export declare class GridFile {
    get id(): string;
    set id(value: string);
    get comment(): string;
    set comment(value: string);
    type: GridFileType;
    get filename(): string;
    set filename(value: string);
    get projection(): string;
    set projection(value: string);

    constructor();
    getId(): string;
    setName(name: string): void;
    isValid(): boolean;
    checkValid(): Array<ValidationError>;
}

export declare enum GridFileType {
    NONE = -1,
    FUEL_GRID = 0,
    DEGREE_CURING = 1,
    GREEN_UP = 2,
    PERCENT_CONIFER = 3,
    PERCENT_DEAD_FIR = 4,
    CROWN_BASE_HEIGHT = 5,
    TREE_HEIGHT = 6,
    FUEL_LOAD = 7,
    FBP_VECTOR = 8
}
```

#### WeatherStation Class

```typescript
export declare class WeatherStation {
    get id(): string;
    set id(value: string);
    location: LatLon;
    streams: WeatherStream[];
    comments: string;
    elevation: number;

    constructor();
    getId(): string;
    setName(name: string): void;
    isValid(): boolean;
    checkValid(): Array<ValidationError>;

    addWeatherStream(
        filename: string,
        hffmc_value: number,
        hffmc_hour: number,
        hffmc_method: HFFMCMethod,
        starting_ffmc: number,
        starting_dmc: number,
        starting_dc: number,
        starting_precip: number,
        start_time: string | DateTime,
        end_time: string | DateTime,
        comments?: string
    ): WeatherStream;
}
```

#### WeatherStream Class

```typescript
export declare class WeatherStream {
    get id(): string;
    set id(value: string);
    comments: string;
    get filename(): string;
    set filename(value: string);
    get starting_ffmc(): number;
    set starting_ffmc(value: number);
    get starting_dmc(): number;
    set starting_dmc(value: number);
    get starting_dc(): number;
    set starting_dc(value: number);
    get starting_precip(): number;
    set starting_precip(value: number);
    get hffmc_hour(): number;
    set hffmc_hour(value: number);
    hffmc_value: number;
    hffmc_method: HFFMCMethod;
    get lstart_time(): DateTime;
    set lstart_time(value: DateTime);
    get lend_time(): DateTime;
    set lend_time(value: DateTime);

    constructor(parentId: string);
    getId(): string;
    setName(name: string): void;
    isValid(): boolean;
    checkValid(): Array<ValidationError>;
}

export declare enum HFFMCMethod {
    VAN_WAGNER = 0,
    LAWSON = 1
}
```

#### Ignition Class

```typescript
export declare class Ignition {
    get id(): string;
    set id(value: string);
    comments: string;
    get lStartTime(): DateTime;
    set lStartTime(value: DateTime);
    type: IgnitionType;
    get filename(): string;
    set filename(value: string);
    feature: LatLon[];
    attributes: AttributeEntry[];

    constructor();
    getId(): string;
    setName(name: string): void;
    addPoint(point: LatLon): Ignition;
    isValid(): boolean;
    checkValid(): Array<ValidationError>;
}

export declare enum IgnitionType {
    FILE = 0,
    POLYLINE = 1,
    POLYGON = 2,
    POINT = 4
}
```

#### Scenario Class

```typescript
export declare class Scenario {
    get id(): string;
    set id(value: string);
    get lStartTime(): DateTime;
    set lStartTime(value: DateTime);
    get lEndTime(): DateTime;
    set lEndTime(value: DateTime);
    displayInterval: Duration;
    comments: string;
    fgmOptions: FGMOptions;
    fbpOptions: FBPOptions;
    fmcOptions: FMCOptions;
    fwiOptions: FWIOptions;
    burningConditions: BurningConditions[];
    vectorInfo: string[];
    ignitionInfo: IgnitionReference[];
    layerInfo: LayerInfo[];
    assetFiles: AssetReference[];
    windTargetFile: TargetReference | null;
    vectorTargetFile: TargetReference | null;
    stopModellingOptions: StopModellingOptions | null;
    gustingOptions: GustingOptions | null;

    constructor();
    getId(): string;
    setName(name: string): void;

    addBurningCondition(
        date: string | DateTime,
        startTime: number,
        endTime: number,
        fwiGreater: number,
        wsGreater: number,
        rhLess: number,
        isiGreater: number
    ): BurningConditions;

    addIgnitionReference(ignition: Ignition): IgnitionReference;
    setFgmOptions(...): void;
    setFbpOptions(terrainEffect: boolean, windEffect: boolean): void;
    setFmcOptions(...): void;
    setFwiOptions(...): void;
    isValid(): boolean;
    checkValid(): Array<ValidationError>;
}
```

### Output Classes

#### VectorFile Class

```typescript
export declare class VectorFile {
    filename: string;
    type: VectorFileType;
    multPerim: boolean;
    get lPerimStartTime(): DateTime;
    set lPerimStartTime(value: DateTime);
    get lPerimEndTime(): DateTime;
    set lPerimEndTime(value: DateTime);
    removeIslands: boolean;
    mergeContact: boolean;
    perimActive: boolean;
    scenarioName: string;
    metadata: VectorMetadata;
    shouldStream: boolean;
    subScenarioName: string | null;

    constructor();
    isValid(): boolean;
    checkValid(): Array<ValidationError>;
}

export declare enum VectorFileType {
    KML = "KML",
    SHP = "SHP"
}
```

#### Output_GridFile Class

```typescript
export declare class Output_GridFile {
    filename: string;
    get lOutputTime(): DateTime;
    set lOutputTime(value: DateTime);
    get lStartOutputTime(): DateTime | null;
    set lStartOutputTime(value: DateTime | null);
    get statistic(): GlobalStatistics;
    set statistic(value: GlobalStatistics);

    isValid(): boolean;
    checkValid(): Array<ValidationError>;
}
```

#### SummaryFile Class

```typescript
export declare class SummaryFile {
    outputs: SummaryOutputs;
    shouldStream: boolean;
    filename: string;

    constructor(scen: Scenario);
    isValid(): boolean;
    checkValid(): Array<ValidationError>;
}
```

#### StatsFile Class

```typescript
export declare class StatsFile {
    shouldStream: boolean;
    streamName: string | null;
    location: LatLon | null;
    filename: string;
    fileType: StatsFileType;

    constructor(scen: Scenario);
    addColumn(stat: GlobalStatistics): void;
    isValid(): boolean;
    checkValid(): Array<ValidationError>;
}

export declare enum StatsFileType {
    AUTO_DETECT = 0,
    COMMA_SEPARATED_VALUE = 1,
    JSON_ROW = 2,
    JSON_COLUMN = 3
}
```

### Data Classes

#### LatLon Class

```typescript
export declare class LatLon {
    latitude: number;
    longitude: number;

    constructor(lat: number, lon: number);
}
```

#### Duration Class

```typescript
export declare class Duration {
    years: number;
    months: number;
    days: number;
    hours: number;
    minutes: number;
    seconds: number;
    isNegative: boolean;

    isValid(): boolean;
    isLessThan(other: Duration): boolean;
    toSeconds(): number;
    toDays(): number;

    static createDateTime(
        years: number,
        months: number,
        days: number,
        hours: number,
        minutes: number,
        seconds: number,
        negative: boolean
    ): Duration;

    static createTime(
        hours: number,
        minutes: number,
        seconds: number,
        negative: boolean
    ): Duration;

    toString(): string;
    fromString(val: string): void;
}
```

#### Timezone Class

```typescript
export declare class Timezone {
    dst: boolean;
    get offset(): Duration;
    set offset(value: Duration);
    value: number;

    constructor();
    isValid(): boolean;
    checkValid(): Array<ValidationError>;

    static getTimezoneNameList(callback?: (defaults: TimezoneName[]) => any): void;
    static getTimezoneNameListPromise(): Promise<TimezoneName[]>;
}
```

### GlobalStatistics Enum (Complete)

```typescript
export declare enum GlobalStatistics {
    DATE_TIME = 0,
    ELAPSED_TIME = 1,
    TIME_STEP_DURATION = 2,
    TEMPERATURE = 3,
    DEW_POINT = 4,
    RELATIVE_HUMIDITY = 5,
    WIND_SPEED = 6,
    WIND_DIRECTION = 7,
    PRECIPITATION = 8,
    HFFMC = 9,
    HISI = 10,
    DMC = 11,
    DC = 12,
    HFWI = 13,
    BUI = 14,
    FFMC = 15,
    ISI = 16,
    FWI = 17,
    TIMESTEP_AREA = 18,
    TIMESTEP_BURN_AREA = 19,
    TOTAL_AREA = 20,
    TOTAL_BURN_AREA = 21,
    AREA_GROWTH_RATE = 22,
    EXTERIOR_PERIMETER = 23,
    EXTERIOR_PERIMETER_GROWTH_RATE = 24,
    ACTIVE_PERIMETER = 25,
    ACTIVE_PERIMETER_GROWTH_RATE = 26,
    TOTAL_PERIMETER = 27,
    TOTAL_PERIMETER_GROWTH_RATE = 28,
    FI_LT_10 = 29,
    FI_10_500 = 30,
    FI_500_2000 = 31,
    FI_2000_4000 = 32,
    FI_4000_10000 = 33,
    FI_GT_10000 = 34,
    ROS_0_1 = 35,
    ROS_2_4 = 36,
    ROS_5_8 = 37,
    ROS_9_14 = 38,
    ROS_GT_15 = 39,
    MAX_ROS = 40,
    MAX_FI = 41,
    MAX_FL = 42,
    MAX_CFB = 43,
    MAX_CFC = 44,
    MAX_SFC = 45,
    MAX_TFC = 46,
    TOTAL_FUEL_CONSUMED = 47,
    CROWN_FUEL_CONSUMED = 48,
    SURFACE_FUEL_CONSUMED = 49,
    NUM_ACTIVE_VERTICES = 50,
    NUM_VERTICES = 51,
    CUMULATIVE_VERTICES = 52,
    CUMULATIVE_ACTIVE_VERTICES = 53,
    NUM_ACTIVE_FRONTS = 54,
    NUM_FRONTS = 55,
    MEMORY_USED_START = 56,
    MEMORY_USED_END = 57,
    NUM_TIMESTEPS = 58,
    TICKS = 59,
    PROCESSING_TIME = 60,
    GROWTH_TIME = 61,
    // Map statistics (for grid outputs)
    BURN_GRID = 62,
    FIRE_ARRIVAL_TIME = 63,
    FIRE_ARRIVAL_TIME_MIN = 64,
    HROS = 65,
    FROS = 66,
    BROS = 67,
    RSS = 68,
    RAZ = 69,
    FMC = 70,
    CFB = 71,
    CFC = 72,
    SFC = 73,
    TFC = 74,
    FI = 75,
    FL = 76,
    CURINGDEGREE = 77,
    GREENUP = 78,
    PC = 79,
    PDF = 80,
    CBH = 81,
    TREE_HEIGHT = 82,
    FUEL_LOAD = 83,
    CFL = 84,
    GRASSPHENOLOGY = 85,
    ROSVECTOR = 86,
    DIRVECTOR = 87,
    CRITICAL_PATH = 88,
    CRITICAL_PATH_PERCENTAGE = 89
    // ... additional values up to 109
}
```

---

## Risk Assessment

### Integration Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Grid data alignment | Medium | High | Pre-validate projection match across all input grids |
| Weather data gaps | Medium | Medium | Ensure weather stream dates cover full scenario period |
| Ignition in non-fuel | Low | High | Pre-check fuel type at ignition location via grid query |
| Server timeouts | Medium | Medium | Increase `SocketMsg.timeout`, implement retry logic |
| Large job memory | Low | High | Monitor job folder size, implement cleanup policies |

### Data Preparation Complexity

| Task | Complexity | Notes |
|------|------------|-------|
| Fuel grid preparation | High | Requires consistent LUT mapping, projection alignment |
| Weather data formatting | Medium | Hourly data with specific column format |
| Coordinate transformation | Medium | WGS84 input, must match grid CRS for analysis |
| Output interpretation | Medium | 40+ statistics with specific units and meanings |

### WISE vs FireSTARR Comparison

| Aspect | WISE | FireSTARR | Nomad Implications |
|--------|------|-----------|-------------------|
| Output type | Deterministic perimeters | Burn probability | Different visualization needs |
| Computation time | Fixed (scenario duration) | Variable (convergence) | More predictable job times |
| API complexity | TypeScript Builder pattern | CLI arguments | Richer configuration options |
| Real-time updates | MQTT subscription | Log parsing | Better progress monitoring |
| Multi-scenario | Native support | Manual orchestration | Built-in batch capability |

---

## Appendices

### Appendix A: Minimal Working Example

```typescript
import * as modeller from 'wise_js_api';
import { DateTime } from 'luxon';

async function runSimulation() {
    const wise = new modeller.wise.WISE();
    wise.setName("Test Simulation");

    // Set timezone
    wise.setTimezone(
        modeller.globals.Duration.createTime(-7, 0, 0, false),
        false
    );

    // Configure fuel grid
    wise.setFuelmapFile("/data/fuel.tif");
    wise.setProjectionFile("/data/fuel.prj");
    wise.setLutFile("/data/fuel.lut");

    // Optional: elevation
    wise.setElevationFile("/data/dem.tif");

    // Add weather station
    const station = new modeller.wise.WeatherStation();
    station.id = "Station_1";
    station.location = new modeller.globals.LatLon(49.5123, -117.2456);
    station.elevation = 650;

    // Add weather stream
    const stream = station.addWeatherStream(
        "/data/weather.txt",
        85.0,                                    // HFFMC value
        13,                                      // HFFMC hour
        modeller.wise.HFFMCMethod.VAN_WAGNER,
        89.5,                                    // Starting FFMC
        45.2,                                    // Starting DMC
        320.1,                                   // Starting DC
        0.0,                                     // Starting precip
        DateTime.fromISO("2024-07-15"),
        DateTime.fromISO("2024-07-17"),
        "Primary weather stream"
    );

    wise.inputs.weatherStations.push(station);

    // Add ignition
    const ignition = new modeller.wise.Ignition();
    ignition.id = "Ignition_1";
    ignition.type = modeller.wise.IgnitionType.POINT;
    ignition.lStartTime = DateTime.fromISO("2024-07-15T14:00:00");
    ignition.addPoint(new modeller.globals.LatLon(49.5123, -117.2456));
    wise.inputs.ignitions.push(ignition);

    // Configure scenario
    const scenario = new modeller.wise.Scenario();
    scenario.id = "Primary_Scenario";
    scenario.lStartTime = DateTime.fromISO("2024-07-15T12:00:00");
    scenario.lEndTime = DateTime.fromISO("2024-07-17T18:00:00");
    scenario.displayInterval = modeller.globals.Duration.createTime(1, 0, 0, false);

    // Link ignition and weather to scenario
    const ignRef = scenario.addIgnitionReference(ignition);
    const streamRef = new modeller.wise.StationStream(station.id, stream.id);
    scenario.stationStreams.push(streamRef);

    wise.inputs.scenarios.push(scenario);

    // Configure outputs
    const perimKml = new modeller.wise.VectorFile();
    perimKml.type = modeller.wise.VectorFileType.KML;
    perimKml.filename = "perimeter.kml";
    perimKml.multPerim = true;
    perimKml.removeIslands = true;
    perimKml.scenarioName = scenario.id;
    perimKml.lPerimStartTime = scenario.lStartTime;
    perimKml.lPerimEndTime = scenario.lEndTime;
    wise.outputs.vectorFiles.push(perimKml);

    const gridRos = new modeller.wise.Output_GridFile();
    gridRos.filename = "max_ros.tif";
    gridRos.scenarioName = scenario.id;
    gridRos.statistic = modeller.globals.GlobalStatistics.MAX_ROS;
    gridRos.lOutputTime = scenario.lEndTime;
    wise.outputs.gridFiles.push(gridRos);

    // Validate
    const errors = wise.checkValid();
    if (errors.length > 0) {
        errors.forEach(e => console.error(`${e.propertyName}: ${e.message}`));
        throw new Error("Validation failed");
    }

    // Submit job
    const job = await wise.beginJobPromise();
    console.log(`Job submitted: ${job.name}`);

    return job;
}
```

### Appendix B: Job Monitoring

```typescript
import * as fs from 'fs';
import { JobManager } from 'wise_js_api/dist/client';

// Option 1: Polling status.json
async function pollStatus(jobFolder: string): Promise<void> {
    const statusPath = `${jobFolder}/status.json`;

    while (true) {
        const status = JSON.parse(fs.readFileSync(statusPath, 'utf8'));

        console.log(`Status: ${status.status}, Progress: ${status.progress}%`);

        if (status.status === 'Complete') {
            console.log('Job completed successfully');
            return;
        }

        if (status.status === 'Failed') {
            throw new Error(`Job failed: ${status.errorMessage}`);
        }

        await new Promise(resolve => setTimeout(resolve, 5000));
    }
}

// Option 2: MQTT subscription
async function subscribeToJob(jobName: string): Promise<void> {
    const manager = new JobManager(jobName);

    manager.on('simulationStarted', () => {
        console.log('Simulation started');
    });

    manager.on('scenarioStarted', (args) => {
        console.log(`Scenario started: ${args.scenarioName}`);
    });

    manager.on('scenarioCompleted', (args) => {
        console.log(`Scenario completed: ${args.scenarioName}`);
    });

    manager.on('simulationComplete', () => {
        console.log('Simulation complete');
        manager.dispose();
    });

    manager.on('simulationFailed', (error) => {
        console.error(`Simulation failed: ${error}`);
        manager.dispose();
    });

    await manager.start();
}
```

### Appendix C: Weather Data File Format

```
Temp    RH      WS      WD      Precip
28.5    25.0    15.0    270     0.0
29.2    23.0    18.0    265     0.0
30.1    21.0    20.0    260     0.0
30.8    19.0    22.0    255     0.0
31.2    18.0    25.0    250     0.0
30.5    20.0    23.0    255     0.0
29.8    22.0    20.0    260     0.0
28.2    28.0    15.0    270     0.0
```

**Column specifications:**
- `Temp`: Temperature in °C
- `RH`: Relative Humidity in % (0-100)
- `WS`: Wind Speed in km/h
- `WD`: Wind Direction in degrees (0-360, direction wind is coming FROM)
- `Precip`: Hourly precipitation in mm

**Notes:**
- One row per hour, starting from stream start time
- Tab or space delimited
- First row is header (optional but recommended)
- Must cover entire scenario duration

---

## References

1. Forestry Canada. (1992). Development and Structure of the Canadian Forest Fire Behaviour Prediction System (ST-X-3). https://cfs.nrcan.gc.ca/pubwarehouse/pdfs/10068.pdf

2. WISE JS API Documentation: https://github.com/WISE-Developers/WISE_JS_API

3. WISE Builder Reference: WISEKB documentation

4. Canadian Fire Weather Index (FWI) System: https://cwfis.cfs.nrcan.gc.ca/background/summary/fwi
