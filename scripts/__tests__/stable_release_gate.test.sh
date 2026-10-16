#!/usr/bin/env bash
#
# The stable release must fire for work arriving on main, and must NOT fire for
# its own version bump (#444).
#
# THE BUG. stable-release.yml guarded on `[release-bot]` appearing anywhere in
# the head commit message. That marker is written by BOTH bots:
#
#   chore: release v0.29.0 [release-bot]   <- the stable bot's own bump. SKIP.
#   chore: dev v0.28.12 [release-bot]      <- dev's bump, arriving via a merge.
#
# A dev -> main merge pushes DEV's history, and dev's tip is usually a bot bump,
# so the guard matched and a sprint's worth of work shipped nothing. Silently:
# no failed check, no red X. PR #443 did exactly this on 2026-10-15.
#
# WHY NOT GUARD ON THE AUTHOR, which the issue offered as the durable fix:
# measured against real history, BOTH bots commit as `github-actions[bot]`, so
# an author guard skips the rebased dev bump just the same. It does not fix the
# bug it was offered for.
#
# WHY A SCRIPT RATHER THAN A YAML EXPRESSION: a job-level `if:` can only be
# checked by reading it. This decision is the difference between shipping and
# silently not shipping, so it is executed against real commit messages instead.
#
# Deps: bash 3.x (macOS default), git. Exit 0 = pass, 1 = fail.
#
# AND THE SAME BUG BIT THIS COMMIT'S PREDECESSOR, which is worth more than the
# fix. 0ff4cc2's message QUOTED the older marker while explaining it, GitHub
# read the quotation as an instruction, and no CI ran for that push at all —
# not a failed run, no run. A marker inside a message, matched where it was
# never meant as an instruction, is precisely #444 wearing different clothes.
#
# So: never write a CI control marker literally in a commit message, even in
# quotation. Describe it instead.
set -u

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$TEST_DIR/../.." && pwd)"
GATE="$REPO/.github/scripts/should-release.sh"
WF="$REPO/.github/workflows/stable-release.yml"

pass=0; fail=0
ok()  { echo "  ok   - $1"; pass=$((pass+1)); }
bad() { echo "  FAIL - $1"; fail=$((fail+1)); }

[ -x "$GATE" ] || [ -f "$GATE" ] || { bad "should-release.sh not found"; echo ""; echo "passed: $pass   failed: $fail"; exit 1; }

# releases? 0 = yes, non-zero = skip
gate() { bash "$GATE" "$1" >/dev/null 2>&1; }

# ---------------------------------------------------------------------------
# 1. THE BUG ITSELF. A dev bump reaching main through a merge must RELEASE.
# ---------------------------------------------------------------------------
gate "chore: dev v0.28.12 [release-bot]" \
  && ok "a dev bump arriving on main RELEASES (this is #444)" \
  || bad "a dev bump still skips the release — #444 is not fixed"

gate "Merge pull request #445 from WISE-Developers/dev" \
  && ok "an ordinary merge commit releases" \
  || bad "a merge commit was refused a release"

gate "#315: the layer panel section, and WMS layers actually reach the map" \
  && ok "a direct push of real work releases" \
  || bad "a work commit was refused a release"

# ---------------------------------------------------------------------------
# 2. LOOP PROTECTION. The stable bot's own bump must NOT release. This is the
#    half that cannot be allowed to regress: getting it wrong does not skip a
#    release, it releases forever.
# ---------------------------------------------------------------------------
gate "chore: release v0.29.0 [release-bot]" \
  && bad "the stable bot's OWN bump would trigger another release — infinite loop" \
  || ok "the stable bot's own bump does NOT release"

# ---------------------------------------------------------------------------
# 3. TIED TO REALITY, not to what this test believes the bot writes. The
#    message is read out of the workflow that writes it, so renaming the commit
#    without updating the gate fails here instead of looping in production.
# ---------------------------------------------------------------------------
raw="$(grep -oE 'git commit -m "[^"]+"' "$WF" | head -1 | sed 's/^git commit -m "//; s/"$//')"
if [ -z "$raw" ]; then
  bad "could not read the stable bot's commit message out of stable-release.yml"
else
  # Substitute a concrete version for the workflow's ${{ }} interpolation.
  real_msg="$(echo "$raw" | sed 's/\${{[^}]*}}/9.9.9/g')"
  echo "  (the workflow commits: $real_msg)"
  gate "$real_msg" \
    && bad "the message stable-release.yml ACTUALLY writes would re-trigger it" \
    || ok "the message stable-release.yml actually writes does not re-trigger it"
fi

# ---------------------------------------------------------------------------
# 4. REAL HISTORY, not invented strings.
#
#    TWO SOURCES, and the fixture is the floor rather than a convenience. CI
#    checks out dev with no origin/main ref, so the live scan found nothing —
#    and this suite FAILED rather than passing with two checks silently not
#    run, which is the behaviour wanted and the reason the fixture exists.
#
#    fixtures/main-commit-subjects.txt holds real subjects captured from
#    origin/main, labelled SKIP (the stable bot's own bumps) and GO. The live
#    scan still runs wherever main's history is reachable, so the fixture going
#    stale cannot hide a regression on new commits.
# ---------------------------------------------------------------------------
FIXTURE="$TEST_DIR/fixtures/main-commit-subjects.txt"

if [ ! -f "$FIXTURE" ]; then
  bad "fixtures/main-commit-subjects.txt is missing — the history checks have no corpus"
else
  fx_bad=0; fx_skip=0; fx_go=0
  while IFS= read -r line; do
    case "$line" in
      SKIP:*)
        fx_skip=$((fx_skip+1))
        gate "${line#SKIP:}" && { fx_bad=$((fx_bad+1)); echo "      would release: ${line#SKIP:}"; }
        ;;
      GO:*)
        fx_go=$((fx_go+1))
        gate "${line#GO:}" || { fx_bad=$((fx_bad+1)); echo "      would skip: ${line#GO:}"; }
        ;;
    esac
  done < "$FIXTURE"

  if [ "$fx_skip" -eq 0 ] || [ "$fx_go" -eq 0 ]; then
    bad "the fixture has no SKIP or no GO rows — it cannot discriminate"
  elif [ "$fx_bad" -eq 0 ]; then
    ok "fixture: $fx_skip real stable bumps refused, $fx_go real commits released"
  else
    bad "$fx_bad of $((fx_skip+fx_go)) real fixture subjects got the wrong answer"
  fi
fi

# The LIVE scan, where main's history is reachable. Reported as not-run rather
# than passed when it is not — an unreachable corpus and a clean one look
# identical, and only one of them is evidence.
if git -C "$REPO" rev-parse --verify --quiet origin/main >/dev/null 2>&1; then
  live_bad=0; live_n=0
  while IFS= read -r subj; do
    [ -n "$subj" ] || continue
    live_n=$((live_n+1))
    case "$subj" in
      "chore: release "*) gate "$subj" && { live_bad=$((live_bad+1)); echo "      would release: $subj"; } ;;
      *)                  gate "$subj" || { live_bad=$((live_bad+1)); echo "      would skip: $subj"; } ;;
    esac
  done <<< "$(git -C "$REPO" log origin/main --format='%s' -300 2>/dev/null)"

  if [ "$live_n" -eq 0 ]; then
    bad "origin/main resolves but yielded no commits"
  elif [ "$live_bad" -eq 0 ]; then
    ok "live history: all $live_n real subjects on origin/main get the right answer"
  else
    bad "$live_bad of $live_n real subjects on origin/main get the wrong answer"
  fi
else
  echo "  n/a  - live history scan: origin/main is not reachable here (fixture covered it)"
fi

# ---------------------------------------------------------------------------
# 5. CONTROL. A check that cannot fail proves nothing. A deliberately broken
#    gate — the ORIGINAL guard — must be caught by section 1.
# ---------------------------------------------------------------------------
BROKEN="$(mktemp)"
cat > "$BROKEN" <<'BROKEN_EOF'
#!/usr/bin/env bash
case "${1:-}" in *"[release-bot]"*) exit 1 ;; *) exit 0 ;; esac
BROKEN_EOF
if bash "$BROKEN" "chore: dev v0.28.12 [release-bot]"; then
  bad "CONTROL FAILED — the original guard passes section 1, so section 1 proves nothing"
else
  ok "control: the original guard is caught by section 1 (it skips a dev bump)"
fi
rm -f "$BROKEN"

# ---------------------------------------------------------------------------
# 6. AN UNREADABLE MESSAGE RELEASES, deliberately asymmetric. A spurious
#    release is visible and recoverable; a silent skip is the bug being fixed.
# ---------------------------------------------------------------------------
gate "" \
  && ok "an empty commit message releases rather than silently skipping" \
  || bad "an empty message skips the release — the failure mode is silence"

echo ""
echo "passed: $pass   failed: $fail"
[ "$fail" -eq 0 ]
