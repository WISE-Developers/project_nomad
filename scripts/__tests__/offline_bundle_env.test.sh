#!/usr/bin/env bash
#
# Offline bundle: the .env we ship inside it (refs #318).
#
# Two things have to be true of the .env that goes in the bundle, and both of
# them fail in ways nobody sees until the practitioner is already offline.
#
# 1. FIRESTARR_EXECUTION_MODE must be `binary`.
#
#    `getExecutor.ts` defaults to 'docker' when the variable is absent or
#    anything other than 'binary'. Docker is the default for good reasons on a
#    server; on a locked-down field laptop it is the one thing guaranteed not
#    to be there. A bundle that ships without this pre-set reaches for a daemon
#    that does not exist on its very first run, at an incident, with no network
#    to look up what went wrong.
#
# 2. Every path in it must be relative to the bundle root.
#
#    Acceptance criterion #4 is "build -> copy to USB -> install on N laptops".
#    One build, many machines. The bundle lands on a different drive letter or
#    mount point on every one of them, and an absolute path baked in by the
#    build host works perfectly on the build host and nowhere else. That is the
#    worst possible failure shape: it passes every check we run here and fails
#    only in the field.
#
# The suite extracts `write_env` and runs it in a temp directory rather than
# executing the builder, which would download a Node runtime and a FireSTARR
# release. Same approach as dataset_space_check.test.sh, for the same reason.
#
# Deps: bash 3.x compatible (macOS ships 3.2). Exit 0 = all pass.

set -u

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILDER="$TEST_DIR/../build-offline-bundle.sh"

pass=0
fail=0

ok()  { pass=$((pass + 1)); echo "    ok   $1"; }
bad() { fail=$((fail + 1)); echo "  FAIL   $1"; [ $# -gt 1 ] && echo "         $2"; }

[ -f "$BUILDER" ] || { echo "builder not found at $BUILDER"; exit 1; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# ---------------------------------------------------------------------------
# Extract the function under test.
# ---------------------------------------------------------------------------
sed -n '/^write_env() {/,/^}/p' "$BUILDER" > "$tmp/fn.sh"

if [ ! -s "$tmp/fn.sh" ]; then
  bad "builder defines write_env()" \
      "no write_env() in build-offline-bundle.sh -- the bundle has no .env, so the target falls back to Docker"
  echo
  echo "offline_bundle_env: $pass passed, $fail failed"
  exit 1
fi
ok "builder defines write_env()"

cat > "$tmp/harness.sh" <<HARNESS
info() { :; }
die()  { echo "die: \$*" >&2; return 1; }
source "$tmp/fn.sh"
HARNESS

ENV_FILE="$tmp/.env"
if ! bash -c "source '$tmp/harness.sh'; write_env '$ENV_FILE'" 2>"$tmp/err"; then
  bad "write_env produces a file" "$(head -2 "$tmp/err")"
  echo
  echo "offline_bundle_env: $pass passed, $fail failed"
  exit 1
fi

[ -s "$ENV_FILE" ] && ok "write_env produces a non-empty .env" \
                   || bad "write_env produces a non-empty .env"

# ---------------------------------------------------------------------------
# The Docker trap.
# ---------------------------------------------------------------------------
mode="$(grep -E '^FIRESTARR_EXECUTION_MODE=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")"
if [ "$mode" = "binary" ]; then
  ok "FIRESTARR_EXECUTION_MODE=binary"
else
  bad "FIRESTARR_EXECUTION_MODE=binary" \
      "got '${mode:-<unset>}' -- getExecutor.ts defaults to docker, which is absent on the target"
fi

# ---------------------------------------------------------------------------
# Binary mode is driven by exactly two variables; both must be present or the
# executor has nothing to run and no projection data to run it with.
# ---------------------------------------------------------------------------
for var in FIRESTARR_BINARY_PATH PROJ_DATA FIRESTARR_DATASET_PATH; do
  if grep -qE "^${var}=" "$ENV_FILE"; then
    ok "$var is set"
  else
    bad "$var is set" "NativeBinaryExecutor reads it; absent means it cannot run"
  fi
done

# ---------------------------------------------------------------------------
# No absolute paths. This is the one that only fails in the field.
#
# Checked against the VALUES, not the whole file, so a comment mentioning a
# path does not trip it.
# ---------------------------------------------------------------------------
absolute=""
while IFS= read -r line; do
  case "$line" in
    \#*|"") continue ;;
  esac
  value="${line#*=}"
  value="$(echo "$value" | tr -d '"' | tr -d "'")"
  case "$value" in
    /*|[A-Za-z]:\\*|[A-Za-z]:/*) absolute="$absolute $line" ;;
    *\$HOME*|*"$HOME"*)          absolute="$absolute $line" ;;
  esac
done < "$ENV_FILE"

if [ -z "$absolute" ]; then
  ok "no absolute paths in any value"
else
  bad "no absolute paths in any value" \
      "these work on the build host and nowhere else:$absolute"
fi

# ---------------------------------------------------------------------------
# The build host must not leak in. A path containing this repository's
# location means the builder wrote where IT lives, not where the bundle lands.
# ---------------------------------------------------------------------------
repo_root="$(cd "$TEST_DIR/../.." && pwd)"
if grep -qF "$repo_root" "$ENV_FILE"; then
  bad "no build-host paths leaked into the .env" "found $repo_root"
else
  ok "no build-host paths leaked into the .env"
fi

# ---------------------------------------------------------------------------
# An air-gapped machine cannot reach an OAuth provider, and telemetry cannot
# reach Sentry. Neither should be configured to try.
# ---------------------------------------------------------------------------
auth="$(grep -E '^NOMAD_AUTH_MODE=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"')"
if [ "$auth" != "oauth" ]; then
  ok "NOMAD_AUTH_MODE is not oauth (got '${auth:-<unset>}')"
else
  bad "NOMAD_AUTH_MODE is not oauth" \
      "an air-gapped laptop cannot redirect to a provider; sign-in would dead-end"
fi

dsn="$(grep -iE '^[A-Z_]*SENTRY[A-Z_]*DSN=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"')"
if [ -z "$dsn" ]; then
  ok "no Sentry DSN configured"
else
  bad "no Sentry DSN configured" "offline telemetry cannot send, and should not try: $dsn"
fi

echo
echo "offline_bundle_env: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
