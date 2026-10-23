#!/usr/bin/env bash
#
# The deploy must PULL the published image, and must never silently build one
# instead (#465, step 3).
#
# WHAT IT DOES TODAY. deploy.sh runs `docker compose build "$SERVICE"` on the
# target, so the artefact that serves production is built on the box that
# serves production. CI tests the source; each host builds its own image from
# it; nothing verifies the two agree. #465 has the measurements.
#
# THE CONTRACT THIS PINS, and the second half matters more than the first:
#
#   1. the default path PULLS a version-pinned published image;
#   2. a FAILED pull STOPS the deploy. It does not quietly build instead.
#
# Point 2 is written as a test because the failure it prevents is invisible:
# a build-on-pull-failure would leave every deploy working, with the published
# image silently unused and the "deployed artefact is the tested artefact"
# property quietly gone — nothing goes red, and the host keeps serving. That is
# the same shape as #444 (a release that silently did not fire) and as #465's
# own origin (`sbom: true` on a workflow nothing triggers). This house's most
# repeated defect is a status that diverges from the state while still reading
# as authoritative.
#
# An offline or air-gapped install genuinely needs a local build, and that case
# is real — the offline_bundle_* suites next door exist for it. So it stays
# available as an EXPLICIT mode the operator asks for, never as a fallback the
# script chooses after something failed.
#
# Deps: bash 3.x (macOS default). Exit 0 = pass, 1 = fail.
set -u

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY="$TEST_DIR/../deploy.sh"
[ -f "$DEPLOY" ] || { echo "deploy.sh not found at $DEPLOY"; exit 1; }

pass=0; fail=0
ok()  { echo "  ok   - $1"; pass=$((pass+1)); }
bad() { echo "  FAIL - $1"; fail=$((fail+1)); }

echo
echo "#465 step 3 — deploy pulls the published image"

if grep -qE "docker (compose )?pull" "$DEPLOY"; then
    ok "the deploy pulls an image"
else
    bad "the deploy never pulls — it still builds the image on the target"
fi

if grep -qE "ghcr\.io/wise-developers/project_nomad/nomad" "$DEPLOY"; then
    ok "it names the published application image"
else
    bad "the published application image is never named in deploy.sh"
fi

# The explicit mode must be something the operator ASKS for — a flag or a named
# variable — rather than a branch the script takes on its own after a failure.
if grep -qE "build-local|BUILD_LOCAL|--local-build" "$DEPLOY"; then
    ok "a local build is available as an explicit mode"
else
    bad "no explicit local-build mode for offline installs"
fi

# THE ONE THAT MATTERS. A build reached from a failed pull is the silent
# degradation this issue exists to remove.
if awk '
    /docker (compose )?pull/ { near = 6 }
    near > 0 {
        near--
        if ($0 ~ /\|\|/ && $0 ~ /build/) { found = 1 }
        if ($0 ~ /^[[:space:]]*(else|fi)/ && pending) { pending = 0 }
    }
    END { exit (found ? 1 : 0) }
' "$DEPLOY"; then
    ok "a failed pull does not fall through to a build"
else
    bad "a failed pull builds instead — silent degradation, the thing #465 removes"
fi

echo
echo "deploy_pull_published_image: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
