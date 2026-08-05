#!/usr/bin/env bash
#
# Dataset size reporting + free-space check (refs #312/#319 follow-up).
#
# The installer used to claim "~50GB" for the dataset archive. The real
# per-year zips are ~2.6-2.9GB and barely compress (already-compressed
# GeoTIFFs), so all four years is ~11GB down + ~11GB installed, not 50. A
# number that wrong is worse than no number: it sends people hunting for a
# disk they don't need, or reassures them when they're actually short.
#
# So the size is now computed from the index's own `bytes` field for the years
# actually chosen, and checked against real free space before downloading
# anything.
#
# Deps: bash 3.x compatible, sed/awk/grep only. Exit 0 = all pass.
set -u

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$TEST_DIR/../install-firestarr-dataset.sh"
[ -f "$SCRIPT" ] || { echo "installer not found at $SCRIPT"; exit 1; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# Extract the functions under test.
for fn in parse_datasets bytes_for_years format_bytes have_free_space; do
  sed -n "/^${fn}() {/,/^}/p" "$SCRIPT" >> "$tmp/fn.sh"
done

cat > "$tmp/harness.sh" <<EOF
RED=""; GREEN=""; YELLOW=""; BLUE=""; NC=""
print_error(){ echo "ERROR: \$1"; }
print_success(){ echo "OK: \$1"; }
print_info(){ echo "INFO: \$1"; }
print_step(){ echo "STEP: \$1"; }
print_warning(){ echo "WARN: \$1"; }
source "$tmp/fn.sh"
EOF

run() { bash -c "source '$tmp/harness.sh'; $1"; }

pass=0; fail=0
expect_eq() { # desc, expected, actual
  if [ "$2" = "$3" ]; then echo "  ok   - $1"; pass=$((pass+1))
  else echo "  FAIL - $1"; echo "         expected: [$2]"; echo "         actual:   [$3]"; fail=$((fail+1)); fi
}

# A miniature index in the real published shape (one dataset object per line).
INDEX='{"schema":"nomad-fuel-datasets/v1","baseUrl":"https://example.test/","default":2026,
{"vintage":2023,"version":"1.0","file":"FireSTARR_Fuel_2023_V1.0.zip","bytes":2832256903,"sha256":"aaa","label":"x"},
{"vintage":2026,"version":"1.0","file":"FireSTARR_Fuel_2026_V1.0.zip","bytes":3000000000,"sha256":"bbb","label":"y"}
}'

# ---- parse_datasets must now carry bytes through -------------------------
rows="$(run "parse_datasets '$INDEX'")"
expect_eq "parse_datasets emits bytes as the 4th field for 2023" \
  "2832256903" "$(printf '%s\n' "$rows" | awk -F'\t' '$1==2023{print $4}')"
expect_eq "parse_datasets still emits vintage/file/sha256" \
  "2023 FireSTARR_Fuel_2023_V1.0.zip aaa" \
  "$(printf '%s\n' "$rows" | awk -F'\t' '$1==2023{print $1, $2, $3}')"

# ---- bytes_for_years sums only the chosen years --------------------------
expect_eq "bytes_for_years sums a single year" \
  "2832256903" "$(run "rows=\$(parse_datasets '$INDEX'); bytes_for_years \"\$rows\" '2023'")"
expect_eq "bytes_for_years sums multiple years" \
  "5832256903" "$(run "rows=\$(parse_datasets '$INDEX'); bytes_for_years \"\$rows\" '2023 2026'")"
expect_eq "bytes_for_years ignores a year not in the index" \
  "2832256903" "$(run "rows=\$(parse_datasets '$INDEX'); bytes_for_years \"\$rows\" '2023 1999'")"
expect_eq "bytes_for_years is 0 for no years" \
  "0" "$(run "rows=\$(parse_datasets '$INDEX'); bytes_for_years \"\$rows\" ''")"

# ---- format_bytes renders something a human can act on -------------------
# DECIMAL GB (10^9), matching the index's `bytes` field and how the published
# zips are described. Note this differs from `du -h`/`ls -lh`, which report GiB
# (2^30): 2832256903 bytes is 2.8 GB but 2.6 GiB. The free-space COMPARISON is
# done in raw bytes either way, so the unit only affects the message a human
# reads — but it must be labelled honestly, because someone sizing a disk off
# "2.6" when the real figure is "2.8" is exactly the failure this replaces.
expect_eq "format_bytes renders decimal GB with one decimal" "2.8 GB" "$(run "format_bytes 2832256903")"
expect_eq "format_bytes handles multi-year totals" "5.8 GB" "$(run "format_bytes 5832256903")"
expect_eq "format_bytes reports 0 without dividing by zero" "0.0 GB" "$(run "format_bytes 0")"

# ---- have_free_space compares against real df output ---------------------
# 1 byte required on an existing dir must always pass.
run "have_free_space '$tmp' 1" >/dev/null 2>&1
expect_eq "have_free_space passes when the requirement is trivially small" "0" "$?"

# An absurd requirement (1 EB) must fail rather than silently continue.
run "have_free_space '$tmp' 1152921504606846976" >/dev/null 2>&1
expect_eq "have_free_space fails when the requirement exceeds the disk" "1" "$?"

# Must resolve the nearest existing parent for a path not yet created.
run "have_free_space '$tmp/not/created/yet' 1" >/dev/null 2>&1
expect_eq "have_free_space walks up to an existing parent for a new path" "0" "$?"

echo
echo "dataset_space_check: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
