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
# 4. REAL HISTORY, not invented strings. Every stable bump main has ever
#    carried must be refused; everything else must release.
# ---------------------------------------------------------------------------
hist_bad=0; hist_n=0
while IFS= read -r subj; do
  [ -n "$subj" ] || continue
  hist_n=$((hist_n+1))
  gate "$subj" && { hist_bad=$((hist_bad+1)); echo "      would release: $subj"; }
done <<< "$(git -C "$REPO" log origin/main --format='%s' -300 2>/dev/null | grep '^chore: release ')"

if [ "$hist_n" -eq 0 ]; then
  bad "found no real 'chore: release' commits to test against — the check never ran"
elif [ "$hist_bad" -eq 0 ]; then
  ok "all $hist_n real stable bumps in main's history are refused"
else
  bad "$hist_bad of $hist_n real stable bumps would have re-triggered a release"
fi

work_bad=0; work_n=0
while IFS= read -r subj; do
  [ -n "$subj" ] || continue
  work_n=$((work_n+1))
  gate "$subj" || { work_bad=$((work_bad+1)); echo "      would skip: $subj"; }
done <<< "$(git -C "$REPO" log origin/main --format='%s' -60 2>/dev/null | grep -v '^chore: release ')"

if [ "$work_n" -eq 0 ]; then
  bad "found no real work commits to test against — the check never ran"
elif [ "$work_bad" -eq 0 ]; then
  ok "all $work_n real non-stable-bump commits in main's history release"
else
  bad "$work_bad of $work_n real commits would have shipped nothing"
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
