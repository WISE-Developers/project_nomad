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
# UPSTREAM IS THE SOURCE OF TRUTH, FETCHED AT BUILD TIME (#461)
#
# The legend that decodes a fuel grid must be THE legend, identically, in every
# dataset we ship. Holding our own copy is what broke that: two shipped vintage
# archives carry a pre-2026 legend with no row 107 (Urban), a value their own
# tiles contain -- 182,355 pixels of it in one real tile. Upstream gained the
# row; our copy did not; nobody noticed for eight months.
#
# A PIN WAS THE WRONG FIX AND IS DELIBERATELY GONE. Pinning our copy by hash
# catches OUR copy drifting, which is not the failure we had. It is blind to
# upstream changing -- the build would pass happily while shipping a stale
# legend -- so it guards the direction that was never the problem. Franco:
# "why pin it at all, why not just let the upstream lut be the source of truth
# and use it all the time?"
#
# So: fetch upstream every build, record the hash in the manifest, hold no
# second copy to go stale. Reproducibility comes from the recorded hash, not
# from a pin -- rebuild an old vintage by checking out upstream at the hash its
# manifest names.
#
# NO SILENT FALLBACK. If the fetch fails the build stops. Falling back to a
# local copy would make the build appear to succeed while shipping whatever
# happened to be on disk, which is the original defect with extra steps.
echo
echo "fuel.lut: upstream fetched as the source of truth"

lbin="$tmp/lbin"; mkdir -p "$lbin"

mk_curl() { # mk_curl <mode>
  cat > "$lbin/curl" <<STUB
#!/usr/bin/env bash
mode="$1"
out=""
while [ \$# -gt 0 ]; do [ "\$1" = "-o" ] && out="\$2"; shift; done
case "\$mode" in
  ok)   printf 'grid_value, export_value, descriptive_name, fuel_type, r, g, b, h, s, l\n' > "\$out"
        i=1; while [ \$i -le 150 ]; do printf '%s,%s,Name,C-2,34,102,51,95,128,68\n' "\$i" "\$i" >> "\$out"; i=\$((i+1)); done
        exit 0 ;;
  fail) exit 22 ;;
  html) printf '<!DOCTYPE html>\n<html><head><title>404: Not Found</title></head></html>\n' > "\$out"; exit 0 ;;
esac
STUB
  chmod +x "$lbin/curl"
}

expect_eq "the sha256 pin is gone" "no" \
  "$(grep -q 'LUT_SHA256' "$SCRIPT" && echo yes || echo no)"

expect_eq "the script names the upstream lut URL" "yes" \
  "$(grep -q 'raw.githubusercontent.com/CWFMF/firestarr-cpp' "$SCRIPT" && echo yes || echo no)"

mk_curl ok
expect_eq "a good fetch succeeds" "0" \
  "$(PATH="$lbin:$PATH" run "LUT_SRC=''; fetch_lut '$tmp/got.lut' >/dev/null 2>&1; echo \$?")"
expect_eq "and writes a lut-shaped file" "yes" \
  "$([ -s "$tmp/got.lut" ] && head -1 "$tmp/got.lut" | grep -q 'grid_value' && echo yes || echo no)"

mk_curl fail
rm -f "$tmp/nofetch.lut"
expect_eq "a failed fetch returns non-zero" "1" \
  "$(PATH="$lbin:$PATH" run "LUT_SRC=''; fetch_lut '$tmp/nofetch.lut' >/dev/null 2>&1; echo \$?")"
expect_eq "a failed fetch leaves no partial file behind" "no" \
  "$([ -e "$tmp/nofetch.lut" ] && echo yes || echo no)"

# THE ONE THAT MATTERS: a 404 page is HTTP 200 with HTML in it. Exit status
# alone cannot tell you the fetch worked.
mk_curl html
rm -f "$tmp/htmlout.lut"
expect_eq "an HTML error page is refused, not accepted as a lut" "1" \
  "$(PATH="$lbin:$PATH" run "LUT_SRC=''; fetch_lut '$tmp/htmlout.lut' >/dev/null 2>&1; echo \$?")"

# LUT_SRC stays, as an EXPLICIT offline override -- never as a fallback.
printf 'grid_value, export_value, descriptive_name, fuel_type, r, g, b, h, s, l\n' > "$tmp/explicit.lut"
i=1; while [ $i -le 150 ]; do printf '%s,%s,Name,C-2,34,102,51,95,128,68\n' "$i" "$i" >> "$tmp/explicit.lut"; i=$((i+1)); done
mk_curl fail   # a fetch would fail; the override must not need one
expect_eq "an explicit LUT_SRC is used without fetching" "0" \
  "$(PATH="$lbin:$PATH" run "LUT_SRC='$tmp/explicit.lut'; resolve_lut '$tmp/viasrc.lut' >/dev/null 2>&1; echo \$?")"

# And every vintage must get the SAME file: resolve once, reuse.
expect_eq "the script resolves the lut once per run, not per year" "yes" \
  "$(grep -q 'RUN_LUT' "$SCRIPT" && echo yes || echo no)"

manifest_lut="$(run "dataset_json 2027 31 31 2026-11-01 deadbeef")"
expect_contains "manifest records the lut sha256" "deadbeef" "$manifest_lut"
expect_eq "manifest does not claim a local augmentation" "no" \
  "$(printf '%s' "$manifest_lut" | grep -q 'row 107' && echo yes || echo no)"

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
