#!/usr/bin/env bash
# The library bundle must emit no stylesheet — issue #387, Option A.
#
# `npm run build:lib` emitted dist/openNomad.css: 83 kB, 62 class selectors, all
# `.maplibregl-*`. Map chrome for a map the library never creates. maplibre-gl is
# declared external, LayerContext takes `map` as a PARAMETER, and the only two
# files that call `new maplibregl.Map` — MapContainer.tsx and
# OutputPreviewModal.tsx — are not in the bundle. Rollup dropped their JS and
# kept their stylesheet import.
#
# It was also unreachable: frontend/package.json `exports` has no style entry, so
# a consumer could not import it without a deep path past the public API.
#
# Decision recorded on #387: stop emitting it. Option B (expose it in `exports`)
# was rejected because it would document a stylesheet for UI the library does not
# render.
#
# This asserts the BUILT OUTPUT, not the source. A source-level check ("no
# component imports maplibre css") would pass while a different tree-shaking
# change reintroduced the asset by another route — and inheriting this file as a
# side effect nobody chose is exactly how it arrived.
#
# COST: this builds the library, and that is why it lives HERE rather than in
# the root scripts/__tests__ with the installer suites (#403).
#
# It did live there, and could never pass in CI. The `Installer suites (bash)`
# job installs root dependencies only -- `npm ci --workspaces=false
# --ignore-scripts` -- so vite is absent and `npm run build:lib` fails before
# any assertion runs. It looked green to every developer, because a working
# machine already has frontend/node_modules and usually a dist/. 22/22 locally,
# 21/22 in CI, same commit. That single failure took `All tests` down, and with
# it the required check that gates main.
#
# So it runs in the Frontend job, which does a full `npm ci` and already builds.
# Asserting a stale dist/ would be worse than not asserting, so the build stays
# part of the suite -- it just needs a job that can perform one.
#
# bash 3.x compatible (macOS default).

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FRONTEND="$SCRIPT_DIR/../.."

passed=0
failed=0
ok()   { printf '  ok   - %s\n' "$1"; passed=$((passed + 1)); }
bad()  { printf '  FAIL - %s\n' "$1"; [ $# -gt 1 ] && printf '         %s\n' "$2"; failed=$((failed + 1)); }

echo "library bundle emits no stylesheet (#387)"

if [ ! -d "$FRONTEND" ]; then
    bad "frontend directory exists" "not found at $FRONTEND"
    echo; echo "passed: $passed   failed: $failed"; exit 1
fi

BUILD_LOG="$(mktemp)"
if ( cd "$FRONTEND" && npm run build:lib ) > "$BUILD_LOG" 2>&1; then
    ok "npm run build:lib succeeds"
else
    bad "npm run build:lib succeeds" "$(tail -5 "$BUILD_LOG")"
    rm -f "$BUILD_LOG"
    echo; echo "passed: $passed   failed: $failed"; exit 1
fi
rm -f "$BUILD_LOG"

DIST="$FRONTEND/dist"

# --- the assertion this issue is about --------------------------------------
CSS_FILES="$(find "$DIST" -maxdepth 1 -name '*.css' 2>/dev/null)"
if [ -z "$CSS_FILES" ]; then
    ok "dist/ contains no stylesheet"
else
    bad "dist/ contains no stylesheet" \
        "found: $(echo "$CSS_FILES" | tr '\n' ' ')"
fi

# --- the control: the build genuinely produced the library -------------------
# Without this, deleting the build output entirely would satisfy the test above.
if [ -f "$DIST/openNomad.js" ]; then
    ok "the library JS was emitted (control — the build really ran)"
else
    bad "the library JS was emitted (control — the build really ran)" \
        "dist/openNomad.js missing; an empty dist would pass the CSS check for the wrong reason"
fi

if [ -f "$DIST/openNomad.umd.cjs" ]; then
    ok "the UMD build was emitted (control)"
else
    bad "the UMD build was emitted (control)" "dist/openNomad.umd.cjs missing"
fi

# --- no stylesheet smuggled into a subdirectory ------------------------------
NESTED_CSS="$(find "$DIST" -mindepth 2 -name '*.css' 2>/dev/null)"
if [ -z "$NESTED_CSS" ]; then
    ok "no stylesheet emitted in a dist subdirectory either"
else
    bad "no stylesheet emitted in a dist subdirectory either" \
        "found: $(echo "$NESTED_CSS" | tr '\n' ' ')"
fi

# --- the JS must not inject CSS at runtime instead ---------------------------
# Removing the asset while switching to style injection would move the problem
# rather than fix it, and would be invisible to the checks above.
if grep -qE 'appendChild\([a-zA-Z_$]+\)|createElement\("style"\)|createElement\(.style.\)' "$DIST/openNomad.js" 2>/dev/null; then
    bad "the bundle does not inject styles at runtime" \
        "found a style-injection site in dist/openNomad.js"
else
    ok "the bundle does not inject styles at runtime"
fi

echo
echo "passed: $passed   failed: $failed"
[ "$failed" -eq 0 ]
