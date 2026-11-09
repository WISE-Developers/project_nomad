#!/usr/bin/env bash
#
# Docker mode must not require a shell inside the FireSTARR image (#515).
#
# THE BUG. Our own docker-compose.yaml wrapped the FireSTARR service entrypoint in
# /bin/sh to run one `sed` over settings.ini before exec'ing the model:
#
#   entrypoint: ["/bin/sh", "-c", "sed -i 's|RASTER_ROOT.*|...|' ... && exec \"$$@\"", "--"]
#
# FIRESTARR_IMAGE is operator-supplied with no default, and FireSTARR images come from a
# separate project. An image built on a minimal base has no /bin/sh, so a model run dies
# with `exec: "/bin/sh": stat /bin/sh: no such file or directory` — which reads as a broken
# container rather than a Nomad requirement, so the time goes into the wrong place.
#
# THE FIX IS BAKE-AT-BUILD (Franco's decision, 2026-11-09): the raster root is written into
# settings.ini when the image is built, so nothing has to rewrite it per run and the shell
# leaves the path entirely.
#
# WHY A SHELL TEST: compose files and workflow YAML are not reachable from vitest, and a
# job-level decision that is only checked by reading it is not checked. The house pattern
# for this is scripts/__tests__/*.test.sh, which CI runs as a loop (tests.yml).
#
# KNOWN LIMIT, recorded rather than papered over: baking fixes images built by
# build-firestarr.yml. An operator pointing FIRESTARR_IMAGE at an upstream CWFMF image gets
# that image's own settings.ini, which carries a RELATIVE raster root. Mounting a prepared
# settings.ini read-only would cover third-party images too and still needs no shell; that
# is a follow-up decision, not something this test asserts.
#
# Deps: bash 3.x (macOS default). Exit 0 = pass, 1 = fail.
set -u

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$TEST_DIR/../.." && pwd)"
COMPOSE="$REPO/docker-compose.yaml"
WF="$REPO/.github/workflows/build-firestarr.yml"

pass=0; fail=0
ok()  { echo "  ok   - $1"; pass=$((pass+1)); }
bad() { echo "  FAIL - $1"; fail=$((fail+1)); }

[ -f "$COMPOSE" ] || { bad "docker-compose.yaml not found at $COMPOSE"; echo ""; echo "passed: $pass   failed: $fail"; exit 1; }
[ -f "$WF" ]      || { bad "build-firestarr.yml not found at $WF"; echo ""; echo "passed: $pass   failed: $fail"; exit 1; }

# A shell in an entrypoint/command, in any of the spellings compose accepts.
shell_in_exec() {
  grep -nE '^[[:space:]]*(entrypoint|command):.*(/bin/sh|/bin/bash|[^a-zA-Z]sh[^a-zA-Z-]|-c[[:space:]])' "$1"
}

# ---------------------------------------------------------------------------
# 1. THE BUG ITSELF. No service in our compose may run through a shell.
# ---------------------------------------------------------------------------
hits="$(shell_in_exec "$COMPOSE" || true)"
if [ -n "$hits" ]; then
  bad "docker-compose.yaml still runs a service through a shell (#515):"
  echo "$hits" | sed 's/^/      /'
else
  ok "no service in docker-compose.yaml runs through a shell"
fi

# ---------------------------------------------------------------------------
# 2. THE SETTING MUST STILL BE CORRECT. Removing the per-run sed only works if
#    the raster root is baked when the image is built — otherwise the shell is
#    gone and so is the setting, which is a worse bug than the one being fixed.
# ---------------------------------------------------------------------------
if grep -qE 'RASTER_ROOT' "$WF"; then
  ok "build-firestarr.yml writes RASTER_ROOT into the image at build time"
else
  bad "build-firestarr.yml does not bake RASTER_ROOT — the per-run sed cannot just be deleted"
fi

# Baked to the ABSOLUTE container path, not the relative one the upstream tarball ships.
# A bake that writes the relative value is indistinguishable from no bake at all.
if grep -qE 'RASTER_ROOT[^\n]*/appl/data' "$WF"; then
  ok "the baked RASTER_ROOT is the absolute container path under /appl/data"
else
  bad "RASTER_ROOT is mentioned in the workflow but not set to an /appl/data path"
fi

# ---------------------------------------------------------------------------
# 3. CONTROL. A detector that cannot fire proves nothing. Run section 1's
#    detector against a file that DOES wrap an entrypoint in a shell — the
#    exact line this issue removed — and require it to be caught.
# ---------------------------------------------------------------------------
PROBE="$(mktemp)"
cat > "$PROBE" <<'PROBE_EOF'
services:
  firestarr-app:
    image: ${FIRESTARR_IMAGE}
    entrypoint: ["/bin/sh", "-c", "sed -i 's|RASTER_ROOT.*|RASTER_ROOT = /appl/data/x|' /appl/firestarr/settings.ini && exec \"$$@\"", "--"]
PROBE_EOF
if shell_in_exec "$PROBE" >/dev/null; then
  ok "control: the detector catches the shell-wrapped entrypoint this issue removed"
else
  bad "CONTROL FAILED — the detector does not catch the original line, so section 1 proves nothing"
fi

# And a negative control: a plain argv entrypoint must NOT be flagged.
PROBE2="$(mktemp)"
cat > "$PROBE2" <<'PROBE2_EOF'
services:
  firestarr-app:
    image: ${FIRESTARR_IMAGE}
    volumes:
      - /etc/ssl/certs:/etc/ssl/certs
PROBE2_EOF
if shell_in_exec "$PROBE2" >/dev/null; then
  bad "CONTROL FAILED — the detector flags a service with no entrypoint at all"
else
  ok "control: a service with no shell entrypoint is not flagged"
fi
rm -f "$PROBE" "$PROBE2"

echo ""
echo "passed: $pass   failed: $fail"
[ "$fail" -eq 0 ]
