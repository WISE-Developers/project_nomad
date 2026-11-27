# Preparing Agency Fuel and Elevation Rasters for FireSTARR

**Applies to:** FireSTARR `CWFMF/firestarr-cpp` (as used by Project Nomad, image `v0.9.7`)
**Basis:** read from the engine source (`Environment.cpp`, `Util.cpp`, `ConstantGrid.cpp`, `projection.cpp`, `Grid.cpp`), the shipped `fuel.lut` and `settings.ini`, and the repo's own test grids. Recipe tested with GDAL 3.8.4.

---

## 1. What FireSTARR actually requires

| Requirement | Fuel grid | Elevation grid |
|---|---|---|
| Format | GeoTIFF, **tiled** | GeoTIFF, **tiled** |
| File name | must match `fuel*.tif` | same name with `fuel` replaced by `dem` (`fuel_11_0.tif` → `dem_11_0.tif`) |
| Data type | Unsigned integer, ≤16-bit (`UInt16`) | Signed integer, ≤16-bit (`Int16`), metres |
| NoData | **must be set** (the run fails if it's missing); `0` is the convention | must be set (`0`, `32767` or `-32768` all appear in practice) |
| Values | must be `grid_value` codes in `fuel.lut` | whole metres |
| Projection | **UTM or Transverse Mercator only** (see §2) | identical to fuel |
| Cell size | square cells; 100 m is the national standard | identical to fuel |
| Extent / origin | — | **pixel-for-pixel identical to fuel**: same width, height, cell size, and lower-left corner. A mismatch is fatal. |

**How the engine finds grids.** It looks under `RASTER_ROOT` (from `settings.ini`, default `./grid`) for the first folder that exists, in this order: `<root>/<model year>/`, then `<root>/default/`, then `<root>/`. It takes every `fuel*.tif` in that folder, skips any whose projection doesn't match the perimeter (when one is supplied), and picks the grid where the ignition point sits **furthest from an edge**. It then reads a window of up to 4096 × 4096 cells (about 410 km at 100 m) around the ignition.

So you can drop in any number of overlapping grids, and the engine chooses the best one per fire.

**The `{zone}_{half}` suffix is required, not cosmetic.** Nomad sorts the candidate grids by the central meridian implied by each name, parsed with `fuel_(\d+)_(\d+)`, so a name like `fuel_11.tif` fails that match, is assigned 999 and sorts last — in overlapping zones a farther grid can then be chosen with no signal.

## 2. The projection rule (where most agency grids fail)

FireSTARR only understands `+proj=utm` and `+proj=tmerc`. It converts UTM zones to Transverse Mercator internally and builds its outputs from those parameters. **Lambert Conformal Conic grids do not work.** The repo's test suite includes a Lambert grid (`test/input/bad_projection/`) as an *expected failure*.

Most provincial and territorial fuel layers are distributed in Lambert or Albers. Examples are NWT Lambert (EPSG:3580), Canada Atlas Lambert (EPSG:3978) and BC Albers (EPSG:3005). All of these **must be reprojected**.

The national dataset handles this with one grid per UTM zone, plus "half-zone" Transverse Mercator grids centred between zones (for example `fuel_11_5.tif`, with `lon_0=-114`). That way fires near a zone boundary still have room to spread. For an agency, one grid per UTM zone covering your area is enough to start. Add half-zones later if fires near zone boundaries get clipped.

## 3. Conversion recipe (GDAL)

Repeat for each UTM zone you need (for NWT: zones 10, 11 and 12; EPSG 26910, 26911, 26912).

**Step 1. Reclassify fuel codes (only if your codes differ from `fuel.lut`).** You can either:
- **(a)** reclassify the raster to the stock `fuel.lut` codes, or
- **(b)** keep your codes and point `FUEL_LOOKUP_TABLE` at your own table.

The table is Prometheus/WISE format (`grid_value, export_value, descriptive_name, fuel_type, r, g, b, h, s, l`), so an agency that already has a Prometheus/WISE LUT can usually reuse it directly. Option (b) is less error-prone than recoding.

Mixedwood percentages are carried in the code itself: `4xx` = M-1, `5xx` = M-2, `6xx` = M-1/M-2 with xx = % conifer; `7xx`–`9xx` = M-3/M-4 with xx = % dead fir (for example `625` = M-1/M-2 at 25 PC). Codes without a percentage fall back to `DEFAULT_PERCENT_CONIFER` (50) or `DEFAULT_PERCENT_DEAD_FIR` (30).

**Step 2. Reproject the fuel grid.** Use nearest neighbour, because fuel is categorical:
```bash
CO="-co TILED=YES -co BLOCKXSIZE=256 -co BLOCKYSIZE=256 -co COMPRESS=LZW"
gdalwarp -t_srs EPSG:26911 -tr 100 100 -tap -r near \
  -ot UInt16 -dstnodata 0 $CO  agency_fuel.tif  fuel_11_0.tif
```

**Step 3. Reproject the DEM onto exactly the same grid.** Take the extent from the new fuel grid so the two match pixel for pixel. Use bilinear resampling for elevation:
```bash
read xmin ymin xmax ymax < <(gdalinfo -json fuel_11_0.tif | python3 -c \
 "import json,sys;c=json.load(sys.stdin)['cornerCoordinates'];print(c['lowerLeft'][0],c['lowerLeft'][1],c['upperRight'][0],c['upperRight'][1])")
gdalwarp -t_srs EPSG:26911 -te $xmin $ymin $xmax $ymax -tr 100 100 -r bilinear \
  -ot Int16 -dstnodata -32768 $CO  agency_dem.tif  dem_11_0.tif
```

**Step 4. Lay out the files.**
```
<RASTER_ROOT>/          (Project Nomad: ${FIRESTARR_DATASET_PATH}/generated/grid/100m/)
├── default/            used for any model year with no year folder
│   ├── fuel_10_0.tif  dem_10_0.tif
│   ├── fuel_11_0.tif  dem_11_0.tif
│   └── fuel_12_0.tif  dem_12_0.tif
└── 2026/               optional: used for 2026 fires; overrides default/
```
Under Nomad's convention, a year folder holds the fuels *for* that season, so its fuel vintage is the year before. A `2026/` folder holds end-of-2025 fuels.

## 4. Check before you run

Check each pair:
```bash
gdalinfo fuel_11_0.tif | grep -E "Block=|NoData|Size is|Pixel Size|Origin"
gdalinfo dem_11_0.tif  | grep -E "Block=|NoData|Size is|Pixel Size|Origin"
```
- `Block=256x256` (or any square tile): the grid is tiled. If you see `Block=NNNNx1`, it's striped and will fail.
- `NoData Value=` is present in both.
- `Size is`, `Pixel Size` and `Origin` are **identical** between fuel and DEM.
- `gdalinfo -hist fuel_11_0.tif` shows only codes that exist in your `fuel.lut`.

Then do a smoke test: run one ignition per zone, well inside the grid, and confirm `firestarr.log` ends with `Total simulation time was`.

## 5. Common failures

| Log message | Cause |
|---|---|
| `NODATA value is not set in input` | No NoData tag. Re-run gdalwarp with `-dstnodata`. |
| `Raster … type is larger than expected type` | Grid is 32-bit or float. Use `-ot UInt16` / `-ot Int16`. |
| `Could not find an environment to use for …` | Ignition is outside every grid, or no `fuel*.tif` in the folder that was picked (check for a stray empty year folder). |
| `Cannot convert proj4 … into .prj file` | Projection isn't UTM or tmerc (Lambert, Albers, geographic). |
| `Point is in non-fuel cell` | Ignition lands on water or non-fuel. Check the code there against `fuel.lut`. |
| Fuel/DEM size or corner mismatch | DEM wasn't snapped to the fuel extent. Redo Step 3. |

---
*The recipe was checked on the repo's Lambert sample grids. The output passes every check in FireSTARR's grid reader (tiled, NoData set, 16-bit, UTM, fuel and DEM aligned). A full FireSTARR run on agency data hasn't been done yet.*
