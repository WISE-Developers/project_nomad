#!/usr/bin/env bash
#
# Offline bundle: the application payload (refs #318).
#
# The bundle already carries a Node runtime, a FireSTARR engine, and native
# addons built for the target. This suite covers putting Nomad itself in, which
# has four ways to go quietly wrong.
#
# 1. `npm ci` must not run install scripts.
#
#    Installing normally makes better-sqlite3 and gdal-async build or download
#    binaries for THIS machine. The builder has already fetched verified
#    prebuilds for the TARGET; letting npm overwrite them with the build host's
#    is the precise bug the previous slice existed to prevent, and it would
#    look like a successful build.
#
# 2. devDependencies must not ship.
#
#    Not only size. vitest currently carries a CRITICAL advisory and is a
#    devDependency; it has no business on a field laptop, and it is exactly
#    what a scanner flags when someone eventually scans one of these bundles.
#
# 3. The frontend must be built with `npm run build`, never `build:lib`.
#
#    `build:lib` writes the embeddable library into frontend/dist and overwrites
#    the application build that lives in the same directory. The bundle would
#    then contain a component library where the app should be, and the launcher
#    would serve nothing. This has already cost real time once.
#
# 4. The prebuilt addons must land where each package actually looks.
#
#    better-sqlite3 loads build/Release/better_sqlite3.node; gdal-async uses a
#    node-pre-gyp path of lib/binding/{node_abi}-{platform}-{arch}. Putting a
#    correct binary in the wrong place fails identically to not having it.
#
# Read as text: running it would require a full npm install. Same approach as
# the sibling suites.
#
# Deps: bash 3.x compatible (macOS ships 3.2). Exit 0 = all pass.

set -u

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILDER="$TEST_DIR/../build-offline-bundle.sh"

pass=0
fail=0

ok()  { pass=$((pass + 1)); echo "    ok   $1"; }
bad() { fail=$((fail + 1)); echo "  FAIL   $1"; [ $# -gt 1 ] && echo "         $2"; }

[ -f "$BUILDER" ] || { echo "builder not found at $BUILDER"; exit 1; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

sed -n '/^assemble_app() {/,/^}/p' "$BUILDER" > "$tmp/app.sh"

if [ ! -s "$tmp/app.sh" ]; then
  bad "builder defines assemble_app()" \
      "nothing puts Nomad into the bundle -- the tree has a runtime and an engine but no application"
  echo
  echo "offline_bundle_app: $pass passed, $fail failed"
  exit 1
fi
ok "builder defines assemble_app()"

APP="$(cat "$tmp/app.sh")"

# ---------------------------------------------------------------------------
# 1. Install scripts must be suppressed.
# ---------------------------------------------------------------------------
if echo "$APP" | grep -qE 'npm (ci|install)[^|;&]*--ignore-scripts'; then
  ok "npm install runs with --ignore-scripts"
else
  bad "npm install runs with --ignore-scripts" \
      "without it npm rebuilds the native addons for the BUILD HOST, silently replacing the verified target prebuilds"
fi

# ---------------------------------------------------------------------------
# 2. No devDependencies in the bundle.
# ---------------------------------------------------------------------------
if echo "$APP" | grep -qE 'npm (ci|install)[^|;&]*(--omit=dev|--production)'; then
  ok "npm install omits devDependencies"
else
  bad "npm install omits devDependencies" \
      "vitest carries a CRITICAL advisory and is a devDependency; it must not reach a field laptop"
fi

# ---------------------------------------------------------------------------
# 2b. --omit=dev alone is not enough, and the outcome must be checked.
#
# better-auth lists vitest as an OPTIONAL PEER dependency, and npm resolves
# peers automatically. vitest therefore landed in a production install with
# --omit=dev correctly applied -- the flag was right and the result was still
# wrong. Asserting only that a flag is present is how that got missed once.
# ---------------------------------------------------------------------------
if echo "$APP" | grep -qE 'npm (ci|install)[^|;&]*--omit=peer'; then
  ok "npm install omits peer dependencies"
else
  bad "npm install omits peer dependencies" \
      "vitest arrives as an optional peer of better-auth; --omit=dev does not exclude it"
fi

if echo "$APP" | grep -qE 'node_modules/\$unwanted|leaked'; then
  ok "assemble_app fails if a test/lint package reached the bundle"
else
  bad "assemble_app fails if a test/lint package reached the bundle" \
      "checking the flag is not checking the outcome"
fi

# ---------------------------------------------------------------------------
# 3. The frontend app build, not the embeddable library build.
# ---------------------------------------------------------------------------
if echo "$APP" | grep -qE 'build:lib'; then
  bad "frontend is built with 'npm run build', not 'build:lib'" \
      "build:lib overwrites frontend/dist with the component library, so the bundle would ship no application"
else
  ok "frontend is built with 'npm run build', not 'build:lib'"
fi

if echo "$APP" | grep -qE 'run build'; then
  ok "assemble_app builds the app"
else
  bad "assemble_app builds the app" "no build step; the bundle would contain source, not a runnable app"
fi

# ---------------------------------------------------------------------------
# 4. Addons land where their packages look for them.
# ---------------------------------------------------------------------------
if echo "$APP" | grep -qE 'build/Release'; then
  ok "better-sqlite3 addon is placed at build/Release/"
else
  bad "better-sqlite3 addon is placed at build/Release/" \
      "better-sqlite3 resolves its binary there; elsewhere is the same as absent"
fi

if echo "$APP" | grep -qE 'lib/binding'; then
  ok "gdal-async addon is placed under lib/binding/"
else
  bad "gdal-async addon is placed under lib/binding/" \
      "node-pre-gyp resolves {node_abi}-{platform}-{arch} under lib/binding/"
fi

# The binding directory must be composed from the target's ABI and platform,
# never written literally -- the same stale-constant trap as the ABI itself.
if echo "$APP" | grep -qE 'lib/binding/node-v1[0-9][0-9]-'; then
  bad "the gdal-async binding path is composed, not hardcoded" \
      "a literal ABI in the path goes stale the moment NODE_VERSION moves major"
else
  ok "the gdal-async binding path is composed, not hardcoded"
fi

# ---------------------------------------------------------------------------
# Placing a file is not proof it is there. Check afterwards, fatally.
# ---------------------------------------------------------------------------
if echo "$APP" | grep -qE '\[ -f .*\.node.*\]|die .*\.node'; then
  ok "assemble_app fails if an addon is not in place afterwards"
else
  bad "assemble_app fails if an addon is not in place afterwards" \
      "an unchecked copy means a missing addon surfaces on the practitioner's laptop, not here"
fi

# ---------------------------------------------------------------------------
# The incomplete marker must go once the payload is real, or it is noise.
# ---------------------------------------------------------------------------
if grep -qE 'rm -f .*BUNDLE_INCOMPLETE|BUNDLE_INCOMPLETE.*removed' "$BUILDER"; then
  ok "BUNDLE_INCOMPLETE.txt is cleared once the payload is assembled"
else
  bad "BUNDLE_INCOMPLETE.txt is cleared once the payload is assembled" \
      "a warning that is always present stops being read"
fi

echo
echo "offline_bundle_app: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
