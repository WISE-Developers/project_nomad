#!/usr/bin/env bash
#
# Guards for scripts/lint-ratchet.sh
#
# `npm run lint` had never run in this repo (#386). Now that it does, nothing
# in CI runs it -- verified: the workflows invoke npm ci, build:lib, vitest and
# tsc, but never lint. So all 89 findings can regress freely.
#
# A plain blocking lint job is not the answer while a backlog exists: it would
# fail on every branch from day one, CI would sit permanently red, and everyone
# would learn to ignore it. That is the same "looks like coverage" failure the
# lint situation already was.
#
# So: a ratchet. The committed baseline is a CEILING. CI fails when the count
# grows, and the number is lowered as findings are cleared -- never raised.
#
# Deps: bash, sed, grep only. Exit 0 = all pass, 1 = any failure.
set -u

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RATCHET="$TEST_DIR/../lint-ratchet.sh"
[ -f "$RATCHET" ] || { echo "lint-ratchet.sh not found at $RATCHET"; exit 1; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

sed -n '/^read_baseline() {/,/^}/p'   "$RATCHET" >  "$tmp/fn.sh"
sed -n '/^ratchet_verdict() {/,/^}/p' "$RATCHET" >> "$tmp/fn.sh"

cat > "$tmp/harness.sh" <<EOF
print_error(){ echo "ERROR: \$*"; }
print_warning(){ echo "WARN: \$*"; }
print_success(){ echo "OK: \$*"; }
print_info(){ :; }
source "$tmp/fn.sh"
EOF

pass=0; fail=0
check() { # desc, expected-status, command
  local actual
  bash -c "source '$tmp/harness.sh'; $3" >/dev/null 2>&1 && actual=0 || actual=$?
  if [ "$actual" -eq "$2" ]; then echo "  ok   - $1"; pass=$((pass+1))
  else echo "  FAIL - $1 (status $actual, expected $2)"; fail=$((fail+1)); fi
}

echo "read_baseline"

printf '# a comment\n114\n' > "$tmp/baseline.txt"
check "reads the number, ignoring comments" 0 \
  "[ \"\$(read_baseline '$tmp/baseline.txt')\" = 114 ]"

check "a missing baseline file is an ERROR, not a default of zero" 1 \
  "read_baseline '$tmp/nope.txt'"

printf '# no number here\n' > "$tmp/empty.txt"
check "a baseline with no number is an error" 1 \
  "read_baseline '$tmp/empty.txt'"

echo
echo "ratchet_verdict"

# The whole point: growth fails.
check "FAILS when the count grew"            1 'ratchet_verdict 115 114'
check "passes when the count is unchanged"   0 'ratchet_verdict 114 114'
check "passes when the count shrank"         0 'ratchet_verdict 100 114'
check "passes at zero"                       0 'ratchet_verdict 0 0'

# A ratchet nobody lowers is a ratchet that stops working. Say so.
check "tells you to LOWER the baseline when the count shrank" 0 \
  "ratchet_verdict 100 114 2>&1 | grep -qi 'lower'"

# The failure has to name both numbers or it is not actionable.
check "names both counts when it fails" 0 \
  "ratchet_verdict 115 114 2>&1 | grep -q 115 && ratchet_verdict 115 114 2>&1 | grep -q 114"

# A baseline that is not a number must not be treated as 0 -- that would make
# every run 'pass' by comparing against nothing.
check "refuses a non-numeric baseline" 1 'ratchet_verdict 5 not-a-number'
check "refuses a non-numeric count"    1 'ratchet_verdict oops 114'

echo
echo "passed: $pass   failed: $fail"
[ "$fail" -eq 0 ] || exit 1
