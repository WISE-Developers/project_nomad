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
| **Weather Date column** | `YYYY-MM-DD HH:MM:SS` | `2024-07-15 14:00:00` |

**Time handling:**
- Start time is **local solar time** (used for sunrise/sunset calculations)
- Weather CSV timestamps should be **UTC**
- Internal sunrise/sunset calculated from lat/lon

---

### Weather Data Format

**Format:** CSV with specific column headers

**⚠️ CRITICAL: Column names are case-sensitive and order matters!**

**Required columns (EXACT order and case):**

| Column | Type | Units | Description |
|--------|------|-------|-------------|
| `Scenario` | integer | - | Scenario ID (use `0` for single scenario runs) |
| `Date` | string | `YYYY-MM-DD HH:MM:SS` | Hourly timestamp (local time) |
| `PREC` | float | mm | Precipitation (1-hour accumulation) |
| `TEMP` | float | °C | Temperature |
| `RH` | float | % | Relative Humidity (0-100) |
| `WS` | float | km/h | Wind Speed |
| `WD` | float | degrees | Wind Direction (0-360, from) |
| `FFMC` | float | 0-101 | Fine Fuel Moisture Code |
| `DMC` | float | 0+ | Duff Moisture Code |
| `DC` | float | 0+ | Drought Code |
| `ISI` | float | 0+ | Initial Spread Index |
| `BUI` | float | 0+ | Build-up Index |
| `FWI` | float | 0+ | Fire Weather Index |

**Sample weather.csv:**
```csv
Scenario,Date,PREC,TEMP,RH,WS,WD,FFMC,DMC,DC,ISI,BUI,FWI
0,2024-06-03 00:00:00,0.0,16.3,35.0,10.0,88.0,89.9,59.5,450.9,6.99,89.48,23.31
0,2024-06-03 01:00:00,0.0,16.3,35.0,10.0,88.0,89.9,59.5,450.9,6.99,89.48,23.31
0,2024-06-03 02:00:00,0.0,14.3,41.0,11.0,86.0,89.86,59.5,450.9,7.31,89.48,24.05
0,2024-06-03 03:00:00,0.0,14.3,41.0,11.0,86.0,89.82,59.5,450.9,7.27,89.48,23.96
```

**Key notes:**
- **Capitalization matters!** Use exact column names as shown
- **Column order matters!** Follow the exact sequence above
- `Scenario` column is **required** - use `0` for deterministic runs
- Date format is `YYYY-MM-DD HH:MM:SS` (no `T` separator, no timezone suffix)
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

**⚠️ All columns are required - FireSTARR matches fuels based on full text descriptions!**

CSV format with 10 columns:
```csv
grid_value, export_value, descriptive_name, fuel_type, r, g, b, h, s, l
1,1,Spruce-Lichen Woodland,C-1,209,255,115,57,255,185
2,2,Boreal Spruce,C-2,34,102,51,95,128,68
3,3,Mature Jack or Lodgepole Pine,C-3,131,199,149,96,96,165
4,4,Immature Jack or Lodgepole Pine,C-4,112,168,0,57,255,84
5,5,Red and White Pine,C-5,223,184,230,206,122,207
6,6,Conifer Plantation,C-6,172,102,237,192,201,170
7,7,Ponderosa Pine - Douglas-Fir,C-7,112,12,242,188,231,127
11,11,Leafless Aspen,D-1,196,189,151,35,70,174
12,12,Green Aspen (with BUI Thresholding),D-2,137,112,68,27,86,103
21,21,Jack or Lodgepole Pine Slash,S-1,251,190,185,3,227,218
22,22,White Spruce - Balsam Slash,S-2,247,104,161,-272,229,176
23,23,Coastal Cedar - Hemlock - Douglas-Fir Slash,S-3,174,1,126,-285,252,88
31,31,Matted Grass,O-1a,255,255,190,42,255,223
32,32,Standing Grass,O-1b,230,230,0,42,255,115
40,40,Boreal Mixedwood - Leafless,M-1,255,211,127,28,255,191
50,50,Boreal Mixedwood - Green,M-2,255,170,0,28,255,128
70,70,Dead Balsam Fir Mixedwood - Leafless,M-3,99,0,0,0,255,50
80,80,Dead Balsam Fir Mixedwood - Green,M-4,170,0,0,0,255,85
101,101,Non-fuel,D-2,130,130,130,170,0,130
102,102,Water,Non-fuel,115,223,255,138,255,185
```

| Column | Description |
|--------|-------------|
| `grid_value` | Raster cell value |
| `export_value` | Value for exported outputs |
| `descriptive_name` | Full text description (used for internal matching!) |
| `fuel_type` | FBP fuel code (C-1, M-2, etc.) |
| `r, g, b` | RGB color values for display |
| `h, s, l` | HSL color values for display |

**Location:** Specified in `settings.ini`:
```ini
FUEL_LOOKUP_TABLE = ./fuel.lut
RASTER_ROOT = ../data/generated/grid/100m
```

**How fuel grid is found:**

Search order (first match wins):
1. `{RASTER_ROOT}/{year}/fuel_{zone}.tif` - Year-specific override
2. `{RASTER_ROOT}/default/fuel_{zone}.tif` - Default fallback
3. `{RASTER_ROOT}/fuel_{zone}.tif` - Direct in raster root (no subfolder)

This means fuel grids can work without subfolders if placed directly in the raster root.

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
| Maximum runtime | `MAXIMUM_TIME` in settings.ini | 36000 seconds (10 hours) - soft limit* |

**\*MAXIMUM_TIME is a soft limit:** FireSTARR will always complete at least 1 simulation per weather scenario before stopping. After that minimum is met, it stops adding more probabilistic scenarios if the time limit is reached. This ensures you always get at least basic results.

**Output date offsets:**

```bash
--output_date_offsets [1,2,3,7,14]
# Produces: probability_<julian_day>_<yyyy-mm-dd>.tif
# Example: probability_001_2024-06-15.tif, probability_002_2024-06-16.tif, etc.
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

**⚠️ Note:** These are conservative estimates. Actual runtimes are typically faster.

**Typical runtimes (100m grid, convergence at 10%):**

| Fire Size | Duration | Simulations | Runtime |
|-----------|----------|-------------|---------|
| < 100 ha | 3 days | ~500-1000 | 1-3 min |
| 100-1000 ha | 7 days | ~1000-3000 | 3-10 min |
| 1000-5000 ha | 14 days | ~3000-5000 | 10-30 min |
| > 5000 ha | 14 days | ~5000-10000 | 30-60 min |

**Factors affecting runtime:**
- Number of Monte Carlo iterations (max 10,000 default)
- Convergence threshold (default 10%)
- Grid resolution (100m default)
- Fire complexity (crowning, multiple spread directions)
- Weather variability (more variable = more iterations needed)

**Runtime limits (settings.ini):**

```ini
MAXIMUM_TIME = 36000          # Soft limit - completes at least 1 sim per wx scenario
MAXIMUM_SIMULATIONS = 10000   # Max Monte Carlo iterations
CONFIDENCE_LEVEL = 0.1        # Stop when stats stable within 10%
INTERIM_OUTPUT_INTERVAL = 240 # Write interim results every 4 min
```

**Note:** `MAXIMUM_TIME` is NOT a hard cutoff. The simulation will always complete at least one run per weather scenario, then stops adding more probabilistic iterations if time is exceeded.

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

**Naming pattern:** `probability_<julian_day>_<yyyy-mm-dd>.tif`

| Output | Filename Pattern | Example |
|--------|------------------|---------|
| Final probability | `probability_{JD}_{date}.tif` | `probability_001_2024-06-15.tif` |
| Interim probability | `interim_probability_{JD}.tif` | `interim_probability_001.tif` |
| Log file | `firestarr.log` | `firestarr.log` |

Where `{JD}` is the zero-padded julian day offset (001, 002, 003, 007, 014, etc.) and `{date}` is the actual calendar date.

**Output directory contents after successful run:**

```text
/output/
├── firestarr.log
├── probability_001_2024-06-15.tif
├── probability_002_2024-06-16.tif
├── probability_003_2024-06-17.tif
├── probability_007_2024-06-21.tif
├── probability_014_2024-06-28.tif
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