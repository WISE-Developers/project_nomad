#!/usr/bin/env bash
#
# Regression test for install_nomad_setup.sh :: update_env_value() — issue #343
#
# The installer copies .env.example to .env, and .env.example ships NON-EMPTY
# placeholders. The #292 fix ("never overwrite an existing non-empty value")
# then preserved those placeholders over the answers the operator gave at the
# prompt. 5.5 GB of fuel rasters landed in a literal directory called
# /absolute/path/to/firestarr_data, and the install reported success.
#
# Both behaviours are individually correct. Together they misdirect the install.
# A placeholder must be treated as ABSENT, while genuine operator values keep
# the #292 protection exactly as before.
#
# Deps: bash, sed, grep only. Exit 0 = all pass, 1 = any failure.
set -u

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALLER="$TEST_DIR/../install_nomad_setup.sh"
[ -f "$INSTALLER" ] || { echo "installer not found at $INSTALLER"; exit 1; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# Extract the real functions + a minimal harness (stub the printers), then source.
sed -n '/^is_placeholder_value() {/,/^}/p' "$INSTALLER" > "$tmp/fn.sh"
sed -n '/^update_env_value() {/,/^}/p' "$INSTALLER" >> "$tmp/fn.sh"
sed -n '/^assert_no_placeholders_in_env() {/,/^}/p' "$INSTALLER" >> "$tmp/fn.sh"
cat > "$tmp/harness.sh" <<EOF
DRY_RUN=false
ENV_FILE="$tmp/.env"
print_dry_run(){ :; }
print_info(){ :; }
print_warning(){ :; }
print_success(){ :; }
print_error(){ :; }
source "$tmp/fn.sh"
EOF

run() { bash -c "source '$tmp/harness.sh'; $1"; }

pass=0; fail=0
expect_line() { # desc, exact-line
  if grep -qx "$2" "$tmp/.env"; then echo "  ok   - $1"; pass=$((pass+1))
  else echo "  FAIL - $1 (.env: $(tr '\n' '|' < "$tmp/.env"))"; fail=$((fail+1)); fi
}

echo "placeholders are treated as absent (#343)"

# 1. THE incident: the dataset path placeholder must not survive.
printf 'FIRESTARR_DATASET_PATH=/absolute/path/to/firestarr_data\n' > "$tmp/.env"
run 'update_env_value FIRESTARR_DATASET_PATH /root/firestarr_data'
expect_line "dataset path placeholder overwritten" "FIRESTARR_DATASET_PATH=/root/firestarr_data"

# 2. Same trap, every OAuth credential.
printf 'NOMAD_OAUTH_GOOGLE_CLIENT_ID=your-google-client-id\n' > "$tmp/.env"
run 'update_env_value NOMAD_OAUTH_GOOGLE_CLIENT_ID 1234-real.apps.googleusercontent.com'
expect_line "your-* placeholder overwritten" "NOMAD_OAUTH_GOOGLE_CLIENT_ID=1234-real.apps.googleusercontent.com"

printf 'NOMAD_OAUTH_MICROSOFT_CLIENT_SECRET=your-microsoft-client-secret\n' > "$tmp/.env"
run 'update_env_value NOMAD_OAUTH_MICROSOFT_CLIENT_SECRET s3cret-value'
expect_line "microsoft placeholder overwritten" "NOMAD_OAUTH_MICROSOFT_CLIENT_SECRET=s3cret-value"

# 3. Other common placeholder spellings.
printf 'NOMAD_DB_PASSWORD=changeme\n' > "$tmp/.env"
run 'update_env_value NOMAD_DB_PASSWORD hunter2'
expect_line "changeme overwritten" "NOMAD_DB_PASSWORD=hunter2"

echo
echo "the #292 protection still holds"

# 4. A genuine operator value must STILL be preserved — this is the whole point
#    of #292 and must not regress.
printf 'NOMAD_FRONTEND_HOST_PORT=53000\n' > "$tmp/.env"
run 'update_env_value NOMAD_FRONTEND_HOST_PORT 3901'
expect_line "genuine value preserved" "NOMAD_FRONTEND_HOST_PORT=53000"

printf 'FIRESTARR_DATASET_PATH=/srv/nomad/data\n' > "$tmp/.env"
run 'update_env_value FIRESTARR_DATASET_PATH /root/firestarr_data'
expect_line "genuine dataset path preserved" "FIRESTARR_DATASET_PATH=/srv/nomad/data"

# 5. Over-matching guard: a real path that merely CONTAINS a placeholder word.
printf 'FIRESTARR_DATASET_PATH=/home/yourname/firestarr_data\n' > "$tmp/.env"
run 'update_env_value FIRESTARR_DATASET_PATH /root/firestarr_data'
expect_line "path containing 'your' is not a placeholder" "FIRESTARR_DATASET_PATH=/home/yourname/firestarr_data"

printf 'NOMAD_AGENCY_ID=changeme-inc\n' > "$tmp/.env"
run 'update_env_value NOMAD_AGENCY_ID other'
expect_line "value merely starting with changeme is not a placeholder" "NOMAD_AGENCY_ID=changeme-inc"

# 6. Empty values are still filled, as before.
printf 'NOMAD_AGENCY_ID=\n' > "$tmp/.env"
run 'update_env_value NOMAD_AGENCY_ID nwt'
expect_line "empty value still filled" "NOMAD_AGENCY_ID=nwt"

echo
echo "the post-install assertion catches anything that slipped through"

expect_status() { # desc, expected-status, command
  local actual
  bash -c "source '$tmp/harness.sh'; $3" >/dev/null 2>&1 && actual=0 || actual=$?
  if [ "$actual" -eq "$2" ]; then echo "  ok   - $1"; pass=$((pass+1))
  else echo "  FAIL - $1 (status $actual, expected $2)"; fail=$((fail+1)); fi
}

# A fully configured .env passes.
printf 'FIRESTARR_DATASET_PATH=/root/firestarr_data
NOMAD_AGENCY_ID=nwt
' > "$tmp/.env"
expect_status "clean .env passes" 0 'assert_no_placeholders_in_env'

# The incident state must fail the install rather than reporting success.
printf 'FIRESTARR_DATASET_PATH=/absolute/path/to/firestarr_data
' > "$tmp/.env"
expect_status "placeholder left behind fails" 1 'assert_no_placeholders_in_env'

# Commented examples are documentation, not configuration.
printf '# FIRESTARR_DATASET_PATH=/absolute/path/to/firestarr_data
NOMAD_AGENCY_ID=nwt
' > "$tmp/.env"
expect_status "commented placeholder ignored" 0 'assert_no_placeholders_in_env'

# OPTIONAL placeholders must not block the install. Found on sulu against the
# real .env.example: it ships 14 OAuth placeholders, and blocking on those would
# fail every install that does not use OAuth — which is most of them.
printf 'FIRESTARR_DATASET_PATH=/root/firestarr_data\nNOMAD_AUTH_MODE=simple\nNOMAD_OAUTH_GOOGLE_CLIENT_ID=your-google-client-id\n' > "$tmp/.env"
expect_status "unused OAuth placeholder does not block a non-oauth install" 0 'assert_no_placeholders_in_env'

# ...but they DO block when the install actually depends on them.
printf 'FIRESTARR_DATASET_PATH=/root/firestarr_data\nNOMAD_AUTH_MODE=oauth\nNOMAD_OAUTH_GOOGLE_CLIENT_ID=your-google-client-id\n' > "$tmp/.env"
expect_status "OAuth placeholder blocks an oauth install" 1 'assert_no_placeholders_in_env'

# The incident key blocks whatever the auth mode.
printf 'FIRESTARR_DATASET_PATH=/absolute/path/to/firestarr_data\nNOMAD_AUTH_MODE=simple\n' > "$tmp/.env"
expect_status "dataset path placeholder blocks whatever the auth mode" 1 'assert_no_placeholders_in_env'

echo
echo "passed: $pass   failed: $fail"
[ "$fail" -eq 0 ] || exit 1
