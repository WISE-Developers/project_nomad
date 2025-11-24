# FireSTARR I/O Documentation

## Input Requirements

### Ignition Point Format

| Format | Supported | Details |
|--------|-----------|---------|
| **Lat/Long** | ✅ Primary | Decimal degrees, WGS84, passed as CLI positional args |
| **Shapefile** | ❌ Direct | Must convert to raster first |
| **GeoJSON** | ❌ Direct | Python layer converts to raster internally |
| **WKT** | ❌ | Not supported |
| **GeoTIFF Perimeter** | ✅ | Via `--perim <path.tif>` flag |

**CLI Pattern:**
```bash
firestarr <output_dir> <yyyy-mm-dd> <lat> <lon> <HH:MM> [options]

# Example with point ignition
firestarr /output 2024-07-15 49.5123 -117.2456 14:00 --wx weather.csv --ffmc 89.5 --dmc 45.2 --dc 320.1

# Example with perimeter
firestarr /output 2024-07-15 49.5123 -117.2456 14:00 --wx weather.csv --ffmc 89.5 --dmc 45.2 --dc 320.1 --perim fire_perim.tif
```

**Perimeter Raster Requirements:**
- Must align with fuel grid (same CRS, cell size, extent)
- Non-zero cell values = burned area
- Zero or NoData = unburned
- Python orchestration layer handles vector→raster conversion via GDAL `RasterizeLayer()`

---

### Coordinate System

| Context | CRS | EPSG |
|---------|-----|------|
| **Input lat/lon** | WGS84 | 4326 |
| **Internal processing** | UTM NAD83 | Zone-dependent (e.g., 32610 for Zone 10N) |
| **Fuel/DEM grids** | UTM NAD83 | Must match processing zone |
| **Output rasters** | UTM NAD83 | Same as input grids |

**UTM Zone Selection (automatic):**
```python
# From gis/make_grids.py
ZONE = 15 + (longitude + 93.0) / 6.0
# Example: lon=-117 → Zone 11
```

---

### Date/Time Format

| Parameter | Format | Example |
|-----------|--------|---------|
| **Start date** | `yyyy-mm-dd` | `2024-07-15` |
| **Start time** | `HH:MM` | `14:00` |
| **Weather datetime** | ISO 8601 | `2024-07-15T14:00:00Z` |

**Time handling:**
- Start time is **local solar time** (used for sunrise/sunset calculations)
- Weather CSV timestamps should be **UTC**
- Internal sunrise/sunset calculated from lat/lon

---

### Weather Data Format

**Format:** CSV with specific column headers

**Required columns:**

| Column | Type | Units | Description |
|--------|------|-------|-------------|
| `datetime` | string | ISO 8601 | Hourly timestamp |
| `temp` | float | °C | Temperature |
| `rh` | float | % | Relative Humidity (0-100) |
| `ws` | float | km/h | Wind Speed |
| `wd` | float | degrees | Wind Direction (0-360, from) |
| `prec` | float | mm | Precipitation (1-hour accumulation) |
| `ffmc` | float | 0-101 | Fine Fuel Moisture Code |
| `dmc` | float | 0+ | Duff Moisture Code |
| `dc` | float | 0+ | Drought Code |
| `isi` | float | 0+ | Initial Spread Index |
| `bui` | float | 0+ | Build-up Index |
| `fwi` | float | 0+ | Fire Weather Index |

**Sample weather.csv:**
```csv
datetime,temp,rh,ws,wd,prec,ffmc,dmc,dc,isi,bui,fwi
2024-07-15T12:00:00Z,28.5,25,15,270,0.0,92.1,48.3,325.6,12.4,68.2,28.5
2024-07-15T13:00:00Z,29.2,23,18,265,0.0,92.8,48.3,325.6,15.1,68.2,32.1
2024-07-15T14:00:00Z,30.1,21,20,260,0.0,93.2,48.3,325.6,17.3,68.2,35.8
2024-07-15T15:00:00Z,30.8,19,22,255,0.0,93.5,48.3,325.6,19.2,68.2,38.9
```

**Key notes:**
- Hourly data required for entire simulation duration
- FWI indices (FFMC, DMC, DC, ISI, BUI, FWI) must be pre-calculated
- The C++ binary does NOT calculate daily FWI from raw weather - expects it in CSV

---

### Required vs Optional Parameters

**Absolute Minimum to Run:**

| Parameter | How Provided | Required |
|-----------|--------------|----------|
| Output directory | Positional arg 1 | ✅ |
| Start date | Positional arg 2 | ✅ |
| Latitude | Positional arg 3 | ✅ |
| Longitude | Positional arg 4 | ✅ |
| Start time | Positional arg 5 | ✅ |
| Weather file | `--wx <path>` | ✅ |
| Previous FFMC | `--ffmc <value>` | ✅ |
| Previous DMC | `--dmc <value>` | ✅ |
| Previous DC | `--dc <value>` | ✅ |

**Optional Parameters:**

| Parameter | Flag | Default |
|-----------|------|---------|
| Previous precipitation | `--apcp_prev` | 0.0 |
| Perimeter raster | `--perim <path>` | Point ignition |
| Initial fire size | `--size <ha>` | ~0.01 ha (1 cell) |
| Raster root directory | `--raster-root <path>` | From settings.ini |
| Fuel lookup table | `--fuel-lut <path>` | From settings.ini |
| Output date offsets | `--output_date_offsets` | [1,2,3,7,14] |
| Log file | `--log <path>` | firestarr.log |
| Verbosity | `-v` (repeatable) | LOG_NOTE level |
| Disable probability output | `--no-probability` | Enabled |

**Minimal command:**
```bash
firestarr /output 2024-07-15 49.5 -117.2 14:00 \
  --wx weather.csv \
  --ffmc 89.5 \
  --dmc 45.2 \
  --dc 320.1
```

---

### Fuel Type Data

**Required:** Yes

**Format:** GeoTIFF raster

| Property | Requirement |
|----------|-------------|
| Data type | UInt16 or Int16 |
| Cell size | 100m default (configurable) |
| Projection | UTM NAD83 |
| NoData value | 0 |
| File naming | `fuel_{zone}.tif` (e.g., `fuel_11.tif`) |

**Fuel Lookup Table (.lut):**

Prometheus-compatible CSV format:
```csv
grid_value,export_value,descriptive_name
1,1,C-1
2,2,C-2
3,3,C-3
4,4,C-4
5,5,C-5
6,6,C-6
7,7,C-7
11,11,D-1
21,21,M-1
22,22,M-2
31,31,M-3
32,32,M-4
40,40,S-1
41,41,S-2
42,42,S-3
50,50,O-1a
51,51,O-1b
101,101,Non-fuel
102,102,Water
```

**Location:** Specified in `settings.ini`:
```ini
FUEL_LOOKUP_TABLE = ./fuel.lut
RASTER_ROOT = ../data/generated/grid/100m
```

**How fuel grid is found:**
```cpp
// From Environment.cpp - searches for fuel grid matching UTM zone
// Pattern: {RASTER_ROOT}/{year}/fuel_{zone}.tif
// Fallback: {RASTER_ROOT}/default/fuel_{zone}.tif
```

---

### DEM Data

**Required:** Yes (for slope/aspect calculation)

**Format:** GeoTIFF raster

| Property | Requirement |
|----------|-------------|
| Data type | Int16 |
| Units | Meters |
| Cell size | Must match fuel grid |
| Projection | Must match fuel grid |
| File naming | `dem_{zone}.tif` |

**Slope/Aspect Calculation:**
- Computed on-the-fly using Horn's algorithm from DEM
- Not stored as separate rasters
- NoData cells in DEM → slope/aspect undefined → fire cannot spread through

---

### Model Duration

**Specification method:** Implicit from weather data + output date offsets

| Parameter | How Set | Default |
|-----------|---------|---------|
| Simulation duration | Length of weather CSV | Until weather ends |
| Output snapshots | `--output_date_offsets` | [1,2,3,7,14] days |
| Maximum runtime | `MAXIMUM_TIME` in settings.ini | 36000 seconds (10 hours) |

**Output date offsets:**
```bash
--output_date_offsets [1,2,3,7,14]
# Produces: probability_1day.tif, probability_2day.tif, etc.
```

**To run for specific duration:**
- Provide weather CSV with exactly the hours needed
- Set `OUTPUT_DATE_OFFSETS` to desired snapshot days

---

## Execution Details

### Command Structure

**Full command template:**
```bash
/path/to/firestarr \
  <output_directory> \
  <yyyy-mm-dd> \
  <latitude> \
  <longitude> \
  <HH:MM> \
  --wx <weather_file.csv> \
  --ffmc <previous_ffmc> \
  --dmc <previous_dmc> \
  --dc <previous_dc> \
  [--apcp_prev <mm>] \
  [--perim <perimeter.tif>] \
  [--size <hectares>] \
  [--output_date_offsets [1,2,3,7,14]] \
  [--raster-root <path>] \
  [--fuel-lut <path>] \
  [-v] [-v] [-v]
```

**Docker execution:**
```bash
docker compose run firestarr /appl/firestarr/firestarr \
  /appl/data/sims/fire_001 \
  2024-07-15 \
  49.5123 \
  -117.2456 \
  14:00 \
  --wx /appl/data/sims/fire_001/weather.csv \
  --ffmc 89.5 \
  --dmc 45.2 \
  --dc 320.1 \
  --apcp_prev 0.0 \
  -v
```

**Test mode:**
```bash
firestarr test <output_dir> --hours 5 [--fuel C-2] [--ffmc 90] [--ws 20]
```

---

### Working Directory

**Binary location requirements:**
- `settings.ini` must be in same directory as binary OR specified via `--settings`
- `fuel.lut` path relative to binary directory OR absolute

**Expected folder structure:**
```
/appl/
├── firestarr/
│   ├── firestarr          # Binary
│   ├── settings.ini       # Configuration
│   ├── fuel.lut          # Fuel lookup table
│   └── bounds.geojson    # Optional bounds definition
├── data/
│   ├── generated/
│   │   └── grid/
│   │       └── 100m/
│   │           ├── default/
│   │           │   ├── fuel_10.tif
│   │           │   ├── fuel_11.tif
│   │           │   ├── dem_10.tif
│   │           │   └── dem_11.tif
│   │           └── 2024/           # Year-specific overrides
│   │               └── fuel_11.tif
│   └── sims/
│       └── fire_001/               # Simulation working directory
│           ├── weather.csv
│           ├── fire_001.tif        # Optional perimeter
│           └── [outputs written here]
```

---

### Input File Locations

| File | Location | Notes |
|------|----------|-------|
| Weather CSV | Any path (specified via `--wx`) | Typically in simulation directory |
| Perimeter TIF | Any path (specified via `--perim`) | Must align with fuel grid |
| Fuel grids | `{RASTER_ROOT}/{year or default}/` | Auto-discovered by zone |
| DEM grids | `{RASTER_ROOT}/{year or default}/` | Auto-discovered by zone |
| Fuel LUT | Binary directory or `--fuel-lut` | Prometheus format |
| Settings | Binary directory | `settings.ini` |

---

### Execution Time

**Typical runtimes (100m grid, convergence at 10%):**

| Fire Size | Duration | Simulations | Runtime |
|-----------|----------|-------------|---------|
| < 100 ha | 3 days | ~500-1000 | 2-5 min |
| 100-1000 ha | 7 days | ~1000-3000 | 5-15 min |
| 1000-5000 ha | 14 days | ~3000-5000 | 15-45 min |
| > 5000 ha | 14 days | ~5000-10000 | 45-120 min |

**Factors affecting runtime:**
- Number of Monte Carlo iterations (max 10,000 default)
- Convergence threshold (default 10%)
- Grid resolution (100m default)
- Fire complexity (crowning, multiple spread directions)
- Weather variability (more variable = more iterations needed)

**Runtime limits (settings.ini):**
```ini
MAXIMUM_TIME = 36000          # 10 hours max wall-clock time
MAXIMUM_SIMULATIONS = 10000   # Max Monte Carlo iterations
CONFIDENCE_LEVEL = 0.1        # Stop when stats stable within 10%
INTERIM_OUTPUT_INTERVAL = 240 # Write interim results every 4 min
```

---

### Exit Codes

| Exit Code | Meaning |
|-----------|---------|
| 0 | Success |
| -1 | General error (check logs) |
| Non-zero | Failure (various causes) |

**Success detection (from Python orchestration):**
```python
SUCCESS_TEXT = "Total simulation time was"
# Check if this string appears in log file
```

**Programmatic check:**
```bash
if grep -q "Total simulation time was" firestarr.log; then
  echo "Success"
else
  echo "Failed"
fi
```

---

### Log Files

**Default location:** `<output_directory>/firestarr.log`

**Log levels (controlled by `-v` flags):**
- Default: `LOG_NOTE` (important messages only)
- `-v`: `LOG_INFO`
- `-v -v`: `LOG_DEBUG`
- `-v -v -v`: `LOG_VERBOSE`

**Log format:**
```
[NOTE] FireSTARR 0.1.0 <2024-07-15T10:30:00Z>
[NOTE] Arguments are:
/appl/firestarr/firestarr /output 2024-07-15 49.5 -117.2 14:00 --wx weather.csv --ffmc 89.5 --dmc 45.2 --dc 320.1
[INFO] Reading fuel lookup table from './fuel.lut'
[INFO] Loading environment for zone 11
[NOTE] Loaded burned area of size 150 ha
[INFO] Running scenario 1 of 10000
...
[NOTE] Convergence achieved at iteration 2847
[NOTE] Total simulation time was 342.5 seconds
```

**Error patterns to parse:**
```
[FATAL] Unable to read file ...
[ERROR] Invalid fuel type ...
[WARNING] Raster projection mismatch ...
[FATAL] Point is in non-fuel cell
```

---

## Output Details

### Output File Formats

| Output Type | Format | Extension |
|-------------|--------|-----------|
| Burn probability | GeoTIFF | `.tif` |
| Fire perimeter | GeoTIFF | `.tif` |
| Simulation log | Text | `.log` |
| Interim probability | GeoTIFF | `.tif` |

**All rasters are GeoTIFF with:**
- LZW compression
- Tiled (256x256)
- Float32 for probability, Byte for perimeter
- Embedded CRS (UTM NAD83)

---

### Output File Names

**Predictable naming pattern:**

| Output | Filename Pattern | Example |
|--------|------------------|---------|
| Final probability | `probability_{N}day.tif` | `probability_1day.tif` |
| Interim probability | `interim_probability_{N}day.tif` | `interim_probability_1day.tif` |
| Fire perimeter | `{fire_name}_{N}day.tif` | `fire_001_1day.tif` |
| Log file | `firestarr.log` | `firestarr.log` |

**Output directory contents after successful run:**
```
/output/
├── firestarr.log
├── probability_1day.tif
├── probability_2day.tif
├── probability_3day.tif
├── probability_7day.tif
├── probability_14day.tif
├── fire_001_1day.tif      # If perimeter output enabled
├── fire_001_2day.tif
└── ...
```

---

### Output Coordinate System

**Same as input fuel/DEM grids** - UTM NAD83

| Property | Value |
|----------|-------|
| CRS | UTM NAD83 (zone from ignition point) |
| Cell size | Same as input (typically 100m) |
| Extent | Same as input fuel grid |
| Origin | Upper-left corner |

**To convert to WGS84 for web display:**
```bash
gdalwarp -t_srs EPSG:4326 probability_1day.tif probability_1day_wgs84.tif
```

---

### What Outputs Are Generated

#### ✅ Burn Probability at Each Time Step
- `probability_{N}day.tif`
- Float32 values [0.0 - 1.0]
- Probability that cell burns by day N
- Generated for each day in `OUTPUT_DATE_OFFSETS`

#### ✅ Time-Stepped Perimeters
- `{fire_name}_{N}day.tif`
- Byte values (0 = unburned, 1+ = burned)
- Can be disabled with `--no-probability` (counterintuitively named)

#### ❌ Intensity Data
- Not output by default
- Code exists but disabled: `NO_INTENSITY = ""`
- Internal tracking for CFB calculations only

#### ❌ Rate of Spread Grids
- Not directly output
- Used internally for spread calculations
- Would require code modification to export

#### ✅ Statistical Convergence Info
- In log file only
- Number of simulations run
- Final convergence percentage

#### ✅ Interim Results (during long runs)
- `interim_probability_{N}day.tif`
- Written every `INTERIM_OUTPUT_INTERVAL` seconds (default 240)
- Replaced by final outputs on completion

---

### File Sizes

**Typical output sizes (100m resolution):**

| Fire Extent | Single Probability TIF | All Outputs (5 days) |
|-------------|------------------------|----------------------|
| 10 km × 10 km | 200-400 KB | 1-2 MB |
| 50 km × 50 km | 2-5 MB | 10-25 MB |
| 100 km × 100 km | 8-20 MB | 40-100 MB |
| 200 km × 200 km | 30-80 MB | 150-400 MB |

**Factors affecting size:**
- Grid extent (not just fire size - full fuel grid extent)
- Compression efficiency (fire areas compress poorly)
- Number of output time steps

**Storage planning:**
```
Per simulation: 10-100 MB typical
Per day of operations (50 fires): 500 MB - 5 GB
Monthly archive: 15-150 GB
```

---

## Error Scenarios

### Point in Water/Non-Fuel

**Behavior:** Simulation fails immediately

**Log output:**
```
[FATAL] Point is in non-fuel cell
```

**Exit code:** Non-zero

**Detection:**
```python
# From Python layer - pre-check
fuel_value = fuel_grid.sample(lat, lon)
if fuel_value in [0, 101, 102]:  # NoData, Non-fuel, Water
    raise ValueError("Ignition point in non-burnable area")
```

---

### Date in Past Without Historical Weather

**Behavior:** Depends on weather source configuration

**If weather CSV missing/empty:**
```
[FATAL] Unable to read file weather.csv
```

**If weather CSV has wrong dates:**
```
[ERROR] Weather data does not cover simulation period
```

**Python orchestration behavior:**
- CWFIS/CWFIF APIs only return recent/forecast data
- Historical runs require pre-staged weather files
- No automatic historical data retrieval

---

### Invalid Coordinates

**Out of bounds (no fuel grid):**
```
[FATAL] No fuel grid found for zone XX
```

**Invalid values:**
```
[FATAL] Invalid latitude: must be between -90 and 90
[FATAL] Invalid longitude: must be between -180 and 180
```

**In ocean/outside Canada:**
```
[FATAL] Point is in non-fuel cell
```

---

### Model Run Fails Mid-Execution

**Possible causes and behaviors:**

| Cause | Behavior | Recovery |
|-------|----------|----------|
| Out of memory | Crash, no output | Reduce grid extent or resolution |
| Disk full | Partial outputs, error in log | Clean disk, re-run |
| Timeout (`MAXIMUM_TIME`) | Interim outputs preserved | Increase timeout or accept interim |
| Weather data ends | Simulation stops at last hour | Extend weather data |
| Numerical instability | Crash or hang | Check weather values for extremes |

**Interim output preservation:**
- Interim files written every `INTERIM_OUTPUT_INTERVAL` seconds
- If crash occurs, most recent interim files remain
- Python orchestration detects interim vs final by filename prefix

**Detecting incomplete runs:**
```bash
# No "Total simulation time was" in log = incomplete
if ! grep -q "Total simulation time was" firestarr.log; then
  # Check for interim files
  if ls interim_probability_*.tif 1> /dev/null 2>&1; then
    echo "Partial results available"
  else
    echo "Complete failure"
  fi
fi
```

---

### Additional Error Scenarios

**Misaligned perimeter raster:**
```
[WARNING] Correcting perimeter raster offset by NxN cells
# Attempts automatic correction, may succeed with warning
```

**Invalid fuel code in grid:**
```
[WARNING] Unknown fuel type 'XX' in fuel lookup table
# Treats as non-fuel, fire won't spread through these cells
```

**Weather value out of range:**
```
[WARNING] FFMC value 105 exceeds valid range [0-101]
# May produce unexpected fire behavior
```

**Projection mismatch:**
```
[FATAL] Fuel and DEM projections do not match
```

---

## Quick Reference Card

### Minimum Viable Command
```bash
firestarr /output 2024-07-15 49.5 -117.2 14:00 \
  --wx weather.csv --ffmc 89 --dmc 45 --dc 320
```

### Full Production Command
```bash
firestarr /output 2024-07-15 49.5123 -117.2456 14:00 \
  --wx weather.csv \
  --ffmc 89.5 \
  --dmc 45.2 \
  --dc 320.1 \
  --apcp_prev 0.0 \
  --perim perimeter.tif \
  --output_date_offsets [1,2,3,7,14] \
  --raster-root /data/grids/100m \
  --fuel-lut /config/fuel.lut \
  -v -v
```

### Success Check
```bash
grep -q "Total simulation time was" firestarr.log && echo "SUCCESS" || echo "FAILED"
```

### Output Files to Collect
```bash
ls -la /output/probability_*.tif /output/firestarr.log
```