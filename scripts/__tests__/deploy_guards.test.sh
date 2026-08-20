#!/usr/bin/env bash
#
# Guards for scripts/deploy.sh
#
# The CIFFC demo broke mid-deploy because 507 files under /opt/nomad-app —
# including .git internals — were owned by root while the repo and the app run
# as `nomad`. git updated what it could, hit "Permission denied", and left the
# working tree half-applied with HEAD unmoved. Someone had run `sudo git pull`
# by hand; nothing automated does it.
#
# These cover the two guards that stop it happening again: refusing to run as
# root, and detecting ownership drift before touching git.
#
# Deps: bash, sed, grep only. Exit 0 = all pass, 1 = any failure.
set -u

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY="$TEST_DIR/../deploy.sh"
[ -f "$DEPLOY" ] || { echo "deploy.sh not found at $DEPLOY"; exit 1; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

sed -n '/^refuse_root() {/,/^}/p'      "$DEPLOY" >  "$tmp/fn.sh"
sed -n '/^owner_drift_count() {/,/^}/p' "$DEPLOY" >> "$tmp/fn.sh"

cat > "$tmp/harness.sh" <<EOF
print_error(){ echo "ERROR: \$*"; }
print_info(){ :; }
print_warning(){ :; }
source "$tmp/fn.sh"
EOF

pass=0; fail=0
check() { # desc, expected-status, command
  local actual
  bash -c "source '$tmp/harness.sh'; $3" >/dev/null 2>&1 && actual=0 || actual=$?
  if [ "$actual" -eq "$2" ]; then echo "  ok   - $1"; pass=$((pass+1))
  else echo "  FAIL - $1 (status $actual, expected $2)"; fail=$((fail+1)); fi
}

echo "refuse_root"
check "allows a normal user"       0 'refuse_root 1000'
check "refuses uid 0"              1 'refuse_root 0'

echo
echo "owner_drift_count"

# A tree owned entirely by the invoking user has no drift.
mkdir -p "$tmp/clean/sub"
touch "$tmp/clean/a" "$tmp/clean/sub/b"
check "clean tree reports no drift" 0 "[ \"\$(owner_drift_count '$tmp/clean' \$(id -un))\" = 0 ]"

# A tree containing files owned by someone else does.
mkdir -p "$tmp/drift"
touch "$tmp/drift/mine"
# Files here are owned by the invoking user, so measuring drift against root
# must count them. (Using a NON-EXISTENT user would just make find error.)
check "counts files owned by another user" 0 \
  "[ \"\$(owner_drift_count '$tmp/drift' root)\" -ge 1 ]"

check "missing directory reports 0 rather than erroring" 0 \
  "[ \"\$(owner_drift_count '$tmp/nope' \$(id -un))\" = 0 ]"

echo
echo "passed: $pass   failed: $fail"
[ "$fail" -eq 0 ] || exit 1
