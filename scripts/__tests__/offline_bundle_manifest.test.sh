#!/usr/bin/env bash
#
# Offline bundle builder: the manifest pins every input (refs #318).
#
# #318 asks for a builder that runs on a connected machine and produces a
# bundle that installs and runs on an air-gapped one. It says plainly that
# "crude is acceptable". Crude is fine. Unreproducible is not, and the two
# are easy to confuse.
#
# The reason is in acceptance criterion #4: "build -> copy to USB -> install
# on N laptops". One build serves many machines. If the builder resolves
# "latest" at download time, then two runs a week apart produce different
# bundles, the laptops in the field disagree with each other, and there is no
# way to answer "what is actually on that thumb drive?" after the fact.
#
# So every input the bundle ships -- the Node runtime, the FireSTARR binary,
# and the dataset when one is included -- must be named by an exact version
# and verified by checksum, and the manifest must record both. A tag like
# "main-latest" is a moving target, not a pin: #376 exists precisely because
# a FireSTARR tag we referenced stopped existing.
#
# This suite reads the builder as text rather than executing it. Running it
# would mean downloading a Node runtime, a FireSTARR release and potentially
# 3 GB of fuel data -- not something a test suite should do, and not
# something CI can do offline. The other suites in this directory take the
# same approach for the same reason.
#
# Deps: bash 3.x compatible (macOS ships bash 3.2), sed/awk/grep only.
# Exit 0 = all pass.

set -u

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPTS="$TEST_DIR/.."
BUILDER="$SCRIPTS/build-offline-bundle.sh"

pass=0
fail=0

ok() {
  pass=$((pass + 1))
  echo "    ok   $1"
}

bad() {
  fail=$((fail + 1))
  echo "  FAIL   $1"
  [ $# -gt 1 ] && echo "         $2"
}

# ---------------------------------------------------------------------------
# The builder has to exist before anything else can be true of it.
# ---------------------------------------------------------------------------
if [ -f "$BUILDER" ]; then
  ok "builder script exists at scripts/build-offline-bundle.sh"
else
  bad "builder script exists at scripts/build-offline-bundle.sh" \
      "not found -- #318 acceptance criterion #1 asks for a builder script"
  echo
  echo "offline_bundle_manifest: $pass passed, $fail failed"
  exit 1
fi

# ---------------------------------------------------------------------------
# It must emit a manifest at all.
# ---------------------------------------------------------------------------
if grep -qE 'manifest' "$BUILDER"; then
  ok "builder references a manifest"
else
  bad "builder references a manifest" \
      "no mention of a manifest; there is then no record of what a bundle contains"
fi

# ---------------------------------------------------------------------------
# Each of the three inputs must be pinned by an explicit version variable.
#
# Checked as named variables rather than by grepping for literal version
# numbers: a hardcoded version buried in a URL is a pin by accident, and the
# next person to edit the URL will not know it was load-bearing.
# ---------------------------------------------------------------------------
for spec in "NODE_VERSION:Node runtime" "FIRESTARR_VERSION:FireSTARR binary" "DATASET_VERSION:fuel dataset"; do
  var="${spec%%:*}"
  what="${spec#*:}"
  if grep -qE "^[[:space:]]*(readonly[[:space:]]+)?${var}=" "$BUILDER"; then
    ok "$what is pinned via \$$var"
  else
    bad "$what is pinned via \$$var" \
        "without an explicit version variable the bundle is not reproducible"
  fi
done

# ---------------------------------------------------------------------------
# A moving tag is not a pin.
#
# #376 was filed because .env.example named a FireSTARR tag that no longer
# existed. The same class of mistake here ships a bundle nobody can rebuild.
# ---------------------------------------------------------------------------
moving="$(grep -nE '(main|dev|unstable)-latest|:latest' "$BUILDER" | grep -v '^[[:space:]]*#' || true)"
if [ -z "$moving" ]; then
  ok "no moving tags (main-latest / dev-latest / :latest) used as inputs"
else
  bad "no moving tags (main-latest / dev-latest / :latest) used as inputs" \
      "found: $(echo "$moving" | head -3 | tr '\n' ' ')"
fi

# ---------------------------------------------------------------------------
# Every downloaded input must be checksum-verified, not merely pinned.
#
# A version pin says what we meant to fetch. A checksum says what we actually
# got. On an air-gapped install there is no second chance to notice a truncated
# or corrupted download -- the practitioner is standing at an incident.
# ---------------------------------------------------------------------------
if grep -qE 'sha256|shasum|sha256sum|Get-FileHash' "$BUILDER"; then
  ok "builder verifies downloads by checksum"
else
  bad "builder verifies downloads by checksum" \
      "no sha256/shasum/Get-FileHash; a truncated download would ship silently"
fi

# ---------------------------------------------------------------------------
# The manifest must record the checksums, not just compute them.
#
# Verifying at build time and discarding the result answers "was this download
# intact?" but not "what is on that thumb drive?", which is the question that
# gets asked in the field.
# ---------------------------------------------------------------------------
manifest_block="$(sed -n '/[Mm]anifest/,/^}/p' "$BUILDER" 2>/dev/null || true)"
if echo "$manifest_block" | grep -qE 'sha256|checksum'; then
  ok "manifest records checksums, not only versions"
else
  bad "manifest records checksums, not only versions" \
      "a manifest without checksums cannot answer 'what is on this USB stick?'"
fi

echo
echo "offline_bundle_manifest: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
