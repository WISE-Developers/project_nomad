#!/usr/bin/env bash
#
# A release must not exist before its image does (#503).
#
# WHAT HAPPENED. v0.51.0 was tagged and published as a GitHub Release with NO
# IMAGE. `stable-release` created the tag and the release, `publish-image` then
# failed on `npm ci`, and the run left behind a version that can never be
# deployed. Production stayed on v0.50.0 while `main` claimed v0.51.0.
#
# IT WAS NOT BAD LUCK, IT WAS THE JOB GRAPH. publish-image declared
# `needs: [gate, stable-release]`, so the tag and release were created first by
# construction. Every failed image build produces the same orphan.
#
# WHY "CHECK FOR THE TAG" DOES NOT CATCH IT. The deployment runbook tells an
# operator to confirm the tag rather than trusting a green tick. Here the tag
# WAS the misleading thing: it existed, and the artefact did not. What exposed
# it was reading the JOBS inside the run. A guard at the tag level cannot
# distinguish these two states, so the guard has to be on the ordering.
#
# THE CONSTRAINT THAT MAKES THIS NON-OBVIOUS. publish-image used to check out
# `needs.stable-release.outputs.tag`, so it REQUIRED the tag to pre-exist.
# Simply moving the tag later breaks that checkout silently-looking-green at
# authoring time. It now checks out the bump COMMIT SHA, which is the same tree
# the tag would point at, and that is what lets the tag move after the image.
#
# Deps: bash 3.x, python3 with pyyaml. Exit 0 = all pass.
set -u

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$TEST_DIR/../.." && pwd)"
WF="${NOMAD_RELEASE_WORKFLOW:-$REPO_ROOT/.github/workflows/stable-release.yml}"

pass=0; fail=0
ok()  { echo "  ok   - $1"; pass=$((pass+1)); }
bad() { echo "  FAIL - $1"; fail=$((fail+1)); }

if [ ! -f "$WF" ]; then
  bad "stable-release.yml not found at $WF"
  echo ""; echo "passed: $pass   failed: $fail"; exit 1
fi

REPORT="$(python3 - "$WF" <<'PY'
import sys, json
try:
    import yaml
except ImportError:
    print(json.dumps({"skip": "pyyaml unavailable"})); sys.exit(0)

wf = yaml.safe_load(open(sys.argv[1]))
jobs = wf.get("jobs", {}) or {}

def needs_of(name):
    n = (jobs.get(name) or {}).get("needs") or []
    return [n] if isinstance(n, str) else list(n)

def steps_text(name):
    return json.dumps((jobs.get(name) or {}).get("steps") or [])

# Which job publishes the GitHub Release, and which creates the git tag?
release_job = tag_job = image_job = None
for name in jobs:
    t = steps_text(name)
    if "action-gh-release" in t:
        release_job = name
    if "git tag " in t or "git tag\\" in t:
        tag_job = name
    if "build-push-action" in t and "push: true" in t.replace('"push": true', 'push: true'):
        image_job = name
    elif "build-push-action" in t and '"push": true' in t:
        image_job = name

# transitive needs
def depends_on(a, b, seen=None):
    seen = seen or set()
    if a in seen: return False
    seen.add(a)
    for n in needs_of(a):
        if n == b or depends_on(n, b, seen): return True
    return False

image_checkout_uses_tag = False
if image_job:
    image_checkout_uses_tag = "outputs.tag" in steps_text(image_job)

print(json.dumps({
    "jobs": sorted(jobs),
    "release_job": release_job,
    "tag_job": tag_job,
    "image_job": image_job,
    "release_depends_on_image": bool(release_job and image_job and depends_on(release_job, image_job)),
    "tag_depends_on_image": bool(tag_job and image_job and depends_on(tag_job, image_job)),
    "image_checkout_uses_tag": image_checkout_uses_tag,
}))
PY
)"

if printf '%s' "$REPORT" | grep -q '"skip"'; then
  bad "pyyaml unavailable, so this guard cannot run — treat as unverified, not as passing"
  echo ""; echo "passed: $pass   failed: $fail"; exit 1
fi

get() { printf '%s' "$REPORT" | python3 -c "import json,sys;print(json.load(sys.stdin).get('$1'))"; }

IMAGE_JOB="$(get image_job)"
RELEASE_JOB="$(get release_job)"
TAG_JOB="$(get tag_job)"

# The guard must be looking at something: if it cannot find the jobs at all,
# every ordering assertion below would pass for the wrong reason.
if [ "$IMAGE_JOB" = "None" ] || [ "$RELEASE_JOB" = "None" ]; then
  bad "could not locate the image job and/or the release job (image=$IMAGE_JOB release=$RELEASE_JOB) — the scan is vacuous, not clean"
  echo ""; echo "passed: $pass   failed: $fail"; exit 1
fi
ok "located the jobs: image='$IMAGE_JOB' release='$RELEASE_JOB' tag='$TAG_JOB'"

[ "$(get release_depends_on_image)" = "True" ] \
  && ok "the GitHub Release job depends on the image job" \
  || bad "the GitHub Release is published WITHOUT depending on '$IMAGE_JOB' — a failed image build leaves a release with no artefact (this is v0.51.0)"

[ "$(get tag_depends_on_image)" = "True" ] \
  && ok "the git tag is created only after the image job" \
  || bad "the git tag is created WITHOUT depending on '$IMAGE_JOB' — the runbook tells operators to check for the tag, so a tag with no image actively misleads"

[ "$(get image_checkout_uses_tag)" = "False" ] \
  && ok "the image job does not require the tag to pre-exist (it checks out the bump commit)" \
  || bad "the image job checks out 'outputs.tag', which forces the tag to be created BEFORE the image — the ordering above cannot hold while this is true"

echo ""
echo "passed: $pass   failed: $fail"
[ "$fail" -eq 0 ] || exit 1
