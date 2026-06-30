#!/usr/bin/env bash
#
# Regression test for install_nomad_setup.sh :: update_env_value()
#
# Guards the #292 demo lesson: the installer must NOT overwrite a value that is
# already set in an existing .env (set-if-absent), so re-running it can't clobber
# a manually-tuned config (e.g. NOMAD_FRONTEND_HOST_PORT, which the Cloudflare
# tunnel depends on). It must still fill empty / commented / missing keys.
#
# Standalone: extracts the REAL function from the installer and exercises it
# against a throwaway .env. Exit 0 = all pass, 1 = any failure.
# Deps: bash, sed, grep only.
set -u

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALLER="$TEST_DIR/../install_nomad_setup.sh"
[ -f "$INSTALLER" ] || { echo "installer not found at $INSTALLER"; exit 1; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# Extract the real function + a minimal harness (stub the printers), then source.
sed -n '/^update_env_value() {/,/^}/p' "$INSTALLER" > "$tmp/fn.sh"
cat > "$tmp/harness.sh" <<EOF
DRY_RUN=false
ENV_FILE="$tmp/.env"
print_dry_run(){ :; }
print_info(){ :; }
source "$tmp/fn.sh"
EOF

run() { bash -c "source '$tmp/harness.sh'; $1"; }

pass=0; fail=0
expect_line() { # desc, exact-line
  if grep -qx "$2" "$tmp/.env"; then echo "  ok   - $1"; pass=$((pass+1))
  else echo "  FAIL - $1 (.env: $(tr '\n' '|' < "$tmp/.env"))"; fail=$((fail+1)); fi
}
expect_single() { # key
  local n; n="$(grep -c "^$1=" "$tmp/.env")"
  if [ "$n" -eq 1 ]; then echo "  ok   - single $1"; pass=$((pass+1))
  else echo "  FAIL - $1 appears $n times (expected 1)"; fail=$((fail+1)); fi
}

# 1. existing non-empty value is PRESERVED (the regression this guards)
printf 'NOMAD_FRONTEND_HOST_PORT=53000\n' > "$tmp/.env"
run 'update_env_value NOMAD_FRONTEND_HOST_PORT 3901'
expect_line "existing non-empty value preserved" "NOMAD_FRONTEND_HOST_PORT=53000"
expect_single NOMAD_FRONTEND_HOST_PORT

# 2. present-but-empty value is filled
printf 'PORT=\n' > "$tmp/.env"
run 'update_env_value PORT 4901'
expect_line "empty value filled" "PORT=4901"
expect_single PORT

# 3. commented default is uncommented + set
printf '#FIRESTARR_EXECUTION_MODE=docker\n' > "$tmp/.env"
run 'update_env_value FIRESTARR_EXECUTION_MODE metal'
expect_line "commented default set" "FIRESTARR_EXECUTION_MODE=metal"
expect_single FIRESTARR_EXECUTION_MODE

# 4. missing key is appended
printf 'OTHER=x\n' > "$tmp/.env"
run 'update_env_value NOMAD_DEPLOYMENT_MODE SAN'
expect_line "missing key appended" "NOMAD_DEPLOYMENT_MODE=SAN"
expect_single NOMAD_DEPLOYMENT_MODE

echo
echo "update_env_value: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
