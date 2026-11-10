#!/usr/bin/env bash
#
# Every FireSTARR reference must name the CURRENT CWFMF repository (#529).
#
# WHAT CHANGED. CWFMF renamed `firestarr-cpp` to `firestarr`. The GitHub repository
# redirect means the old name keeps working for git and for release downloads, so a
# repoint looks cosmetic and gets deferred. It is not cosmetic, for one reason:
#
#   THE GHCR PACKAGES DID NOT MOVE WITH THE REPOSITORY. They were COPIED, with
#   regctl, to `ghcr.io/cwfmf/firestarr/firestarr`. Both paths resolve today and
#   serve byte-identical manifests -- 51 tags each, identical sets, matching
#   per-arch digests on `main-latest` and `0.9.7` (measured 2026-11-10). But the
#   OLD package is FROZEN: new builds land only on the new path.
#
# So the failure this prevents is silent and delayed. `FIRESTARR_IMAGE_TAG` defaults
# to `main-latest`, a floating tag. An installer left on the old path keeps pulling
# successfully and keeps getting the LAST build before the copy, forever, with no
# error at any point. A 404 would at least be loud; this is a frozen image wearing a
# moving tag's name.
#
# WHY A SHAPE CHECK AND NOT A REGISTRY QUERY. The assertions below are OFFLINE and
# assert which repository is NAMED, not what it serves. A suite that queried GHCR
# would fail on an air-gapped machine and in CI without credentials, turning a
# naming check into a network dependency. firestarr_image_preflight.test.sh owns the
# live resolve check; this one owns the names.
#
# THE TRAP IN THE TWO NAMES, and it is worth stating because the strings are one
# character apart at a glance. Three distinct paths exist:
#
#   ghcr.io/cwfmf/firestarr-cpp/firestarr   RETIRED  -- frozen, still resolving
#   ghcr.io/cwfmf/firestarr/firestarr       CURRENT  -- what everything must use
#   ghcr.io/cwfmf/firestarr                 NEVER VALID as an image -- that is the
#                                           registry prefix, not a repository; it
#                                           predates the move and used the retired
#                                           four-part version scheme.
#
# The third is why `env_firestarr_image.test.sh` forbids `ghcr.io/cwfmf/firestarr:`
# WITH A TRAILING COLON and still does after this repoint: the colon is what
# distinguishes "used as an image" from "used as a prefix". That assertion did not
# need to flip, and this file must not undo it.
#
# Deps: bash 3.x (macOS ships 3.2), grep only. Exit 0 = all pass, 1 = any failure.
set -u

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPTS_DIR="$TEST_DIR/.."
REPO="$(cd "$TEST_DIR/../.." && pwd)"

CURRENT_REGISTRY="ghcr.io/cwfmf/firestarr"
CURRENT_REPO_NAME="firestarr"
RETIRED_REPO_NAME="firestarr-cpp"

pass=0
fail=0
ok()  { pass=$((pass + 1)); echo "    ok   $1"; }
bad() { fail=$((fail + 1)); echo "  FAIL   $1"; [ $# -gt 1 ] && echo "         $2"; }

# ---------------------------------------------------------------------------
# CLASS 1: the registry constant in every installer that has one.
#
# Discovered by pattern, not listed. The inherited fix list for #529 named six
# files; nine carried a registry reference, and the three it missed were the SAN
# docker installers and a test. A listed set is a set that goes stale.
# ---------------------------------------------------------------------------
registry_files=()
for f in "$SCRIPTS_DIR"/*.sh "$SCRIPTS_DIR"/*.ps1; do
    [ -f "$f" ] || continue
    if grep -qiE '(FIRESTARR_REGISTRY|FirestarrRegistry)[[:space:]]*=' "$f" 2>/dev/null; then
        registry_files+=("$f")
    fi
done

# A control on the discovery itself. Both wizard families plus the two SAN docker
# installers are known to carry this constant; finding fewer means the glob or the
# pattern broke, and a suite that silently checks nothing is worse than a red one.
if [ "${#registry_files[@]}" -lt 4 ]; then
    echo "  FAIL   discovery: expected at least 4 files assigning a FireSTARR registry, found ${#registry_files[@]}"
    printf '         %s\n' "${registry_files[@]:-(none)}"
    exit 1
fi
ok "discovery found ${#registry_files[@]} files assigning a FireSTARR registry"

for f in "${registry_files[@]}"; do
    n="$(basename "$f")"
    assigned="$(grep -hiE '(FIRESTARR_REGISTRY|FirestarrRegistry)[[:space:]]*=' "$f" \
                | grep -oE 'ghcr\.io/[A-Za-z0-9._/-]+' | head -1)"

    if [ -z "$assigned" ]; then
        bad "$n assigns a FireSTARR registry naming a ghcr.io path" \
            "the assignment exists but no ghcr.io path was found in it"
        continue
    fi

    case "$assigned" in
        */"$RETIRED_REPO_NAME")
            bad "$n names the current FireSTARR repository" \
                "got '$assigned' -- the retired package is FROZEN, new builds land only on $CURRENT_REGISTRY" ;;
        "$CURRENT_REGISTRY")
            ok "$n names the current FireSTARR repository ($assigned)" ;;
        *)
            bad "$n names the current FireSTARR repository" \
                "got '$assigned', expected '$CURRENT_REGISTRY'" ;;
    esac
done

# ---------------------------------------------------------------------------
# CLASS 2: the GitHub release download base, used by the METAL installers.
#
# This one is a live functional dependency, not a comment -- the metal path
# downloads a release asset from it. The repository redirect covers it today, which
# is exactly why it reads as cosmetic and is the member most likely to be skipped.
# ---------------------------------------------------------------------------
release_files=()
for f in "$SCRIPTS_DIR"/*.sh "$SCRIPTS_DIR"/*.ps1; do
    [ -f "$f" ] || continue
    if grep -qiE 'FIRESTARR_BINARY_RELEASE_REPO[[:space:]]*=' "$f" 2>/dev/null; then
        release_files+=("$f")
    fi
done

if [ "${#release_files[@]}" -lt 1 ]; then
    echo "  FAIL   discovery: expected at least 1 file assigning FIRESTARR_BINARY_RELEASE_REPO, found 0"
    exit 1
fi
ok "discovery found ${#release_files[@]} files assigning a FireSTARR release base"

for f in "${release_files[@]}"; do
    n="$(basename "$f")"
    url="$(grep -hiE 'FIRESTARR_BINARY_RELEASE_REPO[[:space:]]*=' "$f" \
           | grep -oE 'https://github\.com/[A-Za-z0-9._/-]+' | head -1)"
    case "$url" in
        *"/$RETIRED_REPO_NAME/"*|*"/$RETIRED_REPO_NAME")
            bad "$n names the current FireSTARR repository in its release base" \
                "got '$url' -- works only through the rename redirect" ;;
        "") bad "$n names a github.com release base" "no github.com URL in the assignment" ;;
        *)  ok "$n names the current FireSTARR repository in its release base" ;;
    esac
done

# ---------------------------------------------------------------------------
# CLASS 3: no ghcr.io path anywhere in the tree may name the retired package.
#
# The two classes above check assignments. This sweeps for a reference that is
# neither -- a docs table, an example value, a hardcoded literal inside another
# test. FIRESTARR_REQUIREMENTS.md carried the operator-facing pin, and it named a
# tag (`v0.9.7`) that returns 404 on BOTH paths, since no tag in that registry has
# ever carried a `v` prefix.
#
# SCOPE, and it is a real exclusion rather than a convenience. `scripts/__tests__/`
# is excluded, because a test's job here is to DISCUSS both names: this file names
# all three paths in its own header, and env_firestarr_image.test.sh quotes the dead
# `firestarr-cpp/firestarr:v0.9.5.10` tag to explain what went wrong. That file
# records the trap at its own lines 47-50 -- forbidding the string outright also
# forbids the explanation of why it changed, which is the part a future reader
# needs. Classes 1 and 2 already cover every executable reference under scripts/,
# so excluding the test directory loses no coverage and keeps the history readable.
# ---------------------------------------------------------------------------
cd "$REPO" || { echo "  FAIL   cannot cd to repo root"; exit 1; }

stale_paths="$(git ls-files \
               | grep -v node_modules \
               | grep -v '^scripts/__tests__/' \
               | xargs grep -nE "ghcr\.io/[Cc][Ww][Ff][Mm][Ff]/$RETIRED_REPO_NAME" 2>/dev/null \
               || true)"

if [ -z "$stale_paths" ]; then
    ok "no tracked file names the retired package in a ghcr.io path"
else
    bad "no tracked file names the retired package in a ghcr.io path" \
        "$(echo "$stale_paths" | head -4 | tr '\n' ' ')"
fi

# A POSITIVE CONTROL on that sweep. The negative above is worthless unless the same
# instrument, in the same run, can be shown to find something it should find. Without
# this, a broken `git ls-files | xargs grep` pipeline reports a clean tree.
#
# THE DELIMITER IS LOAD-BEARING. Written as `/firestarr` this control matched
# `/firestarr-cpp` too, by prefix, and reported 11 files naming the "current"
# package while the true count was zero -- it would have passed no matter what the
# tree held, which is the whole defect it exists to rule out. `[:/]` after the name
# is what separates the two packages: `firestarr-cpp` is followed by `-`.
control="$(git ls-files \
           | grep -v node_modules \
           | grep -v '^scripts/__tests__/' \
           | xargs grep -lE "ghcr\.io/[Cc][Ww][Ff][Mm][Ff]/$CURRENT_REPO_NAME[:/]" 2>/dev/null \
           || true)"
if [ -n "$control" ]; then
    ok "control: the same sweep finds $(echo "$control" | wc -l | tr -d ' ') file(s) naming the CURRENT package"
else
    bad "control: the same sweep finds files naming the CURRENT package" \
        "the sweep found neither the retired nor the current package -- the instrument is broken, and its clean result above means nothing"
fi

echo
echo "firestarr_registry_current: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
