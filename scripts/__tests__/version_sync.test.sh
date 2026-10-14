#!/usr/bin/env bash
#
# All three package.json files must carry the same version (#442).
#
# They did not. `bump-version.sh` wrote ONLY frontend/package.json — the real
# product version, the one that becomes /app/VERSION in the image — while root
# and backend sat at 0.5.0 for most of a year.
#
# Nothing read those fields programmatically, which is why it survived: every
# version read in the repo goes to frontend/package.json, and both other
# packages are `private: true`. But "no code reads it" is not "nothing depends
# on it":
#
#   - `npm sbom` names its document after the ROOT package, so the release
#     bill of materials called itself project_nomad@0.5.0 on a v0.28.x release
#     until #398 stamped over it.
#   - `scripts/build-offline-bundle.sh` copies backend/package.json into the
#     bundle as app/package.json, so the artifact handed to an agency carried a
#     package manifest claiming 0.5.0.
#
# Franco chose to bump all three rather than blank the unused ones, because a
# placeholder would have shipped `0.0.0-private` to an agency — worse on a
# delivered artifact than a stale number.
#
# Deps: bash 3.x (macOS default), node. Exit 0 = pass, 1 = fail.
set -u

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$TEST_DIR/../.." && pwd)"
BUMP="$REPO/.github/scripts/bump-version.sh"

pass=0; fail=0
ok()  { echo "  ok   - $1"; pass=$((pass+1)); }
bad() { echo "  FAIL - $1"; fail=$((fail+1)); }

version_of() { node -p "require('$1').version" 2>/dev/null; }

# ---------------------------------------------------------------------------
# 1. THE REPO STATE. The three files must agree right now.
# ---------------------------------------------------------------------------
root_v="$(version_of "$REPO/package.json")"
back_v="$(version_of "$REPO/backend/package.json")"
front_v="$(version_of "$REPO/frontend/package.json")"

echo "  (root=$root_v backend=$back_v frontend=$front_v)"

if [ "$root_v" = "$front_v" ]; then
  ok "root package.json matches the product version"
else
  bad "root is $root_v, product is $front_v"
fi

if [ "$back_v" = "$front_v" ]; then
  ok "backend package.json matches the product version"
else
  bad "backend is $back_v, product is $front_v"
fi

# ---------------------------------------------------------------------------
# 2. THE SCRIPT. Run it against a COPY — running it here would bump the real
#    repo, which is precisely the kind of side effect a test must not have.
# ---------------------------------------------------------------------------
[ -f "$BUMP" ] || { bad "bump-version.sh not found"; echo ""; echo "passed: $pass   failed: $fail"; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/backend" "$WORK/frontend" "$WORK/.github/scripts"
cp "$BUMP" "$WORK/.github/scripts/"
for f in package.json backend/package.json frontend/package.json; do
  cp "$REPO/$f" "$WORK/$f"
done
# Known starting point, deliberately mismatched so a script that bumps only one
# file cannot accidentally look correct.
node -e '
const fs=require("fs");
const set=(p,v)=>{const j=JSON.parse(fs.readFileSync(p,"utf8"));j.version=v;fs.writeFileSync(p,JSON.stringify(j,null,2)+"\n");};
set(process.argv[1],"1.1.1"); set(process.argv[2],"2.2.2"); set(process.argv[3],"3.3.3");
' "$WORK/package.json" "$WORK/backend/package.json" "$WORK/frontend/package.json"

out="$(cd "$WORK" && bash .github/scripts/bump-version.sh patch 2>/dev/null)"

if [ "$out" = "3.3.4" ]; then
  ok "echoes ONLY the new version, bumped from the product file (3.3.3 -> 3.3.4)"
else
  bad "stdout was '$out', expected '3.3.4' — the workflows capture this verbatim"
fi

w_root="$(version_of "$WORK/package.json")"
w_back="$(version_of "$WORK/backend/package.json")"
w_front="$(version_of "$WORK/frontend/package.json")"

[ "$w_front" = "3.3.4" ] \
  && ok "bumps the product file" \
  || bad "frontend is $w_front, expected 3.3.4"

[ "$w_root" = "3.3.4" ] \
  && ok "writes the SAME version to root (was 1.1.1, deliberately different)" \
  || bad "root is $w_root, expected 3.3.4 — this is #442"

[ "$w_back" = "3.3.4" ] \
  && ok "writes the SAME version to backend (was 2.2.2, deliberately different)" \
  || bad "backend is $w_back, expected 3.3.4 — this is #442"

# ---------------------------------------------------------------------------
# 3. It must take the version FROM the product file, not from whichever it
#    happens to read first. Root starting higher must not win.
# ---------------------------------------------------------------------------
node -e '
const fs=require("fs");
const set=(p,v)=>{const j=JSON.parse(fs.readFileSync(p,"utf8"));j.version=v;fs.writeFileSync(p,JSON.stringify(j,null,2)+"\n");};
set(process.argv[1],"9.9.9"); set(process.argv[2],"9.9.9"); set(process.argv[3],"0.1.0");
' "$WORK/package.json" "$WORK/backend/package.json" "$WORK/frontend/package.json"

out2="$(cd "$WORK" && bash .github/scripts/bump-version.sh minor 2>/dev/null)"
if [ "$out2" = "0.2.0" ]; then
  ok "the PRODUCT file is the source of truth, not the highest number present"
else
  bad "bumped to '$out2' from frontend 0.1.0 — expected 0.2.0"
fi

# ---------------------------------------------------------------------------
# 4. A missing sibling must not be invented. Writing a package.json that is not
#    there would be a silent repo change nobody asked for.
# ---------------------------------------------------------------------------
rm -f "$WORK/backend/package.json"
(cd "$WORK" && bash .github/scripts/bump-version.sh patch >/dev/null 2>&1)
if [ -f "$WORK/backend/package.json" ]; then
  bad "created backend/package.json out of nothing"
else
  ok "does not invent a package.json that is absent"
fi

# ---------------------------------------------------------------------------
# 5. THE RELEASE WORKFLOWS MUST COMMIT WHAT THE SCRIPT WRITES.
#
# This caught a real break, and the break was mine. Fixing bump-version.sh to
# write all three files was only half the job: every release workflow staged
# `git add frontend/package.json` alone, so the other two were modified in the
# runner and then thrown away. Two bot bumps later, root and backend were
# drifting again — the exact condition #442 fixed, reintroduced one layer up,
# and it turned dev red.
#
# A script that writes three files and a workflow that commits one is not a
# contradiction either of them can see on its own. So the assertion is here.
# ---------------------------------------------------------------------------
for wf in dev-release lts-release stable-release; do
  f="$REPO/.github/workflows/$wf.yml"
  if [ ! -f "$f" ]; then
    bad "$wf.yml is missing"
    continue
  fi

  add_line="$(grep -E '^\s*git add .*package\.json' "$f" | head -1)"
  if [ -z "$add_line" ]; then
    bad "$wf stages no package.json at all"
    continue
  fi

  missing=""
  case "$add_line" in *" package.json"*) ;; *) missing="root " ;; esac
  case "$add_line" in *"backend/package.json"*) ;; *) missing="${missing}backend " ;; esac
  case "$add_line" in *"frontend/package.json"*) ;; *) missing="${missing}frontend " ;; esac

  if [ -z "$missing" ]; then
    ok "$wf stages all three package.json files"
  else
    bad "$wf stages a PARTIAL bump — missing: $missing"
  fi
done

echo ""
echo "passed: $pass   failed: $fail"
[ "$fail" -eq 0 ]
