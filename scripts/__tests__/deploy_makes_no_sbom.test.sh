#!/usr/bin/env bash
#
# A DEPLOY DOES NOT PRODUCE A BILL OF MATERIALS (#465, step 4).
#
# WHY IT EXISTED. #441 put the SBOM at deploy time for a sound reason: CI had no
# image to describe, so a document produced there would have described something
# nobody ran.
#
# WHY IT IS GONE, and this is Franco's reasoning rather than mine: the document
# serves its purpose BEFORE the thing is deployed, not after. It is read when
# deciding whether to ship, and when answering "does the version we run contain
# $CVE" — both of which happen away from the box, by people who may have
# deployed nothing. Producing it during a deploy puts it in the one place least
# useful to either question, and writes ~28MB to a production box per deployed
# version (~2.3GB per two months at the current rate, on a volume with 15GB
# free) to duplicate something already published.
#
# WHERE IT LIVES NOW, verified against the real artefact on 2026-10-23 by
# reading it back out of the registry rather than trusting a green workflow:
# ghcr.io/wise-developers/project_nomad/nomad:0.39.0 carries an SPDX-2.3
# attestation of 1334 packages (633 npm, 370 deb, 322 golang), 21,903,806
# bytes, published by CI beside the source it was built from. The npm bill from
# #398 is attached to the GitHub Release in the same place.
#
# THIS ALSO REMOVES AN ENTIRE CLASS OF DEFECT rather than a step: #464 (the
# document had never been produced, silently, for two months), #469 (the
# version arrived as a JSON fragment and named the files), and the `|| true`
# contract that existed only so a failing SBOM could not break a deploy. None
# of them can recur in a deploy that produces no document.
#
# Deps: bash 3.x (macOS default). Exit 0 = pass, 1 = fail.
set -u

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$TEST_DIR/../.." && pwd)"
DEPLOY="$TEST_DIR/../deploy.sh"
[ -f "$DEPLOY" ] || { echo "deploy.sh not found at $DEPLOY"; exit 1; }

pass=0; fail=0
ok()  { echo "  ok   - $1"; pass=$((pass+1)); }
bad() { echo "  FAIL - $1"; fail=$((fail+1)); }

echo
echo "#465 step 4 — a deploy produces no bill of materials"

if grep -q "generate-image-sbom" "$DEPLOY"; then
    bad "deploy.sh still generates an image SBOM"
else
    ok "deploy.sh generates no image SBOM"
fi

# Dead code is deleted, not left behind to be rediscovered and re-wired.
if [ -e "$REPO_ROOT/scripts/generate-image-sbom.sh" ]; then
    bad "scripts/generate-image-sbom.sh is still present with nothing calling it"
else
    ok "the generator is deleted, not orphaned"
fi

# A removal that leaves no trace reads as an oversight to the next person, who
# then re-adds it. deploy.sh must say where the document lives instead.
# "attestation" specifically: the image repo name already appears in deploy.sh
# for the pull, so matching that too would pass without a word of explanation
# having been written.
if grep -qi "attestation" "$DEPLOY"; then
    ok "deploy.sh says where the bill of materials lives now"
else
    bad "nothing tells the next reader where the SBOM went — it will be re-added"
fi

echo
echo "deploy_makes_no_sbom: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
