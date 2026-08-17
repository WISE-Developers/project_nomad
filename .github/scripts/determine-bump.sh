#!/bin/bash
# determine-bump.sh <pr_number>
# Returns the semver bump level for a merge into main.
#
# Returns: minor | major
#
# Versioning scheme (#348):
#   - Changes on dev bump PATCH   (handled by dev-release.yml, not here)
#   - A PR merged into main bumps MINOR — that is what a release is
#   - Unless the PR carries the label "release:major", which bumps MAJOR
#
# The patch digit therefore counts changes accumulated during development
# (0.5.13 = thirteen changes on the 0.5.x line) and the minor digit identifies
# the release.
#
# Previously this read the labels of every issue referenced in the PR's commit
# messages and returned minor for "feature"/"enhancement", patch otherwise. That
# made the released version depend on issue labelling rather than on the release
# itself, and produced v0.13.1 where v0.14.0 was meant.
#
# Required env vars: GH_TOKEN, REPO
set -euo pipefail

PR_NUMBER="${1:-}"

if [[ -z "${GH_TOKEN:-}" ]]; then
    echo "ERROR: GH_TOKEN environment variable required" >&2
    exit 1
fi

if [[ -z "${REPO:-}" ]]; then
    echo "ERROR: REPO environment variable required (e.g. WISE-Developers/project_nomad)" >&2
    exit 1
fi

# No PR found (e.g. a direct push to main). A release is still a release, so
# minor remains the correct level.
if [[ -z "$PR_NUMBER" ]]; then
    echo "minor"
    exit 0
fi

# Read the PR's own labels. This used to consult $PR_LABELS, which
# stable-release.yml never set — so the major override could never fire.
LABELS_JSON=$(curl -sf \
    -H "Authorization: Bearer $GH_TOKEN" \
    -H "Accept: application/vnd.github.v3+json" \
    "https://api.github.com/repos/${REPO}/pulls/${PR_NUMBER}" \
    || echo '{"labels":[]}')

HAS_MAJOR=$(echo "$LABELS_JSON" | \
    node -e "
        const data = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf8'));
        const labels = (data.labels || []).map(l => l.name);
        console.log(labels.includes('release:major') ? 'yes' : 'no');
    ")

if [[ "$HAS_MAJOR" == "yes" ]]; then
    echo "major"
else
    echo "minor"
fi
