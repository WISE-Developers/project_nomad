#!/usr/bin/env bash
#
# Every key a release ADDS must be documented in upgrading.md, and the constants
# upgrading.md quotes must match the source (#526).
#
# WHY THIS EXISTS. v0.55.0 shipped two new subsystems and eight new `.env` keys, and
# `Documentation/Nomad/upgrading.md` mentioned none of them. Nothing was broken — every
# key is optional and both gates default off — but an operator wanting to ENABLE one had
# to read TypeScript to find the port, the key length and the must-be-mounted constraint.
# The gap was found by working the deploy checklist, not by anything automatic.
#
# THE SHARPER REASON. This file documents BEHAVIOUR and quotes NUMBERS: a 32-character
# minimum key length and a main port of 3001. Both are constants in the backend. When one
# moves, the doc becomes confidently wrong — and operator-facing documentation that is
# wrong is worse than documentation that is absent, because it is believed and acted on.
# A document is only checked if something checks it.
#
# SCOPE, deliberately narrow. This asserts COVERAGE and CONSTANTS, not prose quality. It
# cannot tell whether an explanation is any good; it can tell whether a key exists with
# nothing written about it anywhere, and whether a number in the prose still matches the
# code it describes. Those are the two failures that actually happened.
#
# Deps: bash 3.x (macOS default). Exit 0 = pass, 1 = fail.
set -u

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$TEST_DIR/../.." && pwd)"
DOC="$REPO/Documentation/Nomad/upgrading.md"
EXAMPLE="$REPO/.env.example"
AUTH="$REPO/backend/src/mcp/auth.ts"
LISTENER="$REPO/backend/src/mcp/listener.ts"

pass=0; fail=0
ok()  { echo "  ok   - $1"; pass=$((pass+1)); }
bad() { echo "  FAIL - $1"; fail=$((fail+1)); }

for f in "$DOC" "$EXAMPLE" "$AUTH" "$LISTENER"; do
  [ -f "$f" ] || { bad "not found: $f"; echo ""; echo "passed: $pass   failed: $fail"; exit 1; }
done

# ---------------------------------------------------------------------------
# 1. COVERAGE OF WHAT IS NEW. A key ADDED since the last release must appear in
#    upgrading.md.
#
#    THE FIRST DRAFT OF THIS SECTION WAS WRONG AND IS WORTH RECORDING. It demanded
#    that EVERY key in .env.example be documented here, and reported 38 failures —
#    NODE_ENV, the OAuth client ids, the DB pool sizes. None of those is a defect.
#    `upgrading.md` is a per-release upgrade note, not a key reference: its job is to
#    tell an operator what CHANGED. The assertion was testing a true-sounding
#    proposition one step beside the task, and it would have forced 38 lines of
#    documentation nobody asked for to turn it green.
#
#    Scoped against the previous release tag instead, so it fires exactly when a
#    release adds a key and says nothing about it.
# ---------------------------------------------------------------------------
PREV_TAG="$(git -C "$REPO" tag --list 'v*' --sort=-version:refname \
            | grep -E '^v[0-9]+\.[0-9]+\.0$' | sed -n 2p)"

if [ -z "$PREV_TAG" ] || ! git -C "$REPO" rev-parse -q --verify "refs/tags/$PREV_TAG" >/dev/null; then
  # An unreachable baseline and a clean one look identical. Say which this is.
  echo "  n/a  - no previous release tag reachable; new-key coverage not checked"
else
  now="$(awk -F= '/^[A-Za-z_][A-Za-z0-9_]*=/{print $1}' "$EXAMPLE" | sort -u)"
  was="$(git -C "$REPO" show "$PREV_TAG:.env.example" 2>/dev/null \
         | awk -F= '/^[A-Za-z_][A-Za-z0-9_]*=/{print $1}' | sort -u)"
  cnow="$(echo "$now" | grep -c .)"; cwas="$(echo "$was" | grep -c .)"

  # INPUT GUARD. A tag that does not resolve yields an empty side, and `comm` then
  # faithfully reports every key as new — which on 2026-11-02 read as 44 deletions.
  if [ "$cnow" -eq 0 ] || [ "$cwas" -eq 0 ]; then
    bad "an input is empty (now=$cnow was=$cwas) — the comparison would be a lie, not a pass"
  else
    added="$(comm -13 <(echo "$was") <(echo "$now"))"
    if [ -z "$added" ]; then
      ok "no keys added since $PREV_TAG ($cwas -> $cnow), nothing to document"
    else
      missing=""
      for k in $added; do
        grep -q "\b$k\b" "$DOC" || missing="$missing $k"
      done
      if [ -n "$missing" ]; then
        bad "keys added since $PREV_TAG with no mention in upgrading.md:"
        for k in $missing; do echo "        $k"; done
      else
        ok "every key added since $PREV_TAG ($(echo "$added" | grep -c .) of them) is documented"
      fi
    fi
  fi
fi

# CONTROL for section 1. The loop above can only mean something if the same predicate
# reports a MISS for a key that genuinely is not in the document. Invent one.
if grep -q "\bNOMAD_THIS_KEY_DOES_NOT_EXIST\b" "$DOC"; then
  bad "CONTROL FAILED — the detector claims to find a key that cannot be there"
else
  ok "control: the detector reports a miss for a key that does not exist"
fi

# And a positive control: a key that IS unambiguously documented must be found, or
# section 1's silence could just mean the grep never matches anything.
if grep -q "\bNOMAD_HOME_TIMEZONE\b" "$DOC"; then
  ok "control: the detector finds a key known to be documented"
else
  bad "CONTROL FAILED — a long-documented key is not found, so section 1 proves nothing"
fi

# ---------------------------------------------------------------------------
# 2. CONSTANTS. The numbers the prose quotes must still be the numbers the code
#    enforces. These are read from the source, never retyped here.
# ---------------------------------------------------------------------------
min_key="$(sed -nE "s/.*MIN_KEY_LENGTH[[:space:]]*=[[:space:]]*([0-9]+).*/\1/p" "$AUTH" | head -1)"
main_port="$(sed -nE 's/.*DEFAULT_MAIN_PORT[[:space:]]*=[[:space:]]*([0-9]+).*/\1/p' "$LISTENER" | head -1)"

if [ -z "$min_key" ]; then
  bad "could not read MIN_KEY_LENGTH from mcp/auth.ts — the check cannot run, which is not a pass"
elif grep -q "$min_key-character\|Minimum $min_key characters\|minimum $min_key" "$DOC"; then
  ok "upgrading.md quotes the real MIN_KEY_LENGTH ($min_key)"
else
  bad "upgrading.md does not quote the source's MIN_KEY_LENGTH ($min_key) — the documented floor has drifted"
fi

if [ -z "$main_port" ]; then
  bad "could not read DEFAULT_MAIN_PORT from mcp/listener.ts — the check cannot run, which is not a pass"
elif grep -q "\b$main_port\b" "$DOC"; then
  ok "upgrading.md quotes the real DEFAULT_MAIN_PORT ($main_port)"
else
  bad "upgrading.md does not quote the source's DEFAULT_MAIN_PORT ($main_port) — the documented port has drifted"
fi

# ---------------------------------------------------------------------------
# 3. THE NO-FALLBACK PROPERTY, which is the one an operator must not misread.
#    fuelSource.ts refuses rather than defaulting, in both directions. If that
#    design ever changes, this document must not keep promising it.
# ---------------------------------------------------------------------------
FUEL="$REPO/backend/src/infrastructure/fuel/fuelSource.ts"
if [ -f "$FUEL" ]; then
  if grep -qi "no fallback\|NO fallback" "$FUEL" && grep -qi "no fallback" "$DOC"; then
    ok "source and doc agree that there is no fallback between fuel sources"
  elif grep -qi "no fallback" "$DOC"; then
    bad "upgrading.md promises no fallback between fuel sources, but fuelSource.ts no longer says so"
  else
    bad "upgrading.md does not state the no-fallback property an operator must not misread"
  fi
else
  bad "fuelSource.ts not found — cannot confirm the property the doc describes"
fi

echo ""
echo "passed: $pass   failed: $fail"
[ "$fail" -eq 0 ]
