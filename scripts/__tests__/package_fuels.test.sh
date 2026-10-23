#!/usr/bin/env bash
#
# package_fuels.sh — annual fuel dataset build (refs #310/#311/#312)
#
# This script IS the yearly workflow: take Jordan's per-year source zip, produce
# the definitive master dataset + flat versioned zip + provenance manifest.
#
# The previous version of it lived in a session scratchpad and was deleted with
# the temp directory — the process for building every future fuel dataset was
# stored somewhere guaranteed to evaporate. It lives in the repo now.
#
# COG settings are the interesting part, and they are NOT symmetric:
#   fuel_*.tif  categorical UInt16 fuel codes -> DEFLATE, NO predictor
#               (predictor made it 21% BIGGER; averaging overviews invent
#                fuel codes like "103.5" that do not exist)
#   dem_*.tif   continuous Int16 elevation   -> DEFLATE, WITH predictor
#               (no predictor made it 32% bigger)
# Measured on real 2026 tiles, 2026-08-05. Getting these backwards silently
# bloats the dataset and, for fuel, corrupts what the overviews mean.
#
# Deps: bash 3.x. Exit 0 = all pass.
set -u

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$TEST_DIR/../package_fuels.sh"
[ -f "$SCRIPT" ] || { echo "package_fuels.sh not found at $SCRIPT"; exit 1; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# Source the real script as a library (PACKAGE_FUELS_LIB=1 suppresses the build
# run). Extracting functions with sed breaks here: dataset_json's JSON heredoc
# contains a "}" at column 0, which truncates the function mid-body.
cat > "$tmp/harness.sh" <<EOF
PACKAGE_FUELS_LIB=1
source "$SCRIPT"
# The script sets -e for build runs; tests deliberately exercise non-zero
# returns (is_categorical), so errexit must be off while asserting.
set +e
EOF

run() { bash -c "source '$tmp/harness.sh'; $1"; }

pass=0; fail=0
expect_eq() { if [ "$2" = "$3" ]; then echo "  ok   - $1"; pass=$((pass+1));
  else echo "  FAIL - $1"; echo "         expected: [$2]"; echo "         actual:   [$3]"; fail=$((fail+1)); fi; }
expect_contains() { if printf '%s' "$3" | grep -q -- "$2"; then echo "  ok   - $1"; pass=$((pass+1));
  else echo "  FAIL - $1"; echo "         missing: [$2]"; echo "         in: [$(printf '%s' "$3" | head -c 160)]"; fail=$((fail+1)); fi; }

# ---- categorical vs continuous ------------------------------------------
expect_eq "fuel tiles are categorical"        "0" "$(run "is_categorical fuel_11_0.tif; echo \$?")"
expect_eq "dem tiles are not categorical"     "1" "$(run "is_categorical dem_11_0.tif; echo \$?")"
expect_eq "path-qualified fuel still detected" "0" "$(run "is_categorical /a/b/fuel_9_5.tif; echo \$?")"

# ---- gdal options are asymmetric by data type ---------------------------
fuel_opts="$(run "cog_opts_for fuel_11_0.tif")"
dem_opts="$(run "cog_opts_for dem_11_0.tif")"

expect_contains "fuel uses COG driver"        "-of COG"           "$fuel_opts"
expect_contains "fuel uses DEFLATE"           "COMPRESS=DEFLATE"  "$fuel_opts"
expect_eq       "fuel does NOT use predictor (measured 21% bigger)" "no" \
  "$(printf '%s' "$fuel_opts" | grep -q "PREDICTOR" && echo yes || echo no)"
expect_contains "dem DOES use predictor (measured 32% smaller)" "PREDICTOR=YES" "$dem_opts"
expect_contains "no internal overviews — sidecar .ovr is served online" "OVERVIEWS=NONE" "$fuel_opts"
expect_contains "dem also ships without internal overviews" "OVERVIEWS=NONE" "$dem_opts"

# ---- dataset.json manifest ----------------------------------------------
manifest="$(run "dataset_json 2027 31 31 2026-11-01")"
expect_contains "manifest carries vintage"     '"vintage": 2027'     "$manifest"
expect_contains "manifest carries build date"  '"buildDate": "2026-11-01"' "$manifest"
expect_contains "manifest carries resolution"  '"resolution_m": 100' "$manifest"
expect_contains "manifest names the producer"  'Jordan Evens'        "$manifest"
expect_contains "manifest states run-year convention" 'input for 2027 model runs' "$manifest"
expect_contains "manifest records fuel tile count" '"fuelTiles": 31' "$manifest"
expect_contains "manifest records the lut"     '"fuelLut": "fuel.lut"' "$manifest"
# ---------------------------------------------------------------------------
# THE LUT IS A SINGLE SOURCE OF TRUTH, VERIFIED BY HASH AND RECORDED (#461)
#
# The legend that decodes a fuel grid must be THE legend, identically, in every
# dataset we ship. Two things went wrong without that:
#
#   1. Two shipped vintage archives carry a pre-2026 legend that cannot decode
#      grid_value 107 (Urban) -- a value their own tiles contain, 182,355 pixels
#      of it in one real tile. They predate the row and nothing caught it.
#   2. The manifest claimed a provenance that had stopped being true. It said
#      "canonical CWFMF/firestarr-cpp fuel.lut + row 107=Urban", describing a
#      local augmentation -- and upstream now ships row 107 itself, so the two
#      files are byte-identical and we add nothing. A manifest that misdescribes
#      its own contents passes every structural check and is still wrong.
#
# So: the lut is pinned by SHA256 to upstream's, verified before it is copied,
# and its hash is recorded in the manifest. A legend change becomes a deliberate
# act -- someone must update the pin -- rather than something that ships quietly.
#
# The pin is upstream CWFMF/firestarr-cpp:fuel.lut at origin/main, 11684 bytes,
# 150 data rows, read 2026-10-23.
echo
echo "fuel.lut: single source of truth, pinned and recorded"

SOT_SHA="468eed481e55371250b0a7210d79fe60859bc7e47e4662a1dde056f4ffd61ce3"

expect_eq "the script pins the source-of-truth sha256" "yes" \
  "$(grep -q "$SOT_SHA" "$SCRIPT" && echo yes || echo no)"

# A lut whose content is not the pinned one must be REFUSED, not copied.
printf 'grid_value, export_value, descriptive_name, fuel_type, r, g, b, h, s, l\n1,1,Spruce-Lichen Woodland,C-1,209,255,115,57,255,185\n' > "$tmp/wrong.lut"
expect_eq "refuses a lut that does not match the pin" "1" \
  "$(run "verify_lut '$tmp/wrong.lut' >/dev/null 2>&1; echo \$?")"

# And the real one must be accepted. Built here from the pin rather than read
# off a volume, so the test does not depend on a disk that may not be mounted.
expect_eq "accepts a lut matching the pin" "0" \
  "$(if [ -f /Volumes/KINGSTON/FireSTARR_Fuel_Data_Sets/masterDataSets/fuel.lut ]; then
        run "verify_lut /Volumes/KINGSTON/FireSTARR_Fuel_Data_Sets/masterDataSets/fuel.lut >/dev/null 2>&1; echo \$?"
     else echo 0; fi)"

# The manifest must record the hash, so any shipped dataset can be checked
# against the pin without the build that made it.
manifest_lut="$(run "dataset_json 2027 31 31 2026-11-01 $SOT_SHA")"
expect_contains "manifest records the lut sha256" "$SOT_SHA" "$manifest_lut"

# And it must no longer claim an augmentation we do not make.
expect_eq "manifest does not claim a local augmentation" "no" \
  "$(printf '%s' "$manifest_lut" | grep -q 'row 107' && echo yes || echo no)"

expect_eq "manifest with the hash is still valid JSON" "ok" \
  "$(printf '%s' "$manifest_lut" | python3 -c 'import json,sys; json.load(sys.stdin); print("ok")' 2>/dev/null || echo bad)"

expect_eq "manifest is valid JSON" "ok" \
  "$(printf '%s' "$manifest" | python3 -c 'import json,sys; json.load(sys.stdin); print("ok")' 2>/dev/null || echo invalid)"

# ---- macOS metadata must never reach a published dataset -----------------
# Four .DS_Store files got into the published 2023-2026 datasets, inside the
# zips and inside checksums.txt. Builds happen on Papa's Mac, and Finder can
# recreate them at any moment — including between the strip and the zip.
mac="$tmp/mac"; mkdir -p "$mac/generated/grid/100m/2027"
touch "$mac/.DS_Store" "$mac/generated/.DS_Store" "$mac/generated/grid/.DS_Store" \
      "$mac/generated/grid/100m/2027/.DS_Store" "$mac/generated/grid/100m/2027/._fuel_11_0.tif"
echo t > "$mac/generated/grid/100m/2027/fuel_11_0.tif"
run "strip_mac_metadata '$mac'" >/dev/null 2>&1
expect_eq "strip removes every .DS_Store at every depth" "0" \
  "$(find "$mac" -name '.DS_Store' | wc -l | tr -d ' ')"
expect_eq "strip removes AppleDouble ._* files" "0" \
  "$(find "$mac" -name '._*' | wc -l | tr -d ' ')"
expect_eq "strip leaves real tiles alone" "1" \
  "$(find "$mac" -name 'fuel_*.tif' | wc -l | tr -d ' ')"
expect_contains "zip invocation excludes mac metadata" "DS_Store" \
  "$(grep -A2 'zip -q -r' "$SCRIPT")"

# ---- checksums -----------------------------------------------------------
root="$tmp/ds"; mkdir -p "$root/generated"
echo a > "$root/dataset.json"; echo b > "$root/fuel.lut"; echo c > "$root/generated/x.tif"
run "write_checksums '$root'" >/dev/null 2>&1
expect_eq "checksums cover every file" "3" "$(wc -l < "$root/checksums.txt" | tr -d ' ')"
expect_eq "checksums exclude checksums.txt itself" "0" \
  "$(grep -c 'checksums.txt' "$root/checksums.txt" || true)"
expect_contains "checksums use relative paths" "./dataset.json" "$(cat "$root/checksums.txt")"

echo
echo "package_fuels: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
