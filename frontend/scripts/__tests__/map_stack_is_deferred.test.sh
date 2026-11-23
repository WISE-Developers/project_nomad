#!/usr/bin/env bash
# The library must not pull the map stack onto a consumer's page at import — #567,
# raised from EasyMap 3 #1009.
#
# openNomad imported `maplibre-gl` at module load, so EVERY embedded consumer
# downloaded and evaluated MapLibre even when it never created a Nomad map. That
# pinned EasyMap 3 to `mapbox-gl` 3.31.0 — two map libraries on one page is the
# conflict — and that pin only holds until a Mapbox security fix lands in 3.33+.
#
# THE FIX IS DEFER, NOT REMOVE, and the distinction is the whole issue. MapLibre
# IS needed: `MapContainer` and `OutputPreviewModal` both call `new maplibregl.Map`
# and both are reachable from `DashboardContainer`. So the three modules stay
# REQUIRED peerDependencies (see libExternalsPeerContract.convention.test.ts) and
# are loaded by dynamic `import()` inside the paths that actually create a map.
#
# WHY THIS ASSERTS THE BUILT ARTEFACT AND NOT THE SOURCE: a source-level grep for
# `import * as maplibregl` would pass the moment someone wrote `import type`, while
# a value use elsewhere in the same file kept the runtime import. Only the emitted
# bundle knows what a consumer actually downloads. This is the same reasoning as
# lib_bundle_no_css.test.sh, and the same reason v0.66.0 crash-looped the demo:
# four green gates, none of which ever started what it built.
#
# COST: this builds the library. Like lib_bundle_no_css.test.sh it therefore lives
# here rather than in the root installer suites, and runs in the Frontend CI job,
# which does a full `npm ci`. Asserting a stale dist/ would be worse than not
# asserting at all.
#
# bash 3.x compatible (macOS default). No associative arrays, no mapfile.

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FRONTEND="$SCRIPT_DIR/../.."

passed=0
failed=0
ok()  { printf '  ok   - %s\n' "$1"; passed=$((passed + 1)); }
bad() { printf '  FAIL - %s\n' "$1"; [ $# -gt 1 ] && printf '         %s\n' "$2"; failed=$((failed + 1)); }

echo "the map stack is deferred, not statically imported (#567)"

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
ES="$DIST/openNomad.js"
UMD="$DIST/openNomad.umd.cjs"

# --- controls FIRST, so a dead instrument cannot read as a clean negative -----
# This file's first ancestor scan came back empty for maplibre AND for react, and
# was a broken search rather than a fixed bundle. A negative is worth nothing
# without a known positive from the SAME instrument in the SAME run.
if [ -f "$ES" ] && [ -f "$UMD" ]; then
    ok "control: both library entries were emitted (the build really ran)"
else
    bad "control: both library entries were emitted (the build really ran)" \
        "missing openNomad.js or openNomad.umd.cjs; an absent dist passes every scan below for the wrong reason"
    echo; echo "passed: $passed   failed: $failed"; exit 1
fi

# Count MODULE SPECIFIER occurrences, quote-agnostic and form-agnostic.
#
# An earlier version of this file matched `(from|import) ?"<mod>"`. Codex found
# the hole and I reproduced it: minified output is `import{Map as M}from"..."`,
# so a `}` sits before `from` and the anchored form reports ZERO on a genuinely
# static import. It also missed single quotes entirely. A guard whose spelling
# has to match the minifier's is not a guard.
#
# So: count every QUOTED occurrence of the specifier in any form. The closing
# quote is what keeps `terra-draw` from matching `terra-draw-maplibre-gl-adapter`
# and `maplibre-gl` from matching `maplibre-gl/dist/...`.
spec_refs() { grep -rhoE "['\"]$1['\"]" "$DIST" --include=*.js | wc -l | tr -d ' '; }
umd_requires() { grep -ohE "require\(['\"]$1['\"]\)" "$UMD" | wc -l | tr -d ' '; }

REACT_ES="$(spec_refs react)"
REACT_UMD="$(umd_requires react)"
if [ "$REACT_ES" -gt 0 ] && [ "$REACT_UMD" -gt 0 ]; then
    ok "control: react IS still statically imported (ES $REACT_ES, UMD $REACT_UMD) — both scanners can see a real import"
else
    bad "control: react IS still statically imported" \
        "react found $REACT_ES times in ES and $REACT_UMD in UMD. react is externalised and genuinely required at import, so a zero here means the SCANNER is broken, not that the bundle is clean. Every assertion below is void."
    echo; echo "passed: $passed   failed: $failed"; exit 1
fi

# --- the assertion this issue is about ---------------------------------------
for mod in maplibre-gl terra-draw terra-draw-maplibre-gl-adapter; do
    n_es="$(spec_refs "$mod")"
    if [ "$n_es" -eq 0 ]; then
        ok "ES output carries no reference of ANY form to $mod"
    else
        bad "ES output carries no reference of ANY form to $mod" \
            "found $n_es quoted specifier ref(s). A consumer who never opens a map still downloads it."
    fi

    n_umd="$(umd_requires "$mod")"
    if [ "$n_umd" -eq 0 ]; then
        ok "UMD output has no top-level require of $mod"
    else
        bad "UMD output has no top-level require of $mod" \
            "found $n_umd require(s). The ES entry can be clean while UMD is not — they are separate Rollup outputs."
    fi
done

# --- deferred, not deleted: asserted where the map actually lives -------------
# The library graph does NOT contain MapContainer, OutputPreviewModal,
# LayerProvider or DrawProvider -- measured from the build's own sourcemaps, on
# both sides of this change. Only `useRasterHover` and the old `maplibreWorker`
# were ever in it, and maplibreWorker's MODULE-SCOPE `setWorkerUrl` was the
# import-time cost #567 is actually about.
#
# So "the map stack is still reachable" cannot be asserted against dist/ above:
# there is nothing there to defer. An earlier version of this file asserted
# exactly that, and failed -- on a proposition nobody was testing. A condition
# one step beside the task looks identical to a real one until it fires.
#
# The map lives in the SAN APP build. That is where deferred-vs-deleted is a
# real distinction, so that is where it is checked.
BUILD_LOG="$(mktemp)"
if ( cd "$FRONTEND" && npm run build ) > "$BUILD_LOG" 2>&1; then
    ok "npm run build (SAN app) succeeds"
else
    bad "npm run build (SAN app) succeeds" "$(tail -5 "$BUILD_LOG")"
    rm -f "$BUILD_LOG"
    echo; echo "passed: $passed   failed: $failed"; exit 1
fi
rm -f "$BUILD_LOG"

APP_ASSETS="$FRONTEND/dist/assets"

# Control, in BOTH directions, before any answer below is believed.
if grep -rqs 'Nomad' "$APP_ASSETS"/*.js && ! grep -rqs 'zzz-control-string-that-cannot-exist' "$APP_ASSETS"/*.js; then
    ok "control: the app-bundle scanner finds a known string and not an absent one"
else
    bad "control: the app-bundle scanner finds a known string and not an absent one" \
        "the scanner is not measuring this artefact; every assertion below is void"
    echo; echo "passed: $passed   failed: $failed"; exit 1
fi

# The map components must still BE in the app. Deleting them satisfies every
# absence check in this file, and is the one outcome #567 explicitly rejected.
for marker in nomad-basemap-style nomad-map-view probability-popup raster-probability-popup; do
    if grep -rqs "$marker" "$APP_ASSETS"/*.js; then
        ok "the app still contains the map code that uses '$marker'"
    else
        bad "the app still contains the map code that uses '$marker'" \
            "absent from the app bundle. The map stack was REMOVED, not deferred."
    fi
done

# ...and the app must reach maplibre only through a dynamic import.
# Static is computed as TOTAL minus DYNAMIC rather than matched directly, so no
# assertion depends on guessing how the minifier spelled the import.
chunk_total()   { grep -rhosE "['\"]\./maplibre-gl-[A-Za-z0-9_-]+\.js['\"]" "$1"/*.js | wc -l | tr -d ' '; }
chunk_dynamic() { grep -rhosE "import\([[:space:]]*['\"]\./maplibre-gl-[A-Za-z0-9_-]+\.js['\"][[:space:]]*\)" "$1"/*.js | wc -l | tr -d ' '; }

# CONTROL: prove the static arithmetic FIRES, on a fixture holding one minified
# static import and one dynamic import of the same chunk. The react control
# above only proves the scanner recognises react's emitted spelling -- it cannot
# show that STATIC detection works, which is exactly the hole Codex found here.
CTL_DIR="$(mktemp -d)"
printf 'import{Map as M}from"./maplibre-gl-CTL.js";const l=()=>import("./maplibre-gl-CTL.js");\n' > "$CTL_DIR/ctl.js"
CTL_TOTAL="$(chunk_total "$CTL_DIR")"
CTL_DYN="$(chunk_dynamic "$CTL_DIR")"
CTL_STATIC=$((CTL_TOTAL - CTL_DYN))
rm -rf "$CTL_DIR"
if [ "$CTL_STATIC" -eq 1 ] && [ "$CTL_DYN" -eq 1 ]; then
    ok "control: the scanner detects a MINIFIED static import (static 1, dynamic 1 on a known fixture)"
else
    bad "control: the scanner detects a MINIFIED static import" \
        "fixture with 1 static + 1 dynamic import scored static=$CTL_STATIC dynamic=$CTL_DYN. The scanner cannot see a static import, so the assertion below cannot fail and proves nothing."
    echo; echo "passed: $passed   failed: $failed"; exit 1
fi

APP_TOTAL="$(chunk_total "$APP_ASSETS")"
APP_DYNAMIC="$(chunk_dynamic "$APP_ASSETS")"
APP_STATIC=$((APP_TOTAL - APP_DYNAMIC))
if [ "$APP_DYNAMIC" -gt 0 ]; then
    ok "the app loads maplibre by dynamic import ($APP_DYNAMIC site(s)) — deferred, not removed"
else
    bad "the app loads maplibre by dynamic import" \
        "no dynamic import of a maplibre chunk. Either maplibre was inlined back into a static chunk, or the map was removed."
fi
if [ "$APP_STATIC" -eq 0 ]; then
    ok "the app has no STATIC import of the maplibre chunk"
else
    bad "the app has no STATIC import of the maplibre chunk" \
        "$APP_TOTAL total chunk refs minus $APP_DYNAMIC dynamic = $APP_STATIC static. A static import means first paint pays for maplibre again."
fi

echo
echo "passed: $passed   failed: $failed"
[ "$failed" -eq 0 ]
