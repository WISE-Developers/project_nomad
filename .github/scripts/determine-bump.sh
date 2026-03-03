#!/bin/bash
# determine-bump.sh <pr_number>
# Scans commits in a PR for issue references, checks GitHub issue labels,
# and returns the appropriate semver bump level.
#
# Returns: patch | minor | major
#
# Logic:
#   1. PR has label "release:major" → major
#   2. Any referenced issue has label "feature" or "enhancement" → minor
#   3. Otherwise → patch (default, safe)
#
# Required env vars: GH_TOKEN, PR_LABELS (JSON array), REPO
set -euo pipefail

PR_NUMBER="${1:-}"
if [[ -z "$PR_NUMBER" ]]; then
    echo "patch"
    exit 0
fi

if [[ -z "${GH_TOKEN:-}" ]]; then
    echo "ERROR: GH_TOKEN environment variable required" >&2
    exit 1
fi

if [[ -z "${REPO:-}" ]]; then
    echo "ERROR: REPO environment variable required (e.g. WISE-Developers/project_nomad)" >&2
    exit 1
fi

# Step 1: Check for manual major override via PR label
if echo "${PR_LABELS:-[]}" | grep -q '"release:major"'; then
    echo "major"
    exit 0
fi

# Step 2: Get commits from this PR via GitHub API
COMMITS_JSON=$(curl -sf \
    -H "Authorization: Bearer $GH_TOKEN" \
    -H "Accept: application/vnd.github.v3+json" \
    "https://api.github.com/repos/${REPO}/pulls/${PR_NUMBER}/commits?per_page=100" \
    || echo "[]")

# Step 3: Extract all #NNN issue references from commit messages
ISSUE_NUMBERS=$(echo "$COMMITS_JSON" | \
    node -e "
        const data = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf8'));
        const msgs = data.map(c => c.commit.message).join(' ');
        const matches = msgs.match(/#(\d+)/g) || [];
        const unique = [...new Set(matches.map(m => m.slice(1)))];
        unique.forEach(n => console.log(n));
    ")

if [[ -z "$ISSUE_NUMBERS" ]]; then
    echo "patch"
    exit 0
fi

# Step 4: Check labels on each referenced issue
BUMP_LEVEL="patch"

for ISSUE_NUM in $ISSUE_NUMBERS; do
    LABELS_JSON=$(curl -sf \
        -H "Authorization: Bearer $GH_TOKEN" \
        -H "Accept: application/vnd.github.v3+json" \
        "https://api.github.com/repos/${REPO}/issues/${ISSUE_NUM}" \
        || echo '{"labels":[]}')

    HAS_FEATURE=$(echo "$LABELS_JSON" | \
        node -e "
            const data = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf8'));
            const labels = (data.labels || []).map(l => l.name);
            const isFeature = labels.some(l => l === 'feature' || l === 'enhancement');
            console.log(isFeature ? 'yes' : 'no');
        ")

    if [[ "$HAS_FEATURE" == "yes" ]]; then
        BUMP_LEVEL="minor"
        break
    fi
done

echo "$BUMP_LEVEL"
