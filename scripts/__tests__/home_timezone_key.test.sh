#!/usr/bin/env bash
#
# NOMAD_HOME_TIMEZONE must reach every completed install.
#
# The backend now REFUSES TO START without it (#332): it is the IANA zone used
# to stamp ts_local in the usage log, and it is deliberately fail-fast because
# the container defaults to TZ=UTC — a fallback would produce a log whose local
# times are all silently wrong.
#
# That makes this a hard install requirement, not a nicety. An installer that
# omits the key produces a box that cannot boot.
#
# Two install shapes exist and both must be covered:
#   - installers that COPY .env.example (covered by the key being in the example)
#   - installers that BUILD .env key-by-key (the example never reaches them)
#
# The second shape is exactly what broke in #322: .env.example gained a default
# that key-by-key installers never saw, and a completed install could not fetch
# a dataset. Same trap, so every installer is checked here — not only the ones
# touched by this change.
#
# Deps: bash 3.x, grep. Exit 0 = all pass.
set -u

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPTS="$TEST_DIR/.."
ENV_EXAMPLE="$SCRIPTS/../.env.example"

pass=0; fail=0
ok()   { echo "  ok   - $1"; pass=$((pass+1)); }
bad()  { echo "  FAIL - $1"; [ -n "${2:-}" ] && echo "         $2"; fail=$((fail+1)); }

echo "home_timezone_key"

# ---- .env.example ships the key, uncommented, with a real zone -----------
if grep -qE '^NOMAD_HOME_TIMEZONE=[A-Za-z]+/[A-Za-z_]+' "$ENV_EXAMPLE"; then
  ok ".env.example sets NOMAD_HOME_TIMEZONE to an IANA zone"
else
  bad ".env.example sets NOMAD_HOME_TIMEZONE to an IANA zone" \
      "got: $(grep -n 'NOMAD_HOME_TIMEZONE' "$ENV_EXAMPLE" | head -1 || echo '<key absent>')"
fi

# A commented-out key is the same as no key: the backend will not start.
if grep -qE '^[[:space:]]*#[[:space:]]*NOMAD_HOME_TIMEZONE=' "$ENV_EXAMPLE"; then
  bad ".env.example does not ship the key commented out" \
      "a commented key leaves the backend unbootable"
else
  ok ".env.example does not ship the key commented out"
fi

# A bare offset cannot observe DST and the backend rejects it outright.
if grep -qE '^NOMAD_HOME_TIMEZONE=[+-]' "$ENV_EXAMPLE"; then
  bad ".env.example uses a zone name, not a fixed UTC offset" \
      "a fixed offset cannot observe DST and fails validation"
else
  ok ".env.example uses a zone name, not a fixed UTC offset"
fi

# ---- installers that BUILD .env key-by-key must emit the key -------------
# These never see .env.example's default, so the example alone does not help.
for installer in \
  install-nomad-demo.sh \
  install-nomad-san-docker.sh \
  install-nomad-san-metal.sh \
  install-nomad-headless.sh \
  install_nomad_setup.sh
do
  f="$SCRIPTS/$installer"
  if [ ! -f "$f" ]; then
    bad "$installer exists" "not found at $f"
    continue
  fi
  for key in NOMAD_HOME_TIMEZONE NOMAD_USAGE_LOG_PATH NOMAD_USAGE_LOG_MAX_BYTES; do
    if grep -q "$key" "$f"; then
      ok "$installer writes $key"
    else
      bad "$installer writes $key" \
          "installs from this script produce a backend that cannot start"
    fi
  done
done

# ---- the usage log must land on a MOUNTED path --------------------------
# /data is NOT a mount in the container: it lives on the overlay filesystem and
# is destroyed whenever the container is recreated. Writes still succeed, so the
# log silently evaporates on every upgrade.
if grep -qE '^NOMAD_USAGE_LOG_PATH=/appl/data/' "$ENV_EXAMPLE"; then
  ok ".env.example puts the usage log on the mounted dataset path"
else
  bad ".env.example puts the usage log on the mounted dataset path" \
      "got: $(grep -n '^NOMAD_USAGE_LOG_PATH=' "$ENV_EXAMPLE" | head -1 || echo '<key absent>')"
fi

# ---- PowerShell installers must not be forgotten ------------------------
# Aug 7 lesson: two regressions shipped because only the installers being
# worked in were tested. The Windows paths are installers too.
for installer in \
  install-nomad-san-docker.ps1 \
  install-nomad-san-metal.ps1
do
  f="$SCRIPTS/$installer"
  if [ ! -f "$f" ]; then
    bad "$installer exists" "not found at $f"
    continue
  fi
  for key in NOMAD_HOME_TIMEZONE NOMAD_USAGE_LOG_PATH NOMAD_USAGE_LOG_MAX_BYTES; do
    if grep -q "$key" "$f"; then
      ok "$installer writes $key"
    else
      bad "$installer writes $key" \
          "installs from this script produce a backend that cannot start"
    fi
  done
done

# ---- upgrade path is documented -----------------------------------------
# Existing deployments have no such key and will refuse to start after upgrade.
# That is intended, but it must be written down somewhere an operator reads.
UPGRADE_DOC="$SCRIPTS/../Documentation/Nomad/upgrading.md"
if [ -f "$UPGRADE_DOC" ] && grep -q 'NOMAD_HOME_TIMEZONE' "$UPGRADE_DOC"; then
  ok "upgrade notes document the new required key"
else
  bad "upgrade notes document the new required key" \
      "existing deployments will refuse to start with no documented cause"
fi

echo "  $pass passed, $fail failed"
[ "$fail" -eq 0 ] || exit 1
