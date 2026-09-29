#!/usr/bin/env bash
# Tests for scripts/assert-prod-tree-clean.mjs — issue #389.
#
# The guard reads a package-lock.json, collects every package the lockfile marks
# `dev` or `devOptional`, and fails if any exists in the node_modules tree next
# to it.
#
# Why derived rather than a named list: the Dockerfile previously asserted the
# absence of six packages chosen because someone had looked for them. The class
# is larger than the list, so #382 "fixed" it and vite survived. A guard built
# from the lockfile cannot go stale as dependencies change.
#
# CONTRACT, so that "rejected the input" is distinguishable from "blew up":
#
#   exit 0  tree is clean          stdout contains  PROD TREE CLEAN
#   exit 1  dev packages present   stdout names every offender, and DIRTY
#   exit 2  bad input              stdout contains  GUARD INPUT ERROR
#
# An earlier version of this file asserted only "exit != 0" on the negative
# cases. Those assertions passed while the guard did not exist at all, because a
# missing module also exits non-zero — they would equally have passed for a
# guard that crashed on every input. Every negative case below now asserts the
# exit CODE and the OUTPUT, so a crash fails the test instead of satisfying it.
#
# bash 3.x compatible (macOS default) — no associative arrays, no mapfile.

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
GUARD="$SCRIPT_DIR/../assert-prod-tree-clean.mjs"

passed=0
failed=0

ok()   { printf '  ok   - %s\n' "$1"; passed=$((passed + 1)); }
fail() { printf '  FAIL - %s\n' "$1"; failed=$((failed + 1)); }

# run_guard <dir>  -> sets GUARD_OUT and GUARD_CODE
run_guard() {
    GUARD_OUT="$(node "$GUARD" "$1" 2>&1)"
    GUARD_CODE=$?
}

# expect <label> <wanted-code> <must-contain> [<must-also-contain>...]
expect() {
    local label="$1" want="$2"; shift 2
    if [ "$GUARD_CODE" != "$want" ]; then
        fail "$label (wanted exit $want, got $GUARD_CODE: $(printf '%s' "$GUARD_OUT" | head -1))"
        return
    fi
    local needle
    for needle in "$@"; do
        case "$GUARD_OUT" in
            *"$needle"*) ;;
            *) fail "$label (exit $want ok, but output lacked '$needle')"; return ;;
        esac
    done
    ok "$label"
}

make_tree() {
    local dir lock
    dir="$(mktemp -d)"
    lock="$1"; shift
    printf '%s' "$lock" > "$dir/package-lock.json"
    mkdir -p "$dir/node_modules"
    for p in "$@"; do mkdir -p "$dir/node_modules/$p"; done
    echo "$dir"
}

LOCK_BASIC='{
  "lockfileVersion": 3,
  "packages": {
    "": { "name": "root" },
    "node_modules/express":    { "version": "4.0.0" },
    "node_modules/typescript": { "version": "5.9.3", "dev": true },
    "node_modules/vite":       { "version": "6.4.3", "devOptional": true },
    "node_modules/rollup":     { "version": "4.63.5", "devOptional": true }
  }
}'

echo "assert-prod-tree-clean.mjs"

# --- precondition: the guard must exist ---------------------------------------
# Without this, every "should fail" case below could pass on a missing file.
if [ -f "$GUARD" ]; then
    ok "the guard script exists"
else
    fail "the guard script exists (not found at $GUARD)"
fi

# --- a clean tree passes, and says so ----------------------------------------
d="$(make_tree "$LOCK_BASIC" express)"
run_guard "$d"
expect "passes when only runtime packages are present" 0 "PROD TREE CLEAN"
rm -rf "$d"

# --- a devOptional package is rejected, by name ------------------------------
d="$(make_tree "$LOCK_BASIC" express vite)"
run_guard "$d"
expect "rejects a devOptional package, naming it" 1 "DIRTY" "vite"
rm -rf "$d"

# --- a plain dev package is rejected, by name -------------------------------
d="$(make_tree "$LOCK_BASIC" express typescript)"
run_guard "$d"
expect "rejects a dev package, naming it" 1 "DIRTY" "typescript"
rm -rf "$d"

# --- every offender is named, not just the first ----------------------------
d="$(make_tree "$LOCK_BASIC" express vite rollup)"
run_guard "$d"
expect "names every offender, not just the first" 1 "vite" "rollup"
rm -rf "$d"

# --- a clean tree must not be called dirty ----------------------------------
# Guards against the opposite failure: a guard that always reports DIRTY would
# satisfy every negative case above.
d="$(make_tree "$LOCK_BASIC" express)"
run_guard "$d"
case "$GUARD_OUT" in
    *DIRTY*) fail "does not report DIRTY for a clean tree" ;;
    *) ok "does not report DIRTY for a clean tree" ;;
esac
rm -rf "$d"

# --- scoped packages are handled --------------------------------------------
LOCK_SCOPED='{
  "lockfileVersion": 3,
  "packages": {
    "": { "name": "root" },
    "node_modules/@vitest/spy": { "version": "4.1.11", "devOptional": true },
    "node_modules/express":     { "version": "4.0.0" }
  }
}'
d="$(make_tree "$LOCK_SCOPED" express "@vitest/spy")"
run_guard "$d"
expect "rejects a scoped devOptional package, naming it" 1 "DIRTY" "@vitest/spy"
rm -rf "$d"

# --- nested entries are not top-level claims --------------------------------
# node_modules/foo/node_modules/vite is nested inside foo; it is not a hoisted
# top-level vite, and must not be reported as one.
LOCK_NESTED='{
  "lockfileVersion": 3,
  "packages": {
    "": { "name": "root" },
    "node_modules/foo": { "version": "1.0.0" },
    "node_modules/foo/node_modules/vite": { "version": "6.4.3", "devOptional": true },
    "node_modules/express": { "version": "4.0.0" }
  }
}'
d="$(make_tree "$LOCK_NESTED" express foo)"
run_guard "$d"
expect "does not false-positive on a nested lockfile entry" 0 "PROD TREE CLEAN"
rm -rf "$d"

# --- bad input is its own outcome, distinct from a violation ----------------
d="$(mktemp -d)"; mkdir -p "$d/node_modules"
run_guard "$d"
expect "reports input error (exit 2) when the lockfile is missing" 2 "GUARD INPUT ERROR"
rm -rf "$d"

d="$(mktemp -d)"; printf '%s' "$LOCK_BASIC" > "$d/package-lock.json"
run_guard "$d"
expect "reports input error (exit 2) when node_modules is missing" 2 "GUARD INPUT ERROR"
rm -rf "$d"

d="$(mktemp -d)"; mkdir -p "$d/node_modules"; printf 'not json' > "$d/package-lock.json"
run_guard "$d"
expect "reports input error (exit 2) on an unparseable lockfile" 2 "GUARD INPUT ERROR"
rm -rf "$d"

echo
echo "passed: $passed   failed: $failed"
[ "$failed" -eq 0 ]
