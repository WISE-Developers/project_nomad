# WISE I/O Documentation

> **Note:** WISE integration in Project Nomad is currently stubbed. The WISE engine type exists as an enum value and wizard entry point, but no actual WISE engine adapter is implemented. This document serves as future reference for when WISE integration is developed.

## Input Requirements

### Ignition Point Format

WISE supports multiple ignition types for specifying fire origin locations:

| Format | Supported | Details |
|--------|-----------|---------|
| **Point** | ✅ Primary | Single LatLon coordinate via `IgnitionType.POINT` |
| **Polygon** | ✅ | Closed polygon vertices via `IgnitionType.POLYGON` |
| **Polyline** | ✅ | Linear ignition path via `IgnitionType.POLYLINE` |
| **File** | ✅ | Shapefile import via `IgnitionType.FILE` |

**Point Ignition Example:**
```typescript
let ignition = prom.addPointIgnition(
  new LatLon(49.5123, -117.2456),
  DateTime.fromISO("2024-07-15T14:00:00")
);
ignition.id = "Point_Ignition_1";
```

**Polygon Ignition Example:**
```typescript
let ignition = new wise.Ignition();
ignition.id = "Polygon_Ignition_1";
ignition.type = wise.IgnitionType.POLYGON;
ignition.lStartTime = DateTime.fromISO("2024-07-15T14:00:00");
ignition.addPoint(new LatLon(49.50, -117.20));
ignition.addPoint(new LatLon(49.51, -117.20));
ignition.addPoint(new LatLon(49.51, -117.21));
ignition.addPoint(new LatLon(49.50, -117.21));
// Polygon automatically closes
```

**Polyline Ignition Example:**
```typescript
let ignition = new wise.Ignition();
ignition.id = "Polyline_Ignition_1";
ignition.type = wise.IgnitionType.POLYLINE;
ignition.lStartTime = DateTime.fromISO("2024-07-15T14:00:00");
ignition.addPoint(new LatLon(49.50, -117.20));
ignition.addPoint(new LatLon(49.51, -117.21));
ignition.addPoint(new LatLon(49.52, -117.22));
```

**File Ignition Example:**
```typescript
let ignition = new wise.Ignition();
ignition.id = "File_Ignition_1";
ignition.type = wise.IgnitionType.FILE;
ignition.lStartTime = DateTime.fromISO("2024-07-15T14:00:00");
ignition.filename = "/path/to/ignition.shp";
```

---

### Coordinate System

| Context | CRS | Format |
|---------|-----|--------|
| **Input coordinates** | WGS84 | Decimal degrees (lat/lon) |
| **Projection files** | Any valid CRS | ESRI .prj format |
| **Grid data** | Must match projection | All grids use same CRS |

**Projection File Requirements:**
- Required for all grid files (fuel, elevation, weather grids)
- Format: ESRI .prj file
- All grid files must use matching projections

**Example projection file (UTM Zone 11N NAD83):**
```
PROJCS["NAD_1983_UTM_Zone_11N",
  GEOGCS["GCS_North_American_1983",
    DATUM["D_North_American_1983",
      SPHEROID["GRS_1980",6378137.0,298.257222101]],
    PRIMEM["Greenwich",0.0],
    UNIT["Degree",0.0174532925199433]],
  PROJECTION["Transverse_Mercator"],
  PARAMETER["Central_Meridian",-117.0],
  PARAMETER["Scale_Factor",0.9996],
  UNIT["Meter",1.0]]
```

---

### Date/Time Format

| Parameter | Format | Example |
|-----------|--------|---------|
| **Ignition start** | ISO 8601 | `2024-07-15T14:00:00` |
| **Scenario start/end** | ISO 8601 | `2024-07-15T12:00:00` |
| **Weather stream dates** | ISO 8601 date | `2024-07-15` |
| **Duration** | ISO 8601 duration | `PT1H` (1 hour) |

**Timezone Configuration:**
```typescript
let wise_instance = new wise.WISE();
let tz = new Timezone();
tz.value = -7; // UTC-7 (MST)
wise_instance.timezone = tz;
```

**Time handling:**
- All times are local to the specified timezone
- Luxon `DateTime` objects used throughout the API
- Weather data file contains hourly observations (implicit times based on start date)

---

### Weather Data Format

**Format:** WeatherStream attached to WeatherStation

**Required Components:**

| Component | Description | Provided Via |
|-----------|-------------|--------------|
| **Hourly observations** | Temp, RH, WS, WD, Precip | Weather data file |
| **FWI starting values** | FFMC, DMC, DC | WeatherStream parameters |
| **Station location** | Lat/lon coordinates | WeatherStation.location |

**Weather Data File Format:**

Plain text file with columns:

| Column | Type | Units | Description |
|--------|------|-------|-------------|
| `Temp` | float | °C | Temperature |
| `RH` | float | % | Relative Humidity (0-100) |
| `WS` | float | km/h | Wind Speed |
| `WD` | float | degrees | Wind Direction (0-360, from) |
| `Precip` | float | mm | Precipitation (hourly) |

**Sample weather_data.txt:**
```
Temp  RH    WS    WD    Precip
28.5  25.0  15.0  270   0.0
29.2  23.0  18.0  265   0.0
30.1  21.0  20.0  260   0.0
30.8  19.0  22.0  255   0.0
```

**FWI Starting Values:**

| Parameter | Valid Range | Description |
|-----------|-------------|-------------|
| `starting_ffmc` | [0, 101] | Previous day's Fine Fuel Moisture Code |
| `starting_dmc` | [0, ∞) | Previous day's Duff Moisture Code |
| `starting_dc` | [0, ∞) | Previous day's Drought Code |
| `starting_precip` | [0, ∞) | Previous day's afternoon precipitation (mm) |

**Complete Weather Configuration:**
```typescript
let station = new wise.WeatherStation();
station.id = "Station_1";
station.location = new LatLon(49.5123, -117.2456);
station.elevation = 650; // meters

let stream = station.addWeatherStream(
    "/path/to/weather_data.txt",
    85.0,                              // HFFMC value
    13,                                // HFFMC hour (13:00)
    HFFMCMethod.VAN_WAGNER,           // HFFMC calculation method
    89.5,                              // Starting FFMC
    45.2,                              // Starting DMC
    320.1,                             // Starting DC
    0.0,                               // Starting precipitation
    DateTime.fromISO("2024-07-15"),   // Stream start date
    DateTime.fromISO("2024-07-16"),   // Stream end date
    "Main weather stream"
);
```

---

### Required vs Optional Parameters

**Absolute Minimum to Run:**

| Parameter | How Provided | Required |
|-----------|--------------|----------|
| Fuel grid | GridFile | ✅ |
| Fuel projection | GridFile.projection | ✅ |
| Fuel LUT | FuelDefinition array | ✅ |
| Weather station | WeatherStation | ✅ |
| Weather stream | WeatherStream | ✅ |
| Ignition | Ignition | ✅ |
| Scenario | Scenario with start/end times | ✅ |

**Optional Parameters:**

| Parameter | Default | Purpose |
|-----------|---------|---------|
| Elevation (DEM) | Flat terrain | Slope/aspect effects |
| Fuel patches | None | Fuel modifications |
| Weather patches | None | Spatial weather variation |
| Weather grids | None | Wind field modification |
| Assets | None | Simulation stop conditions |
| Burning conditions | Always burning | Time-of-day restrictions |

**Minimal Configuration:**
```typescript
const wise = new modeller.wise.WISE();

// Required: Fuel grid
let fuelGrid = wise.addGridFile("fuel_map.tif", "fuel_map.prj", GridFileType.FUEL_GRID);

// Required: Weather
let station = wise.addWeatherStation(49.5123, -117.2456);
let stream = station.addWeatherStream(
    "weather_data.txt",
    85.0, 13, HFFMCMethod.VAN_WAGNER,
    89.5, 45.2, 320.1, 0.0,
    DateTime.fromISO("2024-07-15"),
    DateTime.fromISO("2024-07-16")
);

// Required: Ignition
let ignition = wise.addPointIgnition(49.5123, -117.2456,
                                      DateTime.fromISO("2024-07-15T14:00:00"));

// Required: Scenario
let scenario = wise.addScenario(DateTime.fromISO("2024-07-15T12:00:00"),
                                DateTime.fromISO("2024-07-16T18:00:00"));
scenario.addStationStream(station.id, stream.id, true);
scenario.addIgnitionReference(ignition.id);
```

---

### Fuel Type Data

**Supported Formats:**

| Format | Extension | Notes |
|--------|-----------|-------|
| **GeoTIFF** | `.tif` | Primary format |
| **ASCII Grid** | `.asc` | Also supported |

**Grid Requirements:**

| Property | Requirement |
|----------|-------------|
| Data type | Integer (Int16 or UInt16) |
| Cell values | Fuel type codes from LUT |
| NoData value | -1 or grid-specific |
| Projection | Must have matching .prj file |

**Canadian FBP Fuel Types:**

| Category | Codes | Description |
|----------|-------|-------------|
| **Conifer** | C-1 to C-7 | Spruce, Pine, Douglas-Fir |
| **Deciduous** | D-1, D-2 | Leafless/Green Aspen |
| **Mixedwood** | M-1 to M-4 | Boreal Mixedwood varieties |
| **Slash** | S-1 to S-3 | Logging slash |
| **Open/Grass** | O-1a, O-1b | Matted/Standing grass |
| **Non-fuel** | Non, Water | Non-burnable |

**Fuel Definition Example:**
```typescript
let fuel = new fuels.FuelDefinition("C-2 Boreal Spruce", "C-2", 2);
fuel.color = new fuels.RGBColor({ red: 34, green: 102, blue: 51 });
fuelDefinitions.push(fuel);
```

---

### DEM Data

**Format Requirements:**

| Property | Requirement |
|----------|-------------|
| Format | GeoTIFF or ASCII Grid |
| Data type | Float32 or Int16 |
| Units | Meters above sea level |
| Projection | Must match fuel grid |
| Cell size | Must match fuel grid |

**Optional but Recommended:**
- Required for terrain effects on fire spread
- Without DEM, simulation assumes flat terrain (slope = 0°)

```typescript
let demGrid = new wise.GridFile();
demGrid.type = GridFileType.ELEVATION;
demGrid.filename = "/path/to/elevation.tif";
demGrid.projection = "/path/to/elevation.prj";
wise_instance.addGridFile(demGrid);
```

---

### Model Duration

| Parameter | Type | Description |
|-----------|------|-------------|
| **Start Time** | DateTime | Simulation begin |
| **End Time** | DateTime | Simulation end |
| **Display Interval** | Duration | Output frequency |

**Duration Configuration:**
```typescript
let scenario = new wise.Scenario();
scenario.lStartTime = DateTime.fromISO("2024-07-15T12:00:00");
scenario.lEndTime = DateTime.fromISO("2024-07-16T18:00:00");
scenario.displayInterval = Duration.fromISO("PT1H"); // Hourly outputs
```

**Display Interval Options:**

| Interval | ISO 8601 | Use Case |
|----------|----------|----------|
| 15 minutes | `PT15M` | High-detail animations |
| 1 hour | `PT1H` | Standard output |
| Daily | `PT24H` | Extended forecasts |

---

## Execution Details

### Job Submission Pattern

WISE uses Builder to generate FGMJ job files:

```typescript
import * as modeller from 'wise_js_api';

const wise = new modeller.wise.WISE();
wise.setName("Fire Simulation");

// Configure inputs...

// Validate before submission
let validation = wise.checkValid();
if (validation.length > 0) {
  validation.forEach(error => {
    console.error(`${error.propertyName}: ${error.message}`);
  });
  throw new Error("Job configuration invalid");
}

// Submit job
const job = await wise.beginJobPromise();
const jobName = job.name.replace(/^\s+|\s+$/g, "");
console.log(`Job submitted: ${jobName}`);
```

---

### FGMJ File

**FGMJ** = Fire Growth Model Job

| Property | Value |
|----------|-------|
| Location | `{PROJECT_JOBS_FOLDER}/{jobName}/job.fgmj` |
| Format | XML-based job specification |
| Created by | Builder service |
| Purpose | Portable job package for WISE execution |

---

### Working Directory Structure

```
{PROJECT_JOBS_FOLDER}/
└── {jobName}/
    ├── job.fgmj                    # Job specification
    ├── validation.json             # Pre-execution validation
    ├── status.json                 # Real-time job status
    ├── Inputs/
    │   └── [attached input files]
    └── Outputs/
        └── [generated output files]
```

---

### Job Monitoring

**Option 1: Polling status.json**
```typescript
const fs = require('fs');
const statusPath = `${process.env.PROJECT_JOBS_FOLDER}/${jobName}/status.json`;

while (true) {
  const status = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
  if (status.status === 'Complete') break;
  if (status.status === 'Failed') throw new Error(status.errorMessage);
  await sleep(5000);
}
```

**Option 2: MQTT Subscription**
```typescript
import { JobManager } from 'wise_js_api/dist/client';

const manager = new JobManager(jobName);
manager.on('simulationComplete', (args) => {
  console.log('Job completed');
  manager.dispose();
});
await manager.start();
```

---

### Execution Time

Factors affecting runtime:
- Grid resolution (finer = longer)
- Fire size (larger perimeter = more computation)
- Simulation duration
- Fuel heterogeneity
- Server resources

**Note:** WISE runs deterministic simulations - no convergence-based stopping like FireSTARR's Monte Carlo.

---

## Output Details

### Output File Formats

| Output Type | Format | Extension |
|-------------|--------|-----------|
| Fire perimeter | KML | `.kml`, `.kmz` |
| Fire perimeter | Shapefile | `.shp` |
| Grid statistics | GeoTIFF | `.tif` |
| Summary | Text | `.txt` |
| Statistics | CSV/JSON | `.csv`, `.json` |

---

### Output File Names

Outputs are written to `{jobName}/Outputs/`:

| Output | Pattern | Example |
|--------|---------|---------|
| Perimeter KML | `{scenario}_perim.kml` | `Primary_perim.kml` |
| Perimeter SHP | `{scenario}_perim.shp` | `Primary_perim.shp` |
| Grid file | `{scenario}_{statistic}.tif` | `Primary_MAX_ROS.tif` |
| Summary | `{scenario}.txt` | `Primary.txt` |

---

### What Outputs Are Generated

#### Vector Files (VectorFile)

Fire perimeter outputs with time-stepping:

```typescript
let vectorKml = prom.addOutputVectorFileToScenario(
  modeller.wise.VectorFileType.KML,
  'fire_perimeter.kml',
  scenarioStartTime,
  scenarioEndTime,
  scenario
);
vectorKml.multPerim = true;      // Multiple time-stepped perimeters
vectorKml.removeIslands = true;  // Remove unburned holes
```

#### Grid Files (Output_GridFile)

Available statistics (40+):

**Fire Behavior:**
- `MAX_ROS` - Maximum rate of spread (m/min)
- `MAX_FI` - Maximum fire intensity (kW/m)
- `MAX_FL` - Maximum flame length (m)
- `MAX_CFB` - Maximum crown fraction burned

**Perimeter:**
- `BURN_GRID` - Binary burned/unburned
- `FIRE_ARRIVAL_TIME` - Time fire reached each cell
- `ACTIVE_PERIMETER` - Active fire front length

**Rate of Spread Variants:**
- `HROS` - Head rate of spread
- `FROS` - Flank rate of spread
- `BROS` - Back rate of spread

**Area & Perimeter:**
- `TOTAL_BURN_AREA` - Total area burned (m²)
- `TOTAL_PERIMETER` - Fire perimeter length (m)

**Fuel Consumption:**
- `TOTAL_FUEL_CONSUMED` - Total fuel (kg/m²)
- `SURFACE_FUEL_CONSUMED` - Surface fuel
- `CROWN_FUEL_CONSUMED` - Crown fuel

**Weather:**
- `TEMPERATURE`, `WIND_SPEED`, `WIND_DIRECTION`
- `FFMC`, `DMC`, `DC`, `ISI`, `BUI`, `FWI`

```typescript
let gridOutput = prom.addOutputGridFileToScenario(
  modeller.globals.GlobalStatistics.MAX_ROS,
  'max_ros.tif',
  outputTime,
  scenario
);
```

#### Summary Files (SummaryFile)

```typescript
let summary = prom.addOutputSummaryFileToScenario(scenario, "summary.txt");
summary.outputs.outputInputs = true;
summary.outputs.outputLandscape = true;
summary.outputs.outputWxData = true;
```

#### Statistics Files (StatsFile)

```typescript
let stats = prom.addOutputStatsFileToScenario(scenario, 'stats.json');
stats.fileType = modeller.wise.StatsFileType.JSON_ROW;
stats.addColumn(modeller.globals.GlobalStatistics.TOTAL_BURN_AREA);
stats.addColumn(modeller.globals.GlobalStatistics.MAX_ROS);
```

---

### Status Tracking

**validation.json** - Pre-execution validation results

**status.json** - Real-time execution status:
```json
{
  "status": "Running",
  "progress": 45.2,
  "currentScenario": "Primary Scenario",
  "startTime": "2024-07-15T14:00:00Z",
  "elapsedSeconds": 152.3
}
```

**Success Detection:**
```typescript
const status = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
if (status.status === 'Complete') {
  console.log("Job completed successfully");
}
```

---

## Error Scenarios

### Point in Water/Non-Fuel

**Behavior:** Job fails during execution

**Status.json:**
```json
{
  "status": "Failed",
  "errorMessage": "Ignition point is located in non-fuel cell (fuel type 102 - Water)"
}
```

**Prevention:** Pre-check fuel type at ignition location

---

### Missing Required Inputs

**Validation errors for:**
- Missing projection file
- Missing fuel map file
- Missing LUT file
- Missing weather stream

```typescript
let validation = wise.checkValid();
if (validation.length > 0) {
  validation.forEach(error => {
    console.error(`${error.propertyName}: ${error.message}`);
  });
}
```

---

### Weather Data Issues

**Weather doesn't cover simulation period:**
```
"Weather data does not cover the full simulation period."
```

**Missing FWI indices:**
```
"Invalid starting FFMC value for the weather stream."
```

**Fix:** Ensure weather stream dates span entire scenario timeframe.

---

### Server Connection Failures

**Builder unavailable:**
```
Error: connect ECONNREFUSED 127.0.0.1:32479
```

**Timeout:**
```typescript
import { SocketMsg } from 'wise_js_api';
SocketMsg.timeout = 300000;  // Increase timeout to 5 minutes
```

---

## Quick Reference Card

### Minimum Viable Configuration

```typescript
const wise = new modeller.wise.WISE();
wise.setName("Test Fire");

// Fuel grid + LUT
const layer = wise.getLayerInfo();
layer.fuelmapFile = "/data/fuel.tif";
layer.projFile = "/data/fuel.prj";
layer.lutFile = "/data/fuel.lut";

// Weather
const weather = wise.addWeatherStream();
weather.setFilename("/data/weather.txt");
weather.setStartingFFMC(89.5);
weather.setStartingDMC(45.2);
weather.setStartingDC(320.1);
weather.setStartTime("2024-07-15T00:00:00");
weather.setEndTime("2024-07-17T23:59:59");

// Ignition
const ignition = wise.addPointIgnition(
  new LatLon(49.5, -117.2),
  "2024-07-15T14:00:00"
);

// Scenario
const scenario = wise.addScenario();
scenario.setStartTime("2024-07-15T14:00:00");
scenario.setEndTime("2024-07-17T14:00:00");
scenario.addIgnitionReference(ignition.getId());
scenario.addWeatherStream(weather.getId());

// Validate and submit
if (wise.checkValid().length === 0) {
  const job = await wise.beginJobPromise();
}
```

### Success Check

```typescript
const status = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
if (status.status === 'Complete') console.log("SUCCESS");
if (status.status === 'Failed') console.log("FAILED:", status.errorMessage);
```

### Output Files to Collect

```bash
ls -la ${PROJECT_JOBS_FOLDER}/${jobName}/Outputs/
# *.kml - Fire perimeters
# *.shp - Shapefiles
# *.tif - Grid statistics
# *.txt - Summary
# *.json/*.csv - Statistics
```
