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
