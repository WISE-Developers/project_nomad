#!/usr/bin/env bash
#
# The rollback tag must be a VALID docker reference (#498).
#
# Its sibling `deploy_rollback_tag.test.sh` asserts the version STRING the tag
# is named after (#437) and that the caller uses it. It is thorough and it was
# green through this entire defect, because it never asked whether the resulting
# reference could be created. That is a check of a proposition one step beside
# the task: the value was right and the tag was never made.
#
# WHAT BROKE. deploy.sh built the tag by appending to the running container's
# `Config.Image`:
#
#   rollback_tag="$(docker inspect "$SERVICE" --format '{{.Config.Image}}'):rollback-$outgoing"
#
# Before #465 the deploy BUILT locally, so Config.Image was the untagged local
# name and appending produced a valid ref:
#
#   nomad-app-nomad                ->  nomad-app-nomad:rollback-0.47.0        VALID
#
# Since #465 the deploy PULLS a tagged ghcr image, so Config.Image already
# carries a tag and appending yields two:
#
#   ghcr.io/.../nomad:0.49.0       ->  ghcr.io/.../nomad:0.49.0:rollback-...  INVALID
#
# `docker tag` rejects it, `2>/dev/null` swallowed the error, and the `&&` meant
# the success line merely never printed. Measured on the CIFFC demo 2026-11-01:
# the newest rollback tags were 0.36.0 and 0.35.0, with nothing for 0.41.0,
# 0.44.0, 0.46.0, 0.47.0 or 0.49.0 — every deploy since #465.
#
# #465 and #437 are each correct alone. The defect is the interaction: #437
# fixed what the tag is NAMED, #465 changed what Config.Image IS.
#
# Deps: bash 3.x (macOS default), sed. Exit 0 = all pass, 1 = any failure.
set -u

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY="$TEST_DIR/../deploy.sh"
[ -f "$DEPLOY" ] || { echo "deploy.sh not found at $DEPLOY"; exit 1; }

pass=0; fail=0
ok()  { echo "  ok   - $1"; pass=$((pass+1)); }
bad() { echo "  FAIL - $1"; fail=$((fail+1)); }

# ---------------------------------------------------------------------------
# A docker reference is <name>[:tag], where <name> may contain registry
# host:port and slash-separated path. So the colon that introduces a TAG is the
# one in the final path segment — a colon before a slash is a registry port.
# Exactly one such colon is valid; two is the bug; zero means no tag at all.
# ---------------------------------------------------------------------------
tag_colons() { # tag_colons <ref> -> count of colons in the last path segment
  local last="${1##*/}"
  printf '%s' "$last" | tr -cd ':' | wc -c | tr -d ' '
}

FN_SRC="$(sed -n '/^rollback_tag_for() {/,/^}/p' "$DEPLOY")"
if [ -z "$FN_SRC" ]; then
  echo "  FAIL - deploy.sh has no rollback_tag_for() to test"
  echo "         The tag is still built inline by appending to Config.Image,"
  echo "         which is the #498 defect and cannot be asserted from outside."
  echo ""
  echo "passed: 0   failed: 1"
  exit 1
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
cat > "$WORK/harness.sh" <<HARNESS
set -u
print_warning() { echo "[WARN] \$*"; }
print_info()    { echo "[INFO] \$*"; }
print_success() { echo "[OK] \$*"; }
$FN_SRC
HARNESS

derive() { # derive <config_image> <suffix>
  bash -c 'source "$1"; rollback_tag_for "$2" "$3"' _ "$WORK/harness.sh" "$1" "$2" 2>/dev/null
}

# ---------------------------------------------------------------------------
# 1. THE DEFECT. A pulled, tagged ghcr ref must yield ONE tag.
# ---------------------------------------------------------------------------
got="$(derive 'ghcr.io/wise-developers/project_nomad/nomad:0.49.0' 'rollback-0.49.0')"
n="$(tag_colons "$got")"
if [ "$n" = "1" ]; then
  ok "tagged registry ref yields a single-tag reference ($got)"
else
  bad "expected one tag, got $n colons in the final segment: '$got'"
fi
case "$got" in
  *:rollback-0.49.0) ok "ends in the rollback suffix" ;;
  *)                 bad "does not end in rollback-0.49.0: '$got'" ;;
esac
case "$got" in
  *0.49.0:rollback-*) bad "the outgoing tag was left in place — this is #498 exactly" ;;
  *)                  ok "the source tag was stripped, not appended to" ;;
esac

# ---------------------------------------------------------------------------
# 2. THE CONTROL. The historically working shape must still work, or this test
#    would pass for a function that simply mangles everything.
# ---------------------------------------------------------------------------
got="$(derive 'nomad-app-nomad' 'rollback-0.47.0')"
if [ "$got" = "nomad-app-nomad:rollback-0.47.0" ]; then
  ok "untagged local name still works (the pre-#465 shape)"
else
  bad "expected nomad-app-nomad:rollback-0.47.0, got '$got'"
fi

# ---------------------------------------------------------------------------
# 3. A REGISTRY PORT IS NOT A TAG. The naive fix, ${ref%:*}, eats it.
# ---------------------------------------------------------------------------
got="$(derive 'localhost:5000/nomad:0.3.0' 'rollback-0.3.0')"
if [ "$got" = "localhost:5000/nomad:rollback-0.3.0" ]; then
  ok "registry port survives (localhost:5000 kept, tag replaced)"
else
  bad "expected localhost:5000/nomad:rollback-0.3.0, got '$got'"
fi

got="$(derive 'localhost:5000/nomad' 'rollback-0.3.0')"
if [ "$got" = "localhost:5000/nomad:rollback-0.3.0" ]; then
  ok "registry port with NO tag is not mistaken for a tag"
else
  bad "expected localhost:5000/nomad:rollback-0.3.0, got '$got'"
fi

# ---------------------------------------------------------------------------
# 4. A DIGEST PIN is also not a tag.
# ---------------------------------------------------------------------------
got="$(derive 'ghcr.io/w/nomad@sha256:1111111111111111111111111111111111111111111111111111111111111111' 'rollback-0.9.0')"
case "$got" in
  *@sha256:*) bad "digest left in the ref: '$got'" ;;
  'ghcr.io/w/nomad:rollback-0.9.0') ok "digest pin stripped before tagging" ;;
  *) bad "expected ghcr.io/w/nomad:rollback-0.9.0, got '$got'" ;;
esac

# ---------------------------------------------------------------------------
# 5. THE SILENCE. docker tag's failure must not be discarded. A rollback tag
#    that cannot be created is the one thing the operator must be told, and
#    deploy.sh's own comment says dropping it in silence costs the rollback.
# ---------------------------------------------------------------------------
if grep -nE 'docker tag[^|]*2>[[:space:]]*/dev/null' "$DEPLOY" >/dev/null; then
  bad "docker tag still redirects stderr to /dev/null — the failure is invisible"
else
  ok "docker tag no longer discards its error output"
fi

# And the caller must actually use the function.
if grep -q 'rollback_tag_for' "$DEPLOY"; then
  ok "the tagging path calls rollback_tag_for"
else
  bad "rollback_tag_for is never called — the fix is unwired"
fi

# The old inline construction must be gone from the tagging path.
if grep -nE "Config\.Image\}\}'\):rollback-" "$DEPLOY" >/dev/null; then
  bad "still appends :rollback- directly to Config.Image"
else
  ok "no longer appends :rollback- to Config.Image"
fi

echo ""
echo "passed: $pass   failed: $fail"
[ "$fail" -eq 0 ]
