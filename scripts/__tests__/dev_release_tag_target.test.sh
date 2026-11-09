#!/usr/bin/env bash
#
# A dev pre-release tag must point at the commit its artifact was built from (#512).
#
# THE BUG. dev-release.yml created its release through softprops/action-gh-release with
# tag_name only — no `git tag` step and no target_commitish. When the action creates a tag
# that does not exist, it creates it against the repository's DEFAULT branch, which is main.
#
# Measured on the real remote before the fix: all ELEVEN v0.54.* tags resolved to the single
# commit e180088, which is main's tip and the stable v0.54.0 release. The attached tarballs
# differed in size, so they were genuinely different builds sharing one tag target. The
# release BODY recorded the right commit while the tag pointed somewhere else — v0.54.9's
# body said 660c31d, its tag resolved to e180088. So `git checkout v0.54.10` gave main's
# tree, not the code inside nomad-frontend-v0.54.10.tgz.
#
# Both sibling workflows create their tag explicitly, which is why theirs are correct:
# stable-release.yml and lts-release.yml each have a `git tag` step. dev-release.yml was the
# only release workflow without one.
#
# THE TARGET MUST BE THE BUMP COMMIT, NOT github.sha. The workflow commits a version bump
# and pushes it, so github.sha — the commit that TRIGGERED the run — is the commit BEFORE
# the bump. stable-release.yml captures the bump commit deliberately
# (`echo "sha=$(git rev-parse HEAD)"`, line ~125) for exactly this reason. A fix that passes
# github.sha would move the tag off main and still not put it on the built tree.
#
# HONEST LIMIT. This asserts what the workflow DECLARES. A declared value is not a running
# value, and the only thing that really proves #512 is the next dev release landing a tag on
# the dev commit. That cannot be produced locally, so this test is the floor rather than the
# proof, and the issue says so.
#
# Deps: bash 3.x (macOS default). Exit 0 = pass, 1 = fail.
set -u

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$TEST_DIR/../.." && pwd)"
DEV="$REPO/.github/workflows/dev-release.yml"
STABLE="$REPO/.github/workflows/stable-release.yml"
LTS="$REPO/.github/workflows/lts-release.yml"

pass=0; fail=0
ok()  { echo "  ok   - $1"; pass=$((pass+1)); }
bad() { echo "  FAIL - $1"; fail=$((fail+1)); }

for f in "$DEV" "$STABLE" "$LTS"; do
  [ -f "$f" ] || { bad "missing workflow: $f"; echo ""; echo "passed: $pass   failed: $fail"; exit 1; }
done

# A workflow pins its tag if it creates one itself, or tells the release action where to put it.
pins_tag() { grep -qE '(^|[^a-z])git tag|target_commitish' "$1"; }

# ---------------------------------------------------------------------------
# 1. THE BUG ITSELF.
# ---------------------------------------------------------------------------
if pins_tag "$DEV"; then
  ok "dev-release.yml pins where its tag goes"
else
  bad "dev-release.yml neither creates a git tag nor sets target_commitish — the tag lands on the default branch (#512)"
fi

# ---------------------------------------------------------------------------
# 2. AND IT MUST BE THE BUMP COMMIT. github.sha is the triggering commit, which
#    is the one BEFORE the version bump this workflow commits and pushes.
# ---------------------------------------------------------------------------
target="$(grep -E 'target_commitish' "$DEV" | head -1)"
if [ -z "$target" ]; then
  # An explicit `git tag` after the bump commit is equally correct — it tags HEAD,
  # which IS the bump commit at that point.
  if grep -qE '(^|[^a-z])git tag' "$DEV"; then
    ok "dev-release.yml tags HEAD after committing the bump"
  else
    bad "no target_commitish and no git tag step"
  fi
else
  echo "  (declares: $(echo "$target" | sed 's/^[[:space:]]*//'))"
  case "$target" in
    *github.sha*)
      bad "target_commitish is github.sha — that is the commit BEFORE the version bump, so the tag still misses the built tree"
      ;;
    *)
      ok "target_commitish is not github.sha"
      ;;
  esac
  # It should reference a captured bump-commit output.
  if grep -qE 'rev-parse HEAD' "$DEV"; then
    ok "the workflow captures the bump commit sha to tag against"
  else
    bad "target_commitish is set but the bump commit sha is never captured"
  fi
fi

# ---------------------------------------------------------------------------
# 3. POSITIVE CONTROL ON REAL FILES. The siblings are known-correct, so if the
#    detector cannot see THEIR tag pinning it is measuring nothing.
# ---------------------------------------------------------------------------
if pins_tag "$STABLE"; then
  ok "control: the detector sees stable-release.yml pinning its tag"
else
  bad "CONTROL FAILED — stable-release.yml is known to create its tag and the detector missed it"
fi
if pins_tag "$LTS"; then
  ok "control: the detector sees lts-release.yml pinning its tag"
else
  bad "CONTROL FAILED — lts-release.yml is known to create its tag and the detector missed it"
fi

# ---------------------------------------------------------------------------
# 4. NEGATIVE CONTROL. A synthetic workflow with neither must be caught, or
#    section 1 proves nothing.
# ---------------------------------------------------------------------------
PROBE="$(mktemp)"
cat > "$PROBE" <<'PROBE_EOF'
jobs:
  release:
    steps:
      - name: Create pre-release
        uses: softprops/action-gh-release@v3
        with:
          tag_name: v1.2.3
          prerelease: true
PROBE_EOF
if pins_tag "$PROBE"; then
  bad "CONTROL FAILED — the detector reports tag pinning in a workflow that has none"
else
  ok "control: a workflow with neither a git tag nor target_commitish is caught"
fi
rm -f "$PROBE"

echo ""
echo "passed: $pass   failed: $fail"
[ "$fail" -eq 0 ]
