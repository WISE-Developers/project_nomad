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
LUT_SRC="${LUT_SRC:-}"          # override; defaults to the master at $OUT_DIR/fuel.lut

# UPSTREAM IS THE SOURCE OF TRUTH FOR fuel.lut, FETCHED EVERY BUILD (#461).
#
# The legend that decodes a fuel grid must be THE legend, identically, in every
# dataset we ship. Keeping our own copy is what broke that: two shipped vintage
# archives carry a pre-2026 legend with no row 107 (Urban), a value their own
# tiles contain -- 182,355 pixels of it in one real tile. Upstream gained the
# row, our copy did not, and nobody noticed for eight months.
#
# A hash PIN was tried and removed. Pinning our copy catches OUR copy drifting,
# which was never the failure; it is blind to upstream changing, so the build
# would pass happily while shipping a stale legend. Fetching removes the second
# copy entirely, and with it the thing that can go stale.
#
# Reproducibility comes from dataset.json's lutSha256, not from a pin: to
# rebuild an old vintage, check upstream out at the hash its manifest records.
LUT_URL="${LUT_URL:-https://raw.githubusercontent.com/CWFMF/firestarr-cpp/main/fuel.lut}"

# Resolved ONCE per run and reused, so every vintage in a build carries the
# byte-identical file. Fetching per year would risk two vintages built minutes
# apart disagreeing, which is the property this whole change exists to provide.
RUN_LUT=""
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

# Can this band type actually hold this NoData value? (#476)
#
# THE DEFECT THIS EXISTS FOR. Every shipped DEM tile is Int16 declaring
# NoData=-32769. Int16 holds -32768..32767, so the sentinel can never equal a
# stored pixel: the flag is inert and masks nothing. Harmless while the tiles
# are void-filled -- the lowest value across the first eight 2026 tiles was
# -251 -- and a trap for the first DEM that carries real voids, because a void
# read as elevation produces slope and aspect out of nothing and FireSTARR
# consumes both.
#
# Returns 0 when the declaration is fine (including when there is none, which
# is the normal case), 1 when the type cannot hold it.
nodata_representable() {
    local type="$1" value="${2-}"

    # No declaration is not a defect.
    case "$value" in ''|None|none|nan|NaN) return 0 ;; esac

    local lo hi
    case "$type" in
        Byte)    lo=0;      hi=255 ;;
        Int8)    lo=-128;   hi=127 ;;
        UInt16)  lo=0;      hi=65535 ;;
        Int16)   lo=-32768; hi=32767 ;;
        UInt32)  lo=0;      hi=4294967295 ;;
        Int32)   lo=-2147483648; hi=2147483647 ;;
        # Float bands carry their own sentinels, fractional ones included, and
        # are not bounded the way an integer band is.
        *)       return 0 ;;
    esac

    # Integer band: a fractional sentinel cannot be stored either.
    case "$value" in *.*) return 1 ;; esac

    [ "$value" -ge "$lo" ] 2>/dev/null && [ "$value" -le "$hi" ] 2>/dev/null && return 0
    return 1
}

# Does this vintage carry new elevation? (#477)
#
# THE DEFECT THIS ANSWERS. The 2024 and 2025 vintages ship PIXEL-IDENTICAL DEM
# tiles with different bytes: GDAL checksums agree on every tile checked while
# sha256 and byte counts differ. Re-encoded, not re-derived — roughly 3GB per
# vintage of elevation that did not change.
#
# checksums.txt cannot see that, because a file sha256 moves whenever the
# encoding moves. A PIXEL fingerprint survives re-encoding, which is exactly
# the property needed to answer "is this the same elevation as last year?".
#
# Order-independent by construction: the per-tile lines are sorted before
# hashing, so a build that walks tiles in a different order still agrees.
dem_pixel_fingerprint_from() {
    printf '%s\n' "$1" | sed '/^[[:space:]]*$/d' | LC_ALL=C sort | {
        if command -v shasum >/dev/null 2>&1; then shasum -a 256
        else sha256sum; fi
    } | awk '{print $1}'
}

# The same thing over a built tile directory. Uses the GDAL checksum per tile,
# which is a function of the PIXELS and not of the container.
dem_pixel_fingerprint() {
    local dir="$1" f lines=""
    command -v gdalinfo >/dev/null 2>&1 || return 1
    for f in "$dir"/dem_*.tif; do
        [ -f "$f" ] || continue
        local ck
        ck="$(gdalinfo -checksum "$f" 2>/dev/null | grep -m1 Checksum | cut -d= -f2)"
        [ -n "$ck" ] || return 1
        lines="$lines$(basename "$f"):$ck
"
    done
    [ -n "$lines" ] || return 1
    dem_pixel_fingerprint_from "$lines"
}

# Drop a NoData declaration the band type cannot hold (#476).
#
# PIXELS ARE NEVER TOUCHED. The declaration is removed, because a sentinel that
# cannot be stored masks nothing and is only able to mislead the next reader.
# Removing it is also the only honest option: the voids it claims to mark, if
# any existed, would be indistinguishable from elevation and we cannot guess
# which value they took.
#
# Returns 0 when it dropped one, 1 when there was nothing to do.
drop_unusable_nodata() {
    local f="$1" type nd
    command -v gdalinfo >/dev/null 2>&1 || return 1
    read -r type nd <<EOF
$(gdalinfo -json "$f" 2>/dev/null | python3 -c "
import sys, json
try:
    b = json.load(sys.stdin)['bands'][0]
except Exception:
    print('', ''); raise SystemExit
print(b.get('type', ''), b.get('noDataValue', ''))
" 2>/dev/null)
EOF
    [ -n "${type:-}" ] || return 1
    nodata_representable "$type" "${nd:-}" && return 1

    command -v gdal_edit.py >/dev/null 2>&1 || {
        print_warning "$(basename "$f"): declares NoData=$nd which $type cannot hold, and gdal_edit.py is not installed to fix it"
        return 1
    }
    gdal_edit.py -unsetnodata "$f" >/dev/null 2>&1 || return 1
    print_warning "$(basename "$f"): dropped NoData=$nd — $type cannot hold it (#476); pixels untouched"
    return 0
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
    local year="$1" nfuel="$2" ndem="$3" build_date="$4" lut_sha="${5:-}" nodata_dropped="${6:-0}" dem_fp="${7:-}"
    # A correction the build made to the source data is RECORDED (#476). A
    # manifest that reads identically whether or not tiles were edited cannot
    # answer "is this vintage the data Jordan sent?". Absent when nothing was
    # corrected, so the common case stays quiet.
    local nodata_line=""
    if [ "${nodata_dropped:-0}" -gt 0 ] 2>/dev/null; then
        nodata_line="
  \"demNoDataDropped\": $nodata_dropped,
  \"demNoDataNote\": \"source tiles declared a NoData their band type cannot hold (#476); the declaration was removed, pixels untouched\","
    fi
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
  "fuelLut": "fuel.lut",$nodata_line
  "lutSha256": "$lut_sha",
  "demPixelFingerprint": "$dem_fp",
  "demPixelNote": "sha256 over the per-tile GDAL pixel checksums (#477). Survives re-encoding, so two vintages sharing this value carry the SAME elevation however the files were written.",
  "lutNote": "canonical CWFMF/firestarr-cpp fuel.lut, verified by sha256 at build time; identical in every vintage"
}
JSON
}

# Remove macOS metadata from a built dataset.
#
# Four .DS_Store files reached the PUBLISHED 2023-2026 datasets — inside the
# zips, inside checksums.txt, and therefore inside every sha256 in index.json.
# Builds run on a Mac and Finder recreates these at any moment, so this is
# called immediately before checksums AND the zip excludes them again.
strip_mac_metadata() {
    find "$1" \( -name '.DS_Store' -o -name '._*' -o -name '.AppleDouble' \) -delete 2>/dev/null || true
}

# sha256 over every file, relative paths, excluding the checksum file itself.
# Hash one file, using whichever tool this host has. Same idiom as
# write_checksums below, kept separate so verify_lut can be called on an input
# before anything is copied.
sha256_of() {
    if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}'
    else sha256sum "$1" | awk '{print $1}'; fi
}

# Does this file look like a fuel lookup table at all?
#
# THE EXIT STATUS OF A FETCH IS NOT ENOUGH. A 404 page, a captive portal or a
# proxy error arrives as HTTP 200 with HTML in it, and curl reports success.
# Checked by shape: the header line, and a plausible number of rows that start
# with an integer and carry ten comma-separated fields.
looks_like_lut() {
    local f="$1" rows
    [ -s "$f" ] || return 1
    head -1 "$f" | grep -q 'grid_value' || return 1
    rows="$(awk -F, 'NR>1 && $1 ~ /^[0-9]+$/ && NF==10' "$f" | wc -l | tr -d ' ')"
    # The real lut has 150 data rows. A floor rather than an exact count, so a
    # legitimate upstream addition does not fail the build for being bigger.
    [ "${rows:-0}" -ge 100 ]
}

# Fetch the lut from upstream. Fails loudly and cleans up after itself; NEVER
# falls back to a local copy, because a build that appears to succeed while
# shipping whatever was on disk is the original defect with extra steps.
fetch_lut() {
    local dest="$1" part="$1.part"
    rm -f "$part"
    if ! curl -fsSL "$LUT_URL" -o "$part" 2>/dev/null; then
        print_error "Could not fetch fuel.lut from $LUT_URL"
        print_error "  Upstream CWFMF/firestarr-cpp is the source of truth and there is no fallback."
        print_error "  Fix the network, or pass LUT_SRC=<path> to use a local copy DELIBERATELY."
        rm -f "$part"
        return 1
    fi
    if ! looks_like_lut "$part"; then
        print_error "Fetched $LUT_URL but it is not a fuel lookup table"
        print_error "  $(wc -c < "$part" | tr -d ' ') bytes, first line: $(head -c 80 "$part" | tr -d '\n')"
        print_error "  An error page returns HTTP 200, so the download succeeding proves nothing."
        rm -f "$part"
        return 1
    fi
    mv "$part" "$dest"
}

# Resolve the lut for this run, once, into $1.
#
# LUT_SRC is an EXPLICIT offline override, not a fallback. Set it and no fetch
# happens; leave it unset and upstream is authoritative. The distinction is the
# point: an operator choosing a local file is fine, a build quietly settling for
# one is not.
resolve_lut() {
    local dest="$1"
    if [ -n "${LUT_SRC:-}" ]; then
        print_info "Using LUT_SRC=$LUT_SRC (explicit override — not fetching upstream)"
        if ! looks_like_lut "$LUT_SRC"; then
            print_error "LUT_SRC=$LUT_SRC is not a fuel lookup table. Refusing to ship it."
            return 1
        fi
        cp "$LUT_SRC" "$dest" || return 1
        return 0
    fi
    fetch_lut "$dest"
}

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
    local n=0 f nodata_dropped=0
    for f in "$srctiles"/*.tif; do
        [ -f "$f" ] || continue
        case "$(basename "$f")" in .DS_Store|._*) continue ;; esac
        if [ "$COG" = "1" ]; then
            # shellcheck disable=SC2046
            gdal_translate -q $(cog_opts_for "$f") "$f" "$tiles/$(basename "$f")"
        else
            cp "$f" "$tiles/$(basename "$f")"
        fi
        # #476: every shipped DEM tile declares NoData=-32769 on an Int16 band,
        # which cannot hold it. Checked on the OUTPUT, so the shipped file is
        # what gets vouched for.
        if drop_unusable_nodata "$tiles/$(basename "$f")"; then
            nodata_dropped=$((nodata_dropped + 1))
        fi
        n=$((n + 1))
    done
    strip_mac_metadata "$root"
    [ "$n" -gt 0 ] || { print_error "$year: no tiles found under $srctiles"; return 1; }

    local nfuel ndem
    nfuel=$(find "$tiles" -name 'fuel_*.tif' | wc -l | tr -d ' ')
    ndem=$(find "$tiles" -name 'dem_*.tif' | wc -l | tr -d ' ')

    # fuel.lut comes from UPSTREAM, fetched once per run and reused, so every
    # vintage in this build carries the byte-identical legend. Jordan's source
    # zips contain tiles only and never a lut.
    if [ -z "$RUN_LUT" ]; then
        RUN_LUT="$OUT_DIR/.fuel.lut.run"
        if ! resolve_lut "$RUN_LUT"; then
            RUN_LUT=""
            print_error "$year: could not obtain fuel.lut. Refusing to build a dataset without its legend."
            return 1
        fi
        print_step "fuel.lut resolved for this run ($(sha256_of "$RUN_LUT" | cut -c1-12)…)"
    fi
    cp "$RUN_LUT" "$root/fuel.lut"

    local lut_sha
    lut_sha="$(sha256_of "$root/fuel.lut")"
    # #477: a pixel fingerprint over the DEM tiles, so a vintage can say whether
    # its elevation is new. 2024 and 2025 shipped identical pixels in different
    # bytes, which checksums.txt cannot see.
    local dem_fp=""
    dem_fp="$(dem_pixel_fingerprint "$tiles" || true)"
    [ -n "$dem_fp" ] || print_warning "$year: could not fingerprint the DEM tiles — dataset.json will carry none"
    dataset_json "$year" "$nfuel" "$ndem" "$build_date" "$lut_sha" "$nodata_dropped" "$dem_fp" > "$root/dataset.json"
    # Strip immediately before hashing so checksums.txt can never list a
    # .DS_Store, then exclude them again at zip time in case Finder recreates
    # one while the build is running.
    strip_mac_metadata "$root"
    write_checksums "$root"
    rm -rf "$stage"

    print_step "$year: zipping"
    local zip_out="$OUT_DIR/FireSTARR_Fuel_${year}_V${VERSION}.zip"
    rm -f "$zip_out"
    ( cd "$root" && zip -q -r "$zip_out" . \
        -x '*.DS_Store' -x '*/._*' -x '._*' -x '__MACOSX/*' -x '*.AppleDouble/*' )

    # Belt and braces: prove the published artifact is clean before we ship it.
    if unzip -l "$zip_out" 2>/dev/null | grep -qE '\.DS_Store|/\._|__MACOSX'; then
        print_error "$year: macOS metadata leaked into $zip_out"
        return 1
    fi

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
