#!/usr/bin/env bash
#
# The application image must be BUILT AND PUBLISHED BY CI (#465).
#
# THE FACT THIS TEST PINS. deploy.sh runs `docker compose build` on the target,
# so CI has never produced an application image. Everything #465 lists follows
# from that: the SBOM has to run on the production box (#441, #464), each
# deployed version leaves a ~28MB document there (~2.3GB per two months at 84
# releases in 60 days, on a volume with 15GB free), nobody can audit a version
# they did not deploy, and the artefact that ships is not the artefact CI tested.
#
# WHY A TEST AND NOT A REVIEW. #465 exists because `sbom: true` was set on
# build-firestarr.yml and HAS NEVER EXECUTED — that workflow is
# workflow_dispatch only, so nothing triggers it. A setting that is correct in
# YAML and never runs looks exactly like a setting that works. So this suite
# asserts the publish is reachable by an automatic trigger, not merely that the
# right keys appear somewhere in a file.
#
# Deps: bash 3.x (macOS default). Exit 0 = pass, 1 = fail.
set -u

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$TEST_DIR/../.." && pwd)"
WF_DIR="$REPO/.github/workflows"

pass=0; fail=0
ok()  { echo "  ok   - $1"; pass=$((pass+1)); }
bad() { echo "  FAIL - $1"; fail=$((fail+1)); }

echo
echo "#465 — the application image is built and published by CI"

# The app image is the one built from backend/Dockerfile, which docker-compose
# names for the `nomad` service. firestarr is a DIFFERENT image and is already
# published; matching it here would make this suite pass on the wrong artefact.
app_wf=""
for f in "$WF_DIR"/*.yml; do
    grep -q "backend/Dockerfile" "$f" 2>/dev/null || continue
    grep -qE "push:[[:space:]]*true|docker/build-push-action" "$f" 2>/dev/null || continue
    app_wf="$f"
    break
done

if [ -n "$app_wf" ]; then
    ok "a workflow builds and pushes the application image ($(basename "$app_wf"))"
else
    bad "no workflow builds and pushes the application image (backend/Dockerfile)"
fi

if [ -n "$app_wf" ]; then
    # THE ASSERTION #465 EXISTS FOR. build-firestarr.yml carries `sbom: true`
    # and has never run, because `workflow_dispatch` is its only trigger. A
    # publish nothing can trigger is indistinguishable from a working one by
    # reading the file, so check that the file declares an automatic trigger.
    if awk '/^on:/{f=1;next} /^[a-z]/{f=0} f' "$app_wf" | grep -qE "^[[:space:]]+(push|release|schedule):"; then
        ok "the publishing workflow has an automatic trigger, not workflow_dispatch alone"
    else
        bad "the publishing workflow can only be triggered by hand — it will never run"
    fi

    # Per-manifest, so publishing more than one architecture without this
    # describes half the images and looks complete in the index (#460).
    if grep -q "sbom: true" "$app_wf"; then
        ok "the pushed image carries an SBOM attestation"
    else
        bad "no sbom: true — the registry carries no bill of materials"
    fi

    # A floating tag alone cannot answer "which image is v0.38.0".
    if grep -qE "ghcr\.io/wise-developers/project_nomad/nomad:\\\$\{\{" "$app_wf"; then
        ok "the image is tagged by version, not only by a floating tag"
    else
        bad "the image carries no version tag"
    fi

    # The release job commits the version bump, so the SHA that triggered the
    # run predates the release. Publishing that SHA would ship the previous
    # tree under the new version's tag.
    if grep -qE "ref: \\\$\{\{ needs\.stable-release\.outputs\.tag \}\}" "$app_wf"; then
        ok "it checks out the released tag, not the triggering SHA"
    else
        bad "it does not check out the released tag — the image would predate the release"
    fi
fi

echo
echo "publish_app_image: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
