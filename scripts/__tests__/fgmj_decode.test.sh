#!/usr/bin/env bash
#
# The vendored WISE protobuf schema must decode our .fgmj fixtures — #294.
#
# The .fgmj is a protobuf JSON serialization. vendor/wise-protos/fgmj_descriptor_set.pb
# is the compiled schema, and tools/fgmj-decode-check.mjs decodes files against it.
# Verified against 40 real files on 2026-09-30; this guards the two that live in
# the repo.
#
# Why this is worth a test rather than a one-off: the decode depends on a
# schema-guided transform for proto3 JSON wrapper types. If that transform
# regresses, or the descriptor set is replaced with an incomplete one (regenerated
# without --include_imports), every import silently loses fields. This catches
# that.
#
# It does NOT skip when protobufjs is missing. A suite that goes quiet when its
# dependency is absent reports success for a check that never ran.
#
# bash 3.x compatible (macOS default).

set -u

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$TEST_DIR/../.."
TOOL="$REPO/tools/fgmj-decode-check.mjs"
DESC="$REPO/vendor/wise-protos/fgmj_descriptor_set.pb"

pass=0; fail=0
ok()  { printf '  ok   - %s\n' "$1"; pass=$((pass+1)); }
bad() { printf '  FAIL - %s\n' "$1"; [ $# -gt 1 ] && printf '         %s\n' "$2"; fail=$((fail+1)); }

echo "fgmj decode against the vendored schema (#294)"

# --- preconditions, each failing loudly ------------------------------------
if [ -f "$DESC" ]; then ok "the descriptor set is present"
else bad "the descriptor set is present" "missing: $DESC"; fi

if [ -f "$TOOL" ]; then ok "the decode tool is present"
else bad "the decode tool is present" "missing: $TOOL"; fi

if [ -d "$REPO/node_modules/protobufjs" ]; then
    ok "protobufjs is installed"
else
    bad "protobufjs is installed" \
        "run 'npm ci --workspaces=false' at the repo root. NOT skipping: a suite that goes quiet when its dependency is missing reports success for a check that never ran."
    echo; echo "passed: $pass   failed: $fail"; exit 1
fi

# --- the fixtures decode ----------------------------------------------------
OUT="$(node "$TOOL" "$REPO/test-data" 2>&1)"
CODE=$?

if [ "$CODE" -eq 0 ]; then ok "every fixture in test-data/ decodes"
else bad "every fixture in test-data/ decodes" "$(printf '%s' "$OUT" | tail -4)"; fi

# Control: the run must actually have decoded something. An empty test-data/
# would otherwise pass the check above for the wrong reason.
case "$OUT" in
    *"0/0 decoded"*) bad "the run decoded at least one file" "0 files found — the check did not exercise anything" ;;
    *decoded*)       ok "the run decoded at least one file" ;;
    *)               bad "the run decoded at least one file" "no decode summary in output" ;;
esac

# The transform must have fired. If wrapper handling regressed to a no-op the
# files would fail, but if the counter stops being reported we lose the signal.
case "$OUT" in
    *"scalars wrapped: 0"*) bad "the proto3 wrapper transform fired" "wrapped 0 scalars; these files contain thousands of wrapper values" ;;
    *"scalars wrapped:"*)   ok "the proto3 wrapper transform fired" ;;
    *)                      bad "the proto3 wrapper transform fired" "no wrap count in output" ;;
esac

# --- the checker must REJECT a broken file ---------------------------------
# Without this, a tool that always exits 0 would satisfy everything above.
TMP="$(mktemp -d)"
printf '{ "project": { "scenarios": { "scenarios": "this should be a list" } } }\n' > "$TMP/broken.fgmj"
if node "$TOOL" "$TMP/broken.fgmj" >/dev/null 2>&1; then
    bad "a malformed fgmj is rejected" "the checker accepted a file whose scenarios is a string"
else
    ok "a malformed fgmj is rejected"
fi
rm -rf "$TMP"

echo
echo "passed: $pass   failed: $fail"
[ "$fail" -eq 0 ]
