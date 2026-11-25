#!/usr/bin/env bash
#
# Every function `deploy.sh` defines must be defined AT TOP LEVEL, and every
# function `main` calls must exist by the time `main` runs.
#
# WHY THIS EXISTS. v0.70.0 shipped a `deploy.sh` that could not deploy. #572's
# four helpers — `env_value`, `sqlite_query`, `ignore_jobs_override` and
# `preflight_jobs` — were inserted into the MIDDLE of `main`'s body, splitting it
# in two, because the brace that should have closed `main` before them was never
# added. A function defined inside a function is only created when the OUTER
# function runs, so `main` reached its call to `preflight_jobs` at line 481 while
# the definition sat at line 564 inside its own body:
#
#     /opt/nomad-app/scripts/deploy.sh: line 481: preflight_jobs: command not found
#
# Every deploy exited there. It failed closed, before anything was tagged or
# recreated, so nothing broke — but no box could upgrade.
#
# WHY NOTHING CAUGHT IT, which is the part worth engineering against:
#
#   - `bash -n` passes. A nested function definition is valid bash.
#   - The installer suites passed. They EXTRACT each function with
#     `sed -n '/^name() {/,/^}/p'` and source the fragment. The nested
#     definitions still begin at column 0 and still end with `^}`, so extraction
#     found them exactly as before. The suites exercised the FUNCTIONS and never
#     the FILE.
#   - No suite ran `deploy.sh`. `deploy_self_update.test.sh` is greps over the
#     source; nothing executed a successful `--dry-run`.
#
# So this test deliberately does the one thing none of them did: it sources the
# REAL FILE with only its entry point removed, and asks bash what exists.
#
# THE INVARIANT IS DELIBERATELY BROADER THAN THE BUG. It is not "preflight_jobs
# must be defined" — that would be a test of one symptom. It is "every function
# this file defines is reachable after sourcing it", which catches the next
# helper dropped into the wrong brace as well as this one.
#
# Deps: bash 3.x, grep, sed, awk. Exit 0 = all pass, 1 = any failure.
set -u

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPTS="$TEST_DIR/.."
DEPLOY="$SCRIPTS/deploy.sh"
[ -f "$DEPLOY" ] || { echo "deploy.sh not found at $DEPLOY"; exit 1; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

pass=0; fail=0
ok()  { echo "  ok   - $1"; pass=$((pass+1)); }
bad() { echo "  FAIL - $1"; [ -n "${2:-}" ] && echo "         $2"; fail=$((fail+1)); }

# ---- build the probe: the real file, entry point stubbed ---------------------
#
# Sourcing the file unchanged would RUN a deploy. Removing the `main "$@"` call
# is the smallest possible edit that makes the file inert while leaving every
# definition and every brace exactly where it is.
probe="$tmp/probe.sh"
sed 's/^main "\$@"[[:space:]]*$/: # entry point stubbed by the test/' "$DEPLOY" > "$probe"

echo "the probe is the real file with only its entry point removed"

if grep -q 'entry point stubbed by the test' "$probe"; then
    ok "the stub was applied"
else
    bad "the stub was NOT applied" "no 'main \"\$@\"' line matched; this test would prove nothing"
fi

if grep -qE '^main "\$@"' "$probe"; then
    bad "the entry point is still being called" "sourcing the probe would run a deploy"
else
    ok "the entry point is not called by the probe"
fi

# Nothing else may differ. A probe that drifted from the file would be testing a
# different program than the one that ships.
if [ "$(grep -cv '^$' "$DEPLOY")" = "$(grep -cv '^$' "$probe")" ]; then
    ok "the probe has the same line count as deploy.sh (only the call was swapped)"
else
    bad "the probe differs from deploy.sh by more than the entry point"
fi

# ---- the question: what does bash think is defined? -------------------------
#
# `set --` before sourcing is load-bearing. `source` hands the caller's
# positional parameters to the sourced file, and deploy.sh parses arguments at
# TOP LEVEL (#575) — so passing the probe path through as $1 made its own
# argument loop reject it and exit, and NOTHING was defined. The control caught
# that: it reported a known-good function as missing, which is the shape of a
# broken instrument rather than a broken file.
is_defined() {
    bash -c 'f="$1"; fn="$2"; set --; source "$f" >/dev/null 2>&1; declare -F "$fn" >/dev/null 2>&1' \
        _ "$probe" "$1"
}

echo
echo "controls"

# Without these three, a green run below means nothing: the sourcing could have
# failed outright, or `declare -F` could be answering yes to everything.
if is_defined print_error; then
    ok "control: a known top-level function IS defined, so sourcing works"
else
    bad "control: sourcing the probe defines nothing at all" \
        "the file may not be sourceable; every result below is meaningless"
fi

if is_defined zz_definitely_not_a_function_in_deploy_sh; then
    bad "control: declare -F claims a nonexistent function is defined" \
        "the instrument does not discriminate"
else
    ok "control: a nonexistent function is NOT defined, so declare -F discriminates"
fi

all_names="$(grep -oE '^[a-z_][a-z_0-9]*\(\)' "$DEPLOY" | sed 's/()$//' | sort -u)"
name_count="$(printf '%s\n' "$all_names" | grep -c .)"
if [ "$name_count" -ge 10 ]; then
    ok "control: found $name_count function definitions to check"
else
    bad "control: only found $name_count function definitions" \
        "the derivation is broken, so an empty loop would pass silently"
fi

# ---- 1. every function the file defines must be defined after sourcing ------
echo
echo "every function deploy.sh defines is reachable after sourcing it"

nested=""
for fn in $all_names; do
    if is_defined "$fn"; then
        :
    else
        nested="$nested $fn"
    fi
done

if [ -z "$nested" ]; then
    ok "all $name_count functions are defined at top level"
else
    bad "these functions are NOT defined at top level:$nested" \
        "they are nested inside another function's body, so they do not exist until that function runs"
fi

# ---- 2. every function main CALLS must exist when main runs -----------------
#
# Narrower and more direct: these are the calls that abort a real deploy.
echo
echo "every function main calls is defined before main runs"

# main's body, by brace depth, so a nested definition cannot confuse the end.
awk '
  /^main\(\) \{/ { inmain=1 }
  inmain {
    n=gsub(/\{/,"{"); m=gsub(/\}/,"}"); depth+=n-m
    print
    if (depth==0) exit
  }
' "$DEPLOY" > "$tmp/main_body.sh"

body_lines="$(grep -c . "$tmp/main_body.sh")"
if [ "$body_lines" -ge 50 ]; then
    ok "control: extracted main's body ($body_lines lines)"
else
    bad "control: main's body came out as $body_lines lines" "the extraction is wrong"
fi

called=""
for fn in $all_names; do
    [ "$fn" = "main" ] && continue
    # A call is the name at the start of a command, not inside a word.
    if grep -qE "(^|[^a-zA-Z0-9_])${fn}([[:space:]]|$)" "$tmp/main_body.sh"; then
        called="$called $fn"
    fi
done

called_count="$(printf '%s' "$called" | wc -w | tr -d ' ')"
if [ "$called_count" -ge 3 ]; then
    ok "control: main calls $called_count of this file's functions"
else
    bad "control: main appears to call $called_count functions" "the derivation found too few to be real"
fi

missing=""
for fn in $called; do
    is_defined "$fn" || missing="$missing $fn"
done

if [ -z "$missing" ]; then
    ok "all $called_count functions main calls are defined when main runs"
else
    bad "main calls functions that do not exist when it runs:$missing" \
        "a real deploy aborts with 'command not found' on the first of these"
fi

echo
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ] || exit 1
