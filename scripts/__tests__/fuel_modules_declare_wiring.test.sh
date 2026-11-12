#!/usr/bin/env bash
#
# Every fuel module must state whether it is wired, and the statement must match
# reality IN BOTH DIRECTIONS (#523, #282).
#
# WHAT #523 ACTUALLY FOUND. `buildFuelWarpArgs` has no production caller: it is
# reachable only from its own test. That test is the ONLY one in the repository that
# runs real GDAL binaries against a real GeoTIFF fixture rather than mocking them, so
# anyone auditing GDAL coverage finds a genuine raster round-trip and concludes the
# fuel-reprojection path is verified end to end. It is -- the path simply has no
# callers. #523 asked for the ambiguity to be removed: say in the file that the
# wiring is coming and name the issue that will do it, or delete the code.
#
# Franco chose annotate-and-link (2026-11-12). This test is what stops that choice
# from rotting, and it is deliberately BIDIRECTIONAL:
#
#   no external caller  ->  the file MUST say it is not yet wired, and name #282
#   has external caller ->  the file MUST NOT still say that
#
# A one-directional check would catch today's error and then quietly become
# tomorrow's. The second branch is the valuable half: the moment #282 wires a module
# up, this suite fails on the now-false disclaimer, so removing it is a decision
# somebody makes rather than a line everyone reads past. The same shape is already
# used in #281's splash test, which asserts the WCS source is ABSENT -- an assertion
# written to be deleted on purpose.
#
# WHY THE CONTROL BELOW IS NOT OPTIONAL. This file's whole verdict rests on "does
# anything outside the directory import this module", and that question was measured
# wrongly twice on 2026-11-12 before it was measured right -- both times returning a
# confident 0 for a module that genuinely had callers, because an over-broad path
# exclusion removed them. A detector that answers 0 for everything would mark every
# module unwired and pass this suite completely. So the detector is pointed at a
# module known to be imported across directories, in the same run, and the suite
# fails if that comes back unwired.
#
# Deps: bash 3.x (macOS ships 3.2), grep only. Exit 0 = all pass, 1 = any failure.
set -u

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$TEST_DIR/../.." && pwd)"
SRC="$REPO/backend/src"
FUEL_DIR="$SRC/infrastructure/fuel"

pass=0
fail=0
ok()  { pass=$((pass + 1)); echo "    ok   $1"; }
bad() { fail=$((fail + 1)); echo "  FAIL   $1"; [ $# -gt 1 ] && echo "         $2"; }

[ -d "$FUEL_DIR" ] || { echo "FAIL - no fuel directory at $FUEL_DIR"; exit 1; }

# ---------------------------------------------------------------------------
# The detector. Counts PRODUCTION files outside $2 that IMPORT module $1.
# Tests are excluded on purpose: a test importing the module is exactly the
# situation #523 is about, so counting it would defeat the check.
#
# IT MUST MATCH AN IMPORT STATEMENT, NOT A MENTION. The first version of this
# function matched the bare substring `/<module>` anywhere in a file, and
# promptly reported fuelReproject.ts as WIRED on the strength of this line in
# PerimeterGenerator.ts:
#
#     * `fuel/__tests__/fuelReproject.test.ts` has always done it this way.
#
# A comment naming the module's own TEST FILE. That is the same trap recorded
# against this exact module on 2026-11-10 -- "the one apparent exception is a
# COMMENT naming a test file, not an import" -- rebuilt from scratch in a new
# instrument two days later. Prose about a module is not a dependency on it, and
# a grep for a name cannot tell the difference. The import keyword can.
# ---------------------------------------------------------------------------
external_importers() {
    local module="$1" owning_dir="$2"
    grep -rlE "(from|require\()[[:space:]]*['\"][^'\"]*/${module}(\.js)?['\"]" \
         "$SRC" --include='*.ts' 2>/dev/null \
      | grep -v "^${owning_dir}/" \
      | grep -v '__tests__' \
      | wc -l | tr -d ' '
}

# ---------------------------------------------------------------------------
# CONTROL FIRST. If the detector cannot see a known cross-directory import,
# every verdict below is worthless and the suite must not report them as passes.
# ---------------------------------------------------------------------------
CONTROL_MODULE="FireSTARRInputGenerator"
CONTROL_DIR="$SRC/infrastructure/firestarr"
control_count="$(external_importers "$CONTROL_MODULE" "$CONTROL_DIR")"

if [ "$control_count" -gt 0 ]; then
    ok "control: the importer detector finds $control_count production importer(s) of $CONTROL_MODULE"
else
    echo "  FAIL   control: the importer detector found 0 importers of $CONTROL_MODULE,"
    echo "         which is known to be imported across directories. The detector is broken."
    echo "         Every 'unwired' verdict it would produce below is meaningless, so this"
    echo "         suite refuses to report them."
    exit 1
fi

# ---------------------------------------------------------------------------
# Every fuel module, discovered rather than listed.
# ---------------------------------------------------------------------------
modules=()
for f in "$FUEL_DIR"/*.ts; do
    [ -f "$f" ] || continue
    modules+=("$f")
done

if [ "${#modules[@]}" -lt 2 ]; then
    echo "  FAIL   discovery: expected at least 2 fuel modules, found ${#modules[@]}"
    exit 1
fi
ok "discovery found ${#modules[@]} fuel modules"

for f in "${modules[@]}"; do
    n="$(basename "$f" .ts)"
    callers="$(external_importers "$n" "$FUEL_DIR")"

    # Does the file declare itself unwired?
    if grep -qiE 'not yet wired|no production caller|unwired' "$f"; then
        declares_unwired=1
    else
        declares_unwired=0
    fi
    # Does it name the issue that will wire it?
    if grep -q '#282' "$f"; then names_282=1; else names_282=0; fi

    if [ "$callers" -eq 0 ]; then
        # ---- branch A: genuinely unwired. It must say so, and name #282.
        if [ "$declares_unwired" -eq 1 ] && [ "$names_282" -eq 1 ]; then
            ok "$n.ts has no production caller and says so, naming #282"
        elif [ "$declares_unwired" -eq 1 ]; then
            bad "$n.ts has no production caller and says so, naming #282" \
                "it states it is unwired but never names #282 — the reader cannot find what will wire it"
        else
            bad "$n.ts has no production caller and says so, naming #282" \
                "no production file outside the fuel directory imports it, and the file does not say so (#523)"
        fi
    else
        # ---- branch B: now wired. The disclaimer is false and must go.
        if [ "$declares_unwired" -eq 1 ]; then
            bad "$n.ts is wired, so its 'not yet wired' note must be removed" \
                "$callers production importer(s) exist — #282 has wired this up, so delete the stale disclaimer deliberately"
        else
            ok "$n.ts is wired ($callers production importer(s)) and carries no stale 'unwired' note"
        fi
    fi
done

echo
echo "fuel_modules_declare_wiring: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
