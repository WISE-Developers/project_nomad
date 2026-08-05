#!/bin/bash
#
# package_fuels.sh — build the definitive FireSTARR fuel dataset for a year
#
# THIS IS THE ANNUAL WORKFLOW (refs #310/#311/#312). When Jordan sends next
# year's grids:  ./scripts/package_fuels.sh 2027
#
# Takes Jordan's per-year source zip and produces:
#   <out>/<year>/dataset.json                    provenance manifest
#   <out>/<year>/fuel.lut                        shared lookup table
#   <out>/<year>/checksums.txt                   sha256 of every file
#   <out>/<year>/generated/grid/100m/<year>/*.tif
#   <out>/FireSTARR_Fuel_<year>_V<version>.zip   flat, installable
#
# Then update index.json (baseUrl, default, per-dataset vintage/file/bytes/
# sha256) and publish. The installer reads that index to offer year selection.
#
# CONVENTION: vintage = RUN year (start-of-year fuel state). A run in year N
# uses dataset N. It is NOT off-by-one.
#
# Usage:
#   ./scripts/package_fuels.sh 2027
#   SRC_DIR=/path/to/DataSourcesFromJordan OUT_DIR=/path/to/masterDataSets \
#     ./scripts/package_fuels.sh 2027 2028
#   COG=0 ./scripts/package_fuels.sh 2027      # legacy: copy tiles as-is
#
set -euo pipefail

SRC_DIR="${SRC_DIR:-/Volumes/KINGSTON/FireSTARR_Fuel_Data_Sets/DataSourcesFromJordan}"
OUT_DIR="${OUT_DIR:-/Volumes/KINGSTON/FireSTARR_Fuel_Data_Sets/masterDataSets}"
LUT_SRC="${LUT_SRC:-}"          # optional path to fuel.lut; else reused from source zip
VERSION="${VERSION:-1.0}"
COG="${COG:-1}"                 # 1 = convert tiles to Cloud Optimized GeoTIFF

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
print_step()    { echo -e "${GREEN}▶${NC} $1"; }
print_success() { echo -e "${GREEN}✔${NC} $1"; }
print_warning() { echo -e "${YELLOW}⚠${NC} $1"; }
print_error()   { echo -e "${RED}✖${NC} $1"; }
print_info()    { echo -e "${BLUE}ℹ${NC} $1"; }

# Fuel grids hold categorical class codes; DEM holds continuous elevation.
# They want OPPOSITE compression settings — see cog_opts_for.
is_categorical() {
    case "$(basename "$1")" in
        fuel_*) return 0 ;;
        *)      return 1 ;;
    esac
}

# GDAL flags for one tile. Measured on real 2026 tiles (2026-08-05):
#
#   fuel_11_0.tif  source 25.6MB | no-predictor 24.0MB (-6%) | predictor 29.0MB (+13%)
#   dem_11_0.tif   source 106.5MB | predictor 111.9MB (+5%)  | no-predictor 140.5MB (+32%)
#
# Predictor helps continuous data and hurts categorical data. Getting this
# backwards silently inflates the dataset by tens of percent.
#
# No INTERNAL overviews: they are only needed for online display, and they cost
# +48-55% on the download. External .ovr sidecars are generated separately for
# the data centre (see add_overviews), keeping the shipped .tif bytes identical
# to what is served — one artifact, one checksum, no provenance split.
cog_opts_for() {
    if is_categorical "$1"; then
        echo "-of COG -co COMPRESS=DEFLATE -co OVERVIEWS=NONE"
    else
        echo "-of COG -co COMPRESS=DEFLATE -co PREDICTOR=YES -co OVERVIEWS=NONE"
    fi
}

# Overview resampling for the online sidecars. MODE for categorical: AVERAGE
# invents fuel codes that do not exist (e.g. "103.5" between two classes) and
# compresses far worse.
overview_resampling_for() {
    if is_categorical "$1"; then echo "mode"; else echo "average"; fi
}

# The provenance manifest that ships inside every vintage and is read by
# Nomad's fuel dataset catalog (#319) to show which fuel produced a result.
dataset_json() {
    local year="$1" nfuel="$2" ndem="$3" build_date="$4"
    cat <<JSON
{
  "vintage": $year,
  "edition": "$VERSION",
  "label": "Sam's 100m fuel layer -> UTM grids (Jordan Evens); start-of-$year state, input for $year model runs",
  "source": { "provider": "NRCan/CFS", "producer": "Jordan Evens", "derivedFrom": "Sam's 100m fuel layer" },
  "buildDate": "$build_date",
  "resolution_m": 100,
  "crs": "NAD83 / UTM (per zone; each tile carries its own)",
  "grid": { "path": "generated/grid/100m/$year", "tilePattern": "{fuel|dem}_{zone}_{row}.tif", "fuelTiles": $nfuel, "demTiles": $ndem },
  "fuelLut": "fuel.lut",
  "lutNote": "canonical CWFMF/firestarr-cpp fuel.lut + row 107=Urban (D-1/D-2, clone of 106)"
}
JSON
}

# sha256 over every file, relative paths, excluding the checksum file itself.
write_checksums() {
    local root="$1"
    ( cd "$root" && find . -type f ! -name checksums.txt | sort | while read -r f; do
        if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$f"
        else sha256sum "$f"; fi
      done > checksums.txt )
}

# External overviews for the data centre. Leaves the .tif byte-identical to the
# shipped copy; the .ovr sits beside it and is served, never downloaded.
add_overviews() {
    local dir="$1" f r
    command -v gdaladdo >/dev/null 2>&1 || { print_warning "gdaladdo not found — skipping .ovr sidecars"; return 0; }
    for f in "$dir"/*.tif; do
        r=$(overview_resampling_for "$f")
        ( cd "$dir" && gdaladdo -ro -r "$r" \
            --config COMPRESS_OVERVIEW DEFLATE --config PREDICTOR_OVERVIEW 2 \
            "$(basename "$f")" 2 4 8 16 32 64 128 >/dev/null 2>&1 ) || \
            print_warning "overview generation failed for $(basename "$f")"
    done
}

package_year() {
    local year="$1"
    local zip_src="$SRC_DIR/$year Jordan Evens.zip"
    local root="$OUT_DIR/$year"
    local tiles="$root/generated/grid/100m/$year"
    local build_date; build_date=$(date '+%Y-%m-%d')

    [ -f "$zip_src" ] || { print_error "Source zip not found: $zip_src"; return 1; }
    command -v unzip >/dev/null 2>&1 || { print_error "unzip is required"; return 1; }
    if [ "$COG" = "1" ] && ! command -v gdal_translate >/dev/null 2>&1; then
        print_error "gdal_translate not found — install GDAL, or re-run with COG=0"
        return 1
    fi

    print_step "$year: extracting $(basename "$zip_src")"
    local stage="$OUT_DIR/.staging_$year"
    rm -rf "$stage" "$root"; mkdir -p "$stage" "$tiles"
    unzip -q -o "$zip_src" -d "$stage"

    # Jordan's zips contain a single {year}/ directory of tiles.
    local srctiles="$stage/$year"
    [ -d "$srctiles" ] || srctiles="$(find "$stage" -maxdepth 2 -type d -name '*.tif' -prune -o -maxdepth 2 -type d -print | tail -1)"

    print_step "$year: building tiles (COG=$COG)"
    local n=0 f
    for f in "$srctiles"/*.tif; do
        [ -f "$f" ] || continue
        if [ "$COG" = "1" ]; then
            # shellcheck disable=SC2046
            gdal_translate -q $(cog_opts_for "$f") "$f" "$tiles/$(basename "$f")"
        else
            cp "$f" "$tiles/$(basename "$f")"
        fi
        n=$((n + 1))
    done
    [ "$n" -gt 0 ] || { print_error "$year: no tiles found under $srctiles"; return 1; }

    local nfuel ndem
    nfuel=$(find "$tiles" -name 'fuel_*.tif' | wc -l | tr -d ' ')
    ndem=$(find "$tiles" -name 'dem_*.tif' | wc -l | tr -d ' ')

    # fuel.lut: explicit override, else whatever the source shipped.
    if [ -n "$LUT_SRC" ] && [ -f "$LUT_SRC" ]; then
        cp "$LUT_SRC" "$root/fuel.lut"
    elif [ -f "$stage/fuel.lut" ]; then
        cp "$stage/fuel.lut" "$root/fuel.lut"
    else
        print_warning "$year: no fuel.lut found — dataset will be incomplete"
    fi

    dataset_json "$year" "$nfuel" "$ndem" "$build_date" > "$root/dataset.json"
    write_checksums "$root"
    rm -rf "$stage"

    print_step "$year: zipping"
    local zip_out="$OUT_DIR/FireSTARR_Fuel_${year}_V${VERSION}.zip"
    rm -f "$zip_out"
    ( cd "$root" && zip -q -r "$zip_out" . )

    local bytes sha
    bytes=$(wc -c < "$zip_out" | tr -d ' ')
    if command -v shasum >/dev/null 2>&1; then sha=$(shasum -a 256 "$zip_out" | awk '{print $1}')
    else sha=$(sha256sum "$zip_out" | awk '{print $1}'); fi

    print_success "$year: $nfuel fuel + $ndem dem tiles | zip $bytes bytes"
    print_info "index.json entry:"
    echo "    { \"vintage\": $year, \"version\": \"$VERSION\", \"file\": \"$(basename "$zip_out")\", \"bytes\": $bytes, \"sha256\": \"$sha\", \"label\": \"start-of-$year fuels; input for $year model runs\" },"
}

# Sourcing with PACKAGE_FUELS_LIB=1 loads the functions without running a build,
# so tests can exercise them directly.
if [ -z "${PACKAGE_FUELS_LIB:-}" ]; then
    [ $# -gt 0 ] || { echo "usage: $0 <year> [year...]"; exit 1; }
    mkdir -p "$OUT_DIR"
    for y in "$@"; do package_year "$y"; done
    print_success "DONE. Update index.json with the entries above, then publish."
fi
