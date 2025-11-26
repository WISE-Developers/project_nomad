# FireSTARR Setup Guide

## Docker Compose Configuration

The `docker-compose.yaml` is configured with volume mounts for:
- `./firestarr_config` → `/appl/firestarr` (binary, settings.ini, fuel.lut)
- `./firestarr_data/grids` → `/appl/data/generated/grid` (fuel/DEM grids)
- `./firestarr_data/sims` → `/appl/data/sims` (simulation inputs/outputs)

## Quick Test (No Fuel Grids Required)

Test mode generates synthetic fuel grids:

```bash
./test_firestarr.sh
```

Or manually:
```bash
docker compose run --rm firestarr /appl/firestarr/firestarr test \
  /appl/data/sims/test_fire \
  --hours 5 \
  --fuel C-2 \
  --ffmc 90 \
  --ws 20
```

## Real Fire Simulation (Requires Fuel/DEM Grids)

### Prerequisites

You need fuel and DEM grids for the UTM zones you want to support:

**For NWT (Northwest Territories):**
- Zone 10: Yukon border region
- Zone 11: Central NWT (Yellowknife area)
- Zone 12: Eastern NWT

Place grids in: `./firestarr_data/grids/100m/default/`

Required files:
```
firestarr_data/grids/100m/default/
├── fuel_10.tif
├── dem_10.tif
├── fuel_11.tif
├── dem_11.tif
├── fuel_12.tif
└── dem_12.tif
```

**Grid specifications:**
- Format: GeoTIFF
- CRS: UTM NAD83 (matching zone)
- Cell size: 100m (default)
- Fuel type: UInt16/Int16 with values matching fuel.lut
- DEM: Int16, units in meters

### Create Weather CSV

Create a weather file: `./firestarr_data/sims/fire_001/weather.csv`

**⚠️ Column names are case-sensitive and order matters!**

```csv
Scenario,Date,PREC,TEMP,RH,WS,WD,FFMC,DMC,DC,ISI,BUI,FWI
0,2024-07-15 12:00:00,0.0,28.5,25.0,15.0,270.0,92.1,48.3,325.6,12.4,68.2,28.5
0,2024-07-15 13:00:00,0.0,29.2,23.0,18.0,265.0,92.8,48.3,325.6,15.1,68.2,32.1
0,2024-07-15 14:00:00,0.0,30.1,21.0,20.0,260.0,93.2,48.3,325.6,17.3,68.2,35.8
0,2024-07-15 15:00:00,0.0,30.8,19.0,22.0,255.0,93.5,48.3,325.6,19.2,68.2,38.9
```

**Notes:**
- `Scenario` column is required - use `0` for single scenario runs
- Column names are ALL CAPS (except `Scenario` and `Date`)
- Date format: `YYYY-MM-DD HH:MM:SS` (no `T` separator, no timezone)
- FWI indices (FFMC, DMC, DC, ISI, BUI, FWI) must be pre-calculated. FireSTARR doesn't compute them from raw weather.

### Run Real Simulation

Example for a fire in NWT (Zone 11):

```bash
docker compose run --rm firestarr /appl/firestarr/firestarr \
  /appl/data/sims/fire_001 \
  2024-07-15 \
  62.4540 \
  -114.3718 \
  14:00 \
  --wx /appl/data/sims/fire_001/weather.csv \
  --ffmc 89.5 \
  --dmc 45.2 \
  --dc 320.1 \
  --apcp_prev 0.0 \
  --output_date_offsets [1,2,3] \
  -v -v
```

## Checking Results

**Success check:**
```bash
grep -q "Total simulation time was" ./firestarr_data/sims/fire_001/firestarr.log && \
  echo "SUCCESS" || echo "FAILED"
```

**List outputs:**
```bash
ls -lh ./firestarr_data/sims/fire_001/
```

Expected outputs:
- `probability_001_<date>.tif` - Burn probability at day 1
- `probability_002_<date>.tif` - Burn probability at day 2
- `probability_003_<date>.tif` - Burn probability at day 3

Where `<date>` is the actual calendar date (e.g., `2024-06-15`).
- `firestarr.log` - Execution log

## Common Issues

### Platform Warning (Apple Silicon)
```
WARNING: The requested image's platform (linux/amd64) does not match the detected host platform (linux/arm64/v8)
```
**Impact:** Runs with emulation (slower but works). No action needed unless performance is critical.

### Point in Non-Fuel Cell
```
[FATAL] Point is in non-fuel cell
```
**Solution:** Check that lat/lon is on land with burnable fuel type. Sample the fuel grid at that location.

### No Fuel Grid Found
```
[FATAL] No fuel grid found for zone XX
```
**Solution:** Ensure `fuel_{zone}.tif` and `dem_{zone}.tif` exist in `./firestarr_data/grids/100m/default/`

### Missing Weather Data
```
[FATAL] Unable to read file weather.csv
```
**Solution:** Ensure weather CSV exists at the path specified in `--wx` flag and has correct format.

## Next Steps for Project Nomad

1. **Get NWT fuel/DEM grids** (zones 10, 11, 12) - where do these come from?
2. **Test with real grids** to validate setup
3. **Weather data integration:**
   - SpotWX API for forecast weather
   - CWFIS API for FWI initialization
   - FWI calculation library (Python `cffdrs` or JS implementation)
4. **Backend development** to orchestrate FireSTARR execution from web interface
5. **Output processing:** Convert UTM GeoTIFF → WGS84 GeoJSON for MapBox display
