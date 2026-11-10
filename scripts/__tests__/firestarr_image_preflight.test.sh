#!/usr/bin/env bash
#
# The installer must confirm the configured FireSTARR image RESOLVES, at install time
# (#326's open follow-up, made urgent by #529).
#
# THE FAILURE THIS PREVENTS, which has already happened once. #326: four installers
# pinned a FireSTARR digest that no longer existed in the registry. The install completed
# cleanly and then **every model run died with exit 1**, reproduced on a fresh Ubuntu
# 24.04 box. #326's own follow-up names the gap and it was never closed:
#
#   "The installer does not verify the configured image resolves. A floating tag can 404
#    too — renamed channel, pruned package, typo'd FIRESTARR_IMAGE_TAG override. Today the
#    first sign of trouble is a failed model run, a long way from the cause."
#
# WHY NOW. CWFMF renamed `firestarr-cpp` to `firestarr`. The registry path is a hard-coded
# constant in each installer. If it is wrong, or right-but-not-yet-published, the next
# person to install gets a working-looking install and a dead model, exactly as in #326.
# A preflight turns a silent, delayed failure into a loud, immediate one.
#
# WHAT ACTUALLY HAPPENED, recorded because this header predicted it wrong (2026-11-10).
# It expected the old repository to be DELETED -- "a hard 404, no redirect". It was not.
# CWFMF COPIED the packages to the new path with regctl and is LEAVING the old one in
# place until Nomad releases the repoint. So the old path still resolves.
#
# THAT IS THE WORSE OUTCOME FOR THIS CHECK, AND THE REASON IT STILL MATTERS. A 404 is
# loud and a preflight catches it. A frozen-but-resolving package is silent: the old
# path receives no new builds, while `FIRESTARR_IMAGE_TAG` still defaults to the
# floating `main-latest`. An installer left behind keeps pulling successfully and keeps
# getting the last build before the copy, indefinitely, with nothing to notice.
# A resolve check cannot see that at all -- only naming the right repository can, which
# is what firestarr_registry_current.test.sh exists to hold.
#
# AND THE TAG ALREADY FLOATS. `FIRESTARR_IMAGE_TAG` defaults to `main-latest`, so a
# resolve check is not a substitute for version pinning and must not be mistaken for one —
# it answers "can this be pulled", never "is this the build we meant".
#
# WHAT THIS PINS: that the check exists, runs against the ref the installer actually
# built, and FAILS LOUDLY rather than warning and continuing. A preflight that prints a
# warning and proceeds reproduces #326 with extra steps.
#
# Deps: bash 3.x (macOS default). Exit 0 = pass, 1 = fail.
set -u

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$TEST_DIR/../.." && pwd)"

pass=0; fail=0
ok()  { echo "  ok   - $1"; pass=$((pass+1)); }
bad() { echo "  FAIL - $1"; fail=$((fail+1)); }

# The installers that choose a FireSTARR image for docker mode.
SCRIPTS="install-nomad-headless.sh install_nomad_setup.sh install-nomad-demo.sh"

for n in $SCRIPTS; do
  f="$REPO/scripts/$n"
  [ -f "$f" ] || { bad "not found: scripts/$n"; continue; }

  # Only applies to installers that actually name a FireSTARR registry.
  if ! grep -q "FIRESTARR_REGISTRY" "$f"; then
    ok "$n names no FireSTARR registry, nothing to preflight"
    continue
  fi

  # ---------------------------------------------------------------------
  # 1. THE CHECK EXISTS.
  # ---------------------------------------------------------------------
  if grep -q "verify_firestarr_image" "$f"; then
    ok "$n defines a FireSTARR image preflight"
  else
    bad "$n chooses a FireSTARR image but never verifies it resolves (#326)"
    continue
  fi

  # ---------------------------------------------------------------------
  # 2. IT IS CALLED. A guard defined and never called has never rejected
  #    anything — #524 found two of those in these same files.
  # ---------------------------------------------------------------------
  tot="$(grep -c "\bverify_firestarr_image\b" "$f")"
  def="$(grep -c "^verify_firestarr_image()" "$f")"
  if [ "$((tot - def))" -gt 0 ]; then
    ok "$n calls verify_firestarr_image()"
  else
    bad "$n defines verify_firestarr_image() and never calls it — a guard that cannot fire"
  fi

  # ---------------------------------------------------------------------
  # 3. IT RESOLVES RATHER THAN GUESSES. `docker manifest inspect` answers
  #    "does the registry serve this" without pulling gigabytes.
  # ---------------------------------------------------------------------
  if grep -q "manifest inspect" "$f"; then
    ok "$n resolves the ref against the registry"
  else
    bad "$n has a preflight that does not actually ask the registry"
  fi
done

# ---------------------------------------------------------------------------
# 4. THE PREFLIGHT MUST BE ABLE TO SAY NO. Extract the function and run it
#    against a reference that cannot exist, and one that does. A check that
#    cannot fail is the thing #326 shipped.
# ---------------------------------------------------------------------------
SRC_FILE="$REPO/scripts/install-nomad-headless.sh"
if [ -f "$SRC_FILE" ] && grep -q "^verify_firestarr_image()" "$SRC_FILE"; then
  body="$(awk '/^verify_firestarr_image\(\) \{/{i=1} i{print} i&&/^\}/{exit}' "$SRC_FILE")"
  # Stub the installer's own output helpers so the function can run standalone.
  print_error() { :; }; print_warning() { :; }; print_info() { :; }; print_success() { :; }
  eval "$body"

  # THE REF IS DERIVED FROM THE INSTALLER, NEVER HARDCODED HERE.
  #
  # It used to be the literal `ghcr.io/cwfmf/firestarr-cpp/firestarr:main-latest`,
  # labelled "the image the installer currently defaults to". The moment #529
  # repointed the installers, that label became false and the assertion kept
  # passing anyway -- the retired package still resolves, so this would have gone
  # green while testing an image no installer names. A true result about the wrong
  # subject, which is the failure shape that is hardest to see in a green suite.
  #
  # Reading the three constants out of the script means the check follows the
  # installer wherever it points, including the next rename.
  reg="$(grep -E '^FIRESTARR_REGISTRY=' "$SRC_FILE" | head -1 | cut -d'"' -f2)"
  nam="$(grep -E '^FIRESTARR_IMAGE_NAME=' "$SRC_FILE" | head -1 | cut -d'"' -f2)"
  tag="$(grep -E '^FIRESTARR_IMAGE_TAG=' "$SRC_FILE" | head -1 | sed 's/.*:-//; s/}.*//')"
  default_ref="$reg/$nam:$tag"

  if [ -z "$reg" ] || [ -z "$nam" ] || [ -z "$tag" ]; then
    bad "cannot derive the installer's default FireSTARR ref (reg='$reg' name='$nam' tag='$tag')"
  elif command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    if verify_firestarr_image "$default_ref" >/dev/null 2>&1; then
      ok "live: the preflight ACCEPTS the installer's own default image ($default_ref)"
    else
      bad "live: the preflight rejects the installer's own default image ($default_ref)"
    fi
    if verify_firestarr_image "ghcr.io/cwfmf/this-repo-cannot-exist/firestarr:main-latest" >/dev/null 2>&1; then
      bad "live: the preflight ACCEPTED an image that cannot exist — it cannot say no"
    else
      ok "live: the preflight REJECTS an image that cannot exist"
    fi
  else
    # An unreachable instrument and a clean result look identical. Say which.
    echo "  n/a  - docker unavailable; the live accept/reject pair was not run"
  fi
else
  bad "cannot extract verify_firestarr_image() from install-nomad-headless.sh to exercise it"
fi

echo ""
echo "passed: $pass   failed: $fail"
[ "$fail" -eq 0 ]
