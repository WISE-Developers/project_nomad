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

es_static_refs() { grep -rhoE "(from|import) ?\"$1\"" "$DIST" --include=*.js | wc -l | tr -d ' '; }
umd_requires()   { grep -ohE "require\(\"$1\")" "$UMD" | wc -l | tr -d ' '; }

REACT_ES="$(es_static_refs react)"
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
    n_es="$(es_static_refs "$mod")"
    if [ "$n_es" -eq 0 ]; then
        ok "ES output has no static import of $mod"
    else
        bad "ES output has no static import of $mod" \
            "found $n_es static ref(s). A consumer who never opens a map still downloads it."
    fi

    n_umd="$(umd_requires "$mod")"
    if [ "$n_umd" -eq 0 ]; then
        ok "UMD output has no top-level require of $mod"
    else
        bad "UMD output has no top-level require of $mod" \
            "found $n_umd require(s). The ES entry can be clean while UMD is not — they are separate Rollup outputs."
    fi
done

# --- deferred, not deleted ---------------------------------------------------
# Without this, DELETING the map features entirely would satisfy everything above.
# That would be the one outcome #567 explicitly rejected.
DYN="$(grep -rhoE 'import\("maplibre-gl"\)|import\("terra-draw"\)|import\("terra-draw-maplibre-gl-adapter"\)' "$DIST" --include=*.js | wc -l | tr -d ' ')"
if [ "$DYN" -gt 0 ]; then
    ok "the map stack is still reachable by dynamic import ($DYN site(s)) — deferred, not removed"
else
    bad "the map stack is still reachable by dynamic import" \
        "zero dynamic import() sites for the three modules. The static imports may be gone because the map features were REMOVED, which is not the fix #567 asked for: MapContainer and OutputPreviewModal must still be able to create a map."
fi

echo
echo "passed: $passed   failed: $failed"
[ "$failed" -eq 0 ]
