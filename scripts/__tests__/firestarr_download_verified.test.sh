#!/usr/bin/env bash
#
# The FireSTARR binary baked into the production image must be verified before it is
# trusted — both architectures (#528).
#
# THE HOLE. `build-firestarr.yml` downloaded a release tarball with `curl -L`, extracted
# it, `chmod +x`'d it and baked it into the image every agency pulls, with NO integrity
# check anywhere in the file. `grep -icE "sha256sum|shasum|checksum|--digest"` over the
# whole workflow returned 0.
#
# WHAT MADE IT WORTH FIXING RATHER THAN NOTING. We already do this correctly for the SAME
# ASSET from the SAME URL: `scripts/build-offline-bundle.sh` verifies it, and Node, and
# the fuel dataset, refusing "an input nobody has vouched for". So the strict path was the
# offline bundle for one field laptop, and the unverified path was the published image.
# That is backwards from the risk.
#
# TWO DIFFERENT PROPERTIES, AND BOTH ARE NEEDED.
#
#   INTEGRITY — are these the bytes the release says they are? Answered by comparing the
#   download against the `digest` the GitHub release API publishes per asset. Verified by
#   hand on 2026-11-10: the API's sha256 for firestarr-ubuntu-x64-gcc-Release.tar.gz
#   matched a locally computed sha256 of the real file, byte for byte.
#
#   IDENTITY — is this even the right repository? CWFMF is renaming `firestarr-cpp` to
#   `firestarr`, and GitHub leaves a permanent redirect that `curl -L` follows in silence.
#   **That redirect dies the moment anything new occupies the old name**, and the plain
#   name is currently taken, so this is a two-step shuffle — exactly when something gets
#   parked at the vacated name. A digest check alone does NOT catch this: a different repo
#   publishes its own assets with its own honest digests, and everything agrees.
#
#   So the workflow pins the upstream repository's NUMERIC ID, which is assigned at
#   creation. It survives a rename, which is the point — the rename must not break us —
#   and it does not survive being a different repository, which is also the point.
#   Measured: firestarr-cpp is 1029186458 and CWFMF/FireSTARR is 468308117, two distinct
#   ids, so the pin tells them apart even if the NAMES swap.
#
# WHAT THIS TEST PINS: that both download steps verify both properties and FAIL CLOSED.
# It does not run the workflow — a workflow that is only checked by reading it is not
# checked, and this is the house pattern for that (scripts/__tests__/*.test.sh, run as a
# loop by tests.yml).
#
# Deps: bash 3.x (macOS default). Exit 0 = pass, 1 = fail.
set -u

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$TEST_DIR/../.." && pwd)"
WF="$REPO/.github/workflows/build-firestarr.yml"

# The upstream identity, recorded so a change is deliberate rather than silent.
EXPECTED_REPO_ID="1029186458"

pass=0; fail=0
ok()  { echo "  ok   - $1"; pass=$((pass+1)); }
bad() { echo "  FAIL - $1"; fail=$((fail+1)); }

[ -f "$WF" ] || { bad "not found: $WF"; echo ""; echo "passed: $pass   failed: $fail"; exit 1; }

# ---------------------------------------------------------------------------
# 1. INTEGRITY. The workflow must compare a computed digest against an expected
#    one, and there must be one for each architecture.
# ---------------------------------------------------------------------------
digest_checks="$(grep -cE 'sha256sum|shasum -a 256' "$WF")"
if [ "$digest_checks" -ge 2 ]; then
  ok "both download steps compute a sha256 ($digest_checks occurrences)"
else
  bad "only $digest_checks sha256 computation(s) — a fix applied to one arch is not applied to the other"
fi

if grep -qE '\.digest|digest' "$WF"; then
  ok "the workflow asks the release API for the expected digest"
else
  bad "the workflow never reads the release API's published digest"
fi

# ---------------------------------------------------------------------------
# 2. IDENTITY. The upstream repository id must be pinned, because the rename's
#    redirect is followed silently and a digest check cannot see through it.
# ---------------------------------------------------------------------------
if grep -q "$EXPECTED_REPO_ID" "$WF"; then
  ok "the upstream repository id ($EXPECTED_REPO_ID) is pinned"
else
  bad "the upstream repository id is not pinned — a redirect to a different repo would pass a digest check"
fi

# ---------------------------------------------------------------------------
# 3. FAIL CLOSED. A guard that logs and continues is not a guard. Each download
#    step must exit non-zero on a mismatch.
# ---------------------------------------------------------------------------
exits="$(grep -cE 'exit 1' "$WF")"
if [ "$exits" -ge 3 ]; then
  ok "the workflow exits non-zero on failure in at least 3 places ($exits)"
else
  bad "only $exits 'exit 1' — verification that does not stop the build is decoration"
fi

# A mismatch must be reported as a GitHub error annotation, not a bare echo, or it
# scrolls past in a green-looking log.
if [ "$(grep -cE '::error::' "$WF")" -ge 2 ]; then
  ok "failures are raised as ::error:: annotations"
else
  bad "fewer than 2 ::error:: annotations — a silent failure in a long log is a silent failure"
fi

# ---------------------------------------------------------------------------
# 4. CONTROLS. Every assertion above is a grep over one file, so they are all
#    satisfiable by accident if the file were empty or unreadable. Pin both
#    directions against known content.
# ---------------------------------------------------------------------------
if grep -q "firestarr-ubuntu-x64-gcc-Release.tar.gz" "$WF" \
   && grep -q "firestarr-ubuntu-arm64-gcc-Release.tar.gz" "$WF"; then
  ok "control: the file is readable and still names both release assets"
else
  bad "CONTROL FAILED — the workflow does not name both assets, so the greps above prove nothing"
fi

if grep -q "ZZ_THIS_STRING_IS_NOT_IN_THE_WORKFLOW" "$WF"; then
  bad "CONTROL FAILED — grep claims to find a string that cannot be present"
else
  ok "control: a string known to be absent is not found"
fi

echo ""
echo "passed: $pass   failed: $fail"
[ "$fail" -eq 0 ]
