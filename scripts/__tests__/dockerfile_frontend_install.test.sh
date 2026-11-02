#!/usr/bin/env bash
#
# The frontend stage's install must actually resolve (#503).
#
# WHY THIS GUARD EXISTS. v0.51.0 was tagged and released with NO IMAGE. All 14
# checks were green on PR #502 and on its merge, and publish-image then failed
# on `npm ci`:
#
#   Invalid: lock file's dompurify@3.4.16 does not satisfy dompurify@3.4.17
#
# The lockfile was correct. backend/Dockerfile's frontend-builder copied
# frontend/package*.json together with the ROOT package-lock.json and ran
# `npm ci` with NO workspace context. Stripped of that context npm sees only the
# hoisted node_modules/dompurify (3.4.16, jspdf's optionalDependency) and never
# frontend/node_modules/dompurify (3.4.17), because that lock path only applies
# at a workspace root.
#
# That pairing was only ever valid while nothing in the frontend manifest
# conflicted with a hoisted copy. At v0.50.0 the frontend declared no dompurify
# at all. #499 added it as a new direct dependency, and the coincidence that had
# been holding the image build together stopped holding. So the defect is not a
# version drift: ANY new direct frontend dependency whose hoisted copy differs
# breaks the image build.
#
# WHY CI COULD NOT SEE IT. Every test job installs at the workspace root, where
# the lockfile is consistent. Only the image build exercised that manifest/lock
# pairing, so the repo had two definitions of "installable" and CI validated the
# easier one. Tests, typecheck and build are three different gates.
#
# WHY IT DERIVES FROM THE DOCKERFILE instead of restating the fix. A test that
# asserted "the Dockerfile says --workspace" would pass on a Dockerfile whose
# install still could not resolve -- a proposition one step beside the task.
# This replays the stage's OWN copies and its OWN npm ci, so it keeps measuring
# the real install path as that stage changes.
#
# Deps: bash 3.x, node, npm. Exit 0 = all pass.
set -u

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$TEST_DIR/../.." && pwd)"
# Overridable so this suite can prove itself red against a known-broken stage.
DOCKERFILE="${NOMAD_DOCKERFILE:-$REPO_ROOT/backend/Dockerfile}"
STAGE="frontend-builder"

pass=0; fail=0
ok()  { echo "  ok   - $1"; pass=$((pass+1)); }
bad() { echo "  FAIL - $1"; fail=$((fail+1)); }

finish() {
  echo ""
  echo "passed: $pass   failed: $fail"
  [ "$fail" -eq 0 ] || exit 1
  exit 0
}

if [ ! -f "$DOCKERFILE" ]; then
  bad "backend/Dockerfile does not exist"
  finish
fi

# ---- extract the stage, up to and including its npm ci ----------------------
# Join backslash continuations first: `RUN --mount=... \` puts the npm ci on a
# following line, and a single-line match silently finds nothing -- which looks
# exactly like a stage that has no install at all.
stage_lines="$(awk -v stage="$STAGE" '
  $1 == "FROM" { inside = ($0 ~ ("AS[ \t]+" stage "[ \t]*$")) ? 1 : 0; next }
  !inside { next }
  {
    line = $0
    sub(/[ \t]*\\$/, " ", line)
    if ($0 ~ /\\$/) { acc = acc line; next }
    print acc line; acc = ""
  }
  END { if (acc != "") print acc }
' "$DOCKERFILE")"

if [ -z "$stage_lines" ]; then
  bad "no stage named '$STAGE' in backend/Dockerfile"
  finish
fi

npm_ci_cmd="$(printf '%s\n' "$stage_lines" \
  | sed -n 's/^[[:space:]]*RUN[[:space:]][[:space:]]*\(.*npm ci.*\)$/\1/p' | head -1)"

if [ -z "$npm_ci_cmd" ]; then
  bad "stage '$STAGE' has no 'RUN ... npm ci ...' line to exercise"
  finish
fi

# Drop a buildkit cache mount prefix if present; it is not runnable here.
npm_ci_cmd="$(printf '%s' "$npm_ci_cmd" | sed 's/^--mount=[^ ]*[[:space:]]*//')"

# COPY instructions that precede the install are the install's inputs.
copies="$(printf '%s\n' "$stage_lines" \
  | sed -n "1,/RUN[[:space:]][[:space:]]*.*npm ci/p" \
  | sed -n 's/^[[:space:]]*COPY[[:space:]][[:space:]]*\(.*\)$/\1/p')"

if [ -z "$copies" ]; then
  bad "stage '$STAGE' copies nothing before npm ci"
  finish
fi

# ---- replay those copies into a sandbox and run the stage's own npm ci ------
replay_and_install() {
  # $1 = sandbox dir
  local sandbox="$1"
  local line src dst n i
  printf '%s\n' "$copies" | while IFS= read -r line; do
    [ -n "$line" ] || continue
    # shellcheck disable=SC2086
    set -- $line
    n=$#
    eval "dst=\${$n}"
    mkdir -p "$sandbox/$dst" 2>/dev/null || true
    i=1
    while [ "$i" -lt "$n" ]; do
      eval "src=\${$i}"
      # globs are intentional: `frontend/package*.json` is one of them
      for f in $REPO_ROOT/$src; do
        [ -e "$f" ] && cp -R "$f" "$sandbox/$dst" 2>/dev/null
      done
      i=$((i+1))
    done
  done
  ( cd "$sandbox" && eval "$npm_ci_cmd --dry-run" ) 2>&1
}

SANDBOX="$(mktemp -d)"
trap 'rm -rf "$SANDBOX" "${CONTROL:-}"' EXIT

out="$(replay_and_install "$SANDBOX")"
if [ $? -eq 0 ] && ! printf '%s' "$out" | grep -q "EUSAGE"; then
  ok "frontend stage's install resolves: $npm_ci_cmd"
else
  bad "frontend stage's install does NOT resolve -- the image build will fail"
  echo ""
  echo "    command replayed: $npm_ci_cmd --dry-run"
  echo "    copies replayed:"
  printf '%s\n' "$copies" | sed 's/^/      COPY /'
  echo "    npm said:"
  printf '%s\n' "$out" | grep -E "npm error" | head -6 | sed 's/^/      /'
fi

# ---- CONTROL: this instrument must be able to DETECT an unresolvable pair ----
#
# A green run above means nothing unless the same instrument goes red on an
# install that genuinely cannot resolve. The fixture is synthetic rather than
# the historical dompurify pair, so the control keeps detecting even after
# every real version is aligned.
CONTROL="$(mktemp -d)"
cat > "$CONTROL/package.json" <<'JSON'
{ "name": "control", "version": "1.0.0", "dependencies": { "dompurify": "^9999.0.0" } }
JSON
cp "$REPO_ROOT/package-lock.json" "$CONTROL/package-lock.json"
control_out="$( cd "$CONTROL" && npm ci --dry-run 2>&1 )"
if [ $? -ne 0 ] || printf '%s' "$control_out" | grep -q "EUSAGE"; then
  ok "control: an unsatisfiable manifest/lock pair IS rejected (the check can fail)"
else
  bad "control: an unsatisfiable manifest/lock pair was ACCEPTED -- this test cannot detect the defect it exists for"
fi

finish
