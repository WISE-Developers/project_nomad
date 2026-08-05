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
expect_eq "manifest is valid JSON" "ok" \
  "$(printf '%s' "$manifest" | python3 -c 'import json,sys; json.load(sys.stdin); print("ok")' 2>/dev/null || echo invalid)"

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
