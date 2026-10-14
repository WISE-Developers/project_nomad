#!/usr/bin/env bash
#
# The release SBOM must describe the release (#398).
#
# `npm sbom` is built into npm 10 and reads package-lock.json, so the bill of
# materials is derived from the exact lockfile at the tagged commit rather than
# from whatever GitHub's dependency graph happened to index last. No third-party
# action, no network, deterministic.
#
# THE TRAP THIS GUARDS, found while building it:
#
# `npm sbom` names the document after the ROOT package — and this repo's root
# package.json has sat at 0.5.0 since forever, because
# .github/scripts/bump-version.sh bumps ONLY frontend/package.json. The product
# version is the frontend's (it is what becomes /app/VERSION in the image).
#
# So the generated document called itself `project_nomad@0.5.0` while the
# release was v0.28.2. A filename saying 0.28.2 does not fix that: SBOM
# consumers read the document's own name field, not the name of the file it
# arrived in. An artifact that misidentifies the thing it describes is worse
# than no artifact, because it is machine-readable and will be believed.
#
# Deps: bash 3.x (macOS default), npm 10+, python3. Exit 0 = pass, 1 = fail.
set -u

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$TEST_DIR/../.." && pwd)"
GEN="$REPO_ROOT/.github/scripts/generate-sbom.sh"

pass=0; fail=0
ok()  { echo "  ok   - $1"; pass=$((pass+1)); }
bad() { echo "  FAIL - $1"; fail=$((fail+1)); }

if [ ! -f "$GEN" ]; then
  echo "  FAIL - .github/scripts/generate-sbom.sh does not exist"
  echo ""
  echo "passed: 0   failed: 1"
  exit 1
fi
[ -x "$GEN" ] || bad "generate-sbom.sh is not executable"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
OUT="$WORK/sbom.spdx.json"

# ---------------------------------------------------------------------------
# 1. It must refuse to run without a version. Guessing one would reintroduce
#    exactly the mislabelling this script exists to prevent.
# ---------------------------------------------------------------------------
if ( cd "$REPO_ROOT" && "$GEN" >/dev/null 2>&1 ); then
  bad "ran with no version argument — it would have invented a label"
else
  ok "refuses to run without an explicit release version"
fi

# ---------------------------------------------------------------------------
# 2. The control: it generates something, and that something is valid SPDX.
# ---------------------------------------------------------------------------
if ( cd "$REPO_ROOT" && "$GEN" 9.9.9 "$OUT" >/dev/null 2>&1 ); then
  ok "generates an SBOM"
else
  bad "generation failed"
  echo ""
  echo "passed: $pass   failed: $fail"
  exit 1
fi

python3 - "$OUT" <<'PY' > "$WORK/report.txt" 2>&1
import json, sys
d = json.load(open(sys.argv[1]))
pkgs = d.get("packages", [])
print("SPDXVERSION", d.get("spdxVersion", ""))
print("NAME", d.get("name", ""))
print("COUNT", len(pkgs))
names = {p.get("name", "") for p in pkgs}
print("HASBACKEND", "@nomad/backend" in names)
print("HASFRONTEND", "@nomad/frontend" in names)
# The root package entry must carry the release version too — the name field
# alone is not where every consumer looks.
root = [p for p in pkgs if p.get("name") in ("project_nomad", "@nomad/root")]
print("ROOTVERSION", root[0].get("versionInfo", "") if root else "")
print("HASCOMMENT", bool(d.get("comment")))
print("HASCREATIONCOMMENT", bool((d.get("creationInfo") or {}).get("comment")))
print("SAYSBUILDTIME", "BUILD-TIME" in (d.get("comment") or ""))
print("SAYSNOTIMAGE", "not an inventory of the shipped container" in (d.get("comment") or ""))
# The ROOT identifier must not carry a stale version, and documentDescribes
# must point at it.
#
# CHECKED PRECISELY, NOT BY GREP. My first version of this searched the whole
# document for "0.5.0" and failed on three INNOCENT packages — glob@10.5.0,
# @better-auth/utils@0.5.0, and @nomad/backend which genuinely is 0.5.0. The
# code was right and the assertion was wrong, which is the exact blind
# string-match hazard the generator's own comment warns about.
root_id = root[0].get("SPDXID", "") if root else ""
print("ROOTID", root_id)
print("ROOTIDSTALE", "project_nomad-0.5.0" in root_id)
print("DESCRIBESROOT", root_id in (d.get("documentDescribes") or []))
rels = d.get("relationships", [])
print("DANGLINGREFS", any(
    "project_nomad-0.5.0" in (r.get("spdxElementId", "") + r.get("relatedSpdxElement", ""))
    for r in rels))
print("NAMESPACESTALE", "-0.5.0-" in (d.get("documentNamespace") or ""))
PY
report() { grep -m1 "^$1 " "$WORK/report.txt" | cut -d' ' -f2-; }

[ "$(report SPDXVERSION)" = "SPDX-2.3" ] \
  && ok "is SPDX-2.3" \
  || bad "not SPDX-2.3: '$(report SPDXVERSION)'"

# ---------------------------------------------------------------------------
# 3. THE DEFECT ITSELF. The document must name the version it was given, not
#    the root package.json version.
# ---------------------------------------------------------------------------
name="$(report NAME)"
case "$name" in
  *9.9.9*) ok "document names the RELEASE version it was given" ;;
  *0.5.0*) bad "document still names the stale root package version — this is the #398 trap" ;;
  *)       bad "document name does not carry the release version: '$name'" ;;
esac

rootver="$(report ROOTVERSION)"
if [ "$rootver" = "9.9.9" ]; then
  ok "the root package entry carries the release version too"
else
  bad "root package entry says '$rootver', not the release version"
fi

# ---------------------------------------------------------------------------
# 4. It must actually have walked the dependency tree. A valid, nearly empty
#    SPDX file is the failure that looks like success.
# ---------------------------------------------------------------------------
count="$(report COUNT)"
if [ "${count:-0}" -gt 100 ]; then
  ok "contains the dependency tree ($count packages)"
else
  bad "only $count packages — the tree was not walked"
fi

[ "$(report HASBACKEND)" = "True" ] \
  && ok "includes the backend workspace" \
  || bad "backend workspace missing — a workspace flag is wrong"

[ "$(report HASFRONTEND)" = "True" ] \
  && ok "includes the frontend workspace" \
  || bad "frontend workspace missing — a workspace flag is wrong"

# ---------------------------------------------------------------------------
# 5. It must not need node_modules. The release workflow installs only
#    frontend's, so a generator requiring a full install would fail in CI while
#    passing on every developer machine — the shape of the #387 CI failure.
# ---------------------------------------------------------------------------
if grep -q -- '--package-lock-only' "$GEN"; then
  ok "reads the lockfile only, so it does not depend on an install"
else
  bad "no --package-lock-only: this would need node_modules that CI does not install"
fi

# ---------------------------------------------------------------------------
# 5b. THE DOCUMENT MUST SAY WHAT IT DESCRIBES.
#
# It lists every npm package in the lockfile, dev tooling included, and that is
# deliberate: filtering it to match the image would mean replicating
# `--omit=dev --omit=peer --omit=optional` (backend/Dockerfile) and keeping two
# command lines in sync forever — in a repo already bitten by getting that set
# wrong (#389). The full tree also covers build-chain exposure, which an
# image-only SBOM hides precisely.
#
# The cost of that choice is that a scanner operator could read it as a
# production inventory and raise findings for tooling that never ships. So the
# scope is stated IN the document rather than only in a commit message.
# ---------------------------------------------------------------------------
[ "$(report HASCOMMENT)" = "True" ] \
  && ok "carries a document-level comment" \
  || bad "no document comment — its scope is implicit, and will be misread"

[ "$(report HASCREATIONCOMMENT)" = "True" ] \
  && ok "carries the same note in creationInfo, where some tools look instead" \
  || bad "creationInfo has no comment"

[ "$(report SAYSBUILDTIME)" = "True" ] \
  && ok "names itself BUILD-TIME scope" \
  || bad "the comment does not say this is a build-time bill"

[ "$(report SAYSNOTIMAGE)" = "True" ] \
  && ok "says plainly that it is not an inventory of the shipped image" \
  || bad "does not disclaim being a production inventory — the misreading it invites"

# ---------------------------------------------------------------------------
# 5c. No stale version may survive anywhere, including inside identifiers.
#
# npm builds the root SPDXID from name AND version, so it read
# `SPDXRef-Package-project_nomad-0.5.0` and documentDescribes pointed at it.
# Stamping `name` and `versionInfo` alone left that behind — correct-looking in
# the fields most people check, wrong in the one the document uses to say what
# it describes.
# ---------------------------------------------------------------------------
[ "$(report ROOTIDSTALE)" = "False" ] \
  && ok "the root SPDX identifier carries no stale version" \
  || bad "root SPDXID still embeds the stale root version: $(report ROOTID)"

[ "$(report DESCRIBESROOT)" = "True" ] \
  && ok "documentDescribes points at the renamed root id" \
  || bad "documentDescribes does not reference the root package — a dangling id"

[ "$(report DANGLINGREFS)" = "False" ] \
  && ok "no relationship references the old stale-versioned id" \
  || bad "a relationship still points at the pre-rename id"

[ "$(report NAMESPACESTALE)" = "False" ] \
  && ok "documentNamespace carries the release version, not the stale one" \
  || bad "documentNamespace still embeds the stale root version"

# ---------------------------------------------------------------------------
# 6. Every release workflow must attach an SBOM, and must pass it a version
#    expression that the workflow ACTUALLY DECLARES.
#
#    This caught a real break while being written. The three workflows are not
#    symmetric: stable and lts expose `version`, but dev-release's step emits
#    `previous`, `current` and `tag` — no `version`. Copying the stable
#    expression into dev-release produced `steps.version.outputs.version`, which
#    resolves to an EMPTY STRING. The generator would then have refused (loudly,
#    by design) and failed every dev release. A reference to an output that does
#    not exist is not a syntax error and nothing else would have caught it.
# ---------------------------------------------------------------------------
for wf in stable-release lts-release dev-release; do
  f="$REPO_ROOT/.github/workflows/$wf.yml"
  if [ ! -f "$f" ]; then
    bad "$wf.yml is missing"
    continue
  fi

  if grep -q 'generate-sbom.sh' "$f"; then
    ok "$wf attaches an SBOM"
  else
    bad "$wf publishes a release with no SBOM"
    continue
  fi

  if grep -q 'nomad-sbom-\*.spdx.json' "$f"; then
    ok "$wf lists the SBOM among the release files"
  else
    bad "$wf generates an SBOM but never attaches it — a file nobody receives"
  fi

  # The expression it passes, against the outputs that file declares.
  ref="$(grep -o 'generate-sbom\.sh "\${{ steps\.[a-zA-Z_]*\.outputs\.[a-zA-Z_]* }}"' "$f" \
         | head -1 | sed 's/.*outputs\.\([a-zA-Z_]*\).*/\1/')"
  if [ -z "$ref" ]; then
    bad "$wf: could not find the version expression passed to generate-sbom.sh"
  elif grep -q "echo \"$ref=" "$f"; then
    ok "$wf passes '$ref', which that workflow declares"
  else
    bad "$wf passes '$ref' but never declares it — it would expand to empty"
  fi
done

echo ""
echo "passed: $pass   failed: $fail"
[ "$fail" -eq 0 ]
