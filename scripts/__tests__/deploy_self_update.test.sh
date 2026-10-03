#!/usr/bin/env bash
#
# deploy.sh must run the version of itself that it just pulled.
#
# A shell reads a script as it executes it, so the pull happens after the
# running copy is already in memory. Any change to deploy.sh therefore takes
# effect on the NEXT deploy, not the one that delivers it.
#
# That is not theoretical. The v0.23.0 deploy shipped a fix to the health check
# and still printed the old failure, because the shell was running the v0.22.0
# copy while installing the new one. It looked exactly like a fix that did not
# work, and nearly got diagnosed as one.
#
# Worse than the confusion: a deploy can run half of one version of this script
# and half of another, which is the class of thing deploy.sh exists to prevent.
#
# Deps: bash 3.x, grep. Exit 0 = all pass, 1 = any failure.
set -u

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY="$TEST_DIR/../deploy.sh"
[ -f "$DEPLOY" ] || { echo "deploy.sh not found at $DEPLOY"; exit 1; }

pass=0; fail=0
ok()  { echo "  ok   - $1"; pass=$((pass+1)); }
bad() { echo "  FAIL - $1"; fail=$((fail+1)); }

# 1. It must re-exec after the pull.
if grep -qE '^[[:space:]]*exec[[:space:]]+"?\$' "$DEPLOY" || grep -q 'exec .*BASH_SOURCE' "$DEPLOY"; then
  ok "re-execs itself"
else
  bad "deploy.sh never re-execs, so a change to it cannot apply on its own deploy"
fi

# 2. It must only re-exec when the script ACTUALLY changed. Re-running
#    unconditionally doubles every deploy's git and docker work.
if grep -qE 'git diff .*(deploy\.sh|SCRIPT)|hash_before|script_changed|sha_before' "$DEPLOY"; then
  ok "re-execs only when the script itself changed"
else
  bad "no check that the script changed — an unconditional re-exec repeats the whole deploy"
fi

# 3. It must not be able to loop. A re-exec that can re-exec again is a fork
#    bomb against a production host.
if grep -qE 'NOMAD_DEPLOY_REEXEC|DEPLOY_REEXECED|ALREADY_REEXEC' "$DEPLOY"; then
  ok "guards against re-execing more than once"
else
  bad "no re-exec guard — this can loop forever on a production host"
fi

# 4. The guard must be EXPORTED, or the child will not see it and will loop.
if grep -qE '^[[:space:]]*export [A-Z_]*REEXEC' "$DEPLOY"; then
  ok "exports the guard so the re-executed copy sees it"
else
  bad "guard is not exported — the child process cannot see it and will loop"
fi

# 5. Arguments must survive, or --dry-run silently becomes a real deploy.
if grep -qE 'exec .*"\$@"' "$DEPLOY"; then
  ok "passes the original arguments through"
else
  bad "arguments dropped on re-exec — --dry-run would become a real deploy"
fi

# 6. If hashing is unavailable the check cannot run — that must be SAID, not
#    skipped quietly. A silently disabled mechanism leaves the next person
#    debugging "my fix did nothing" with no hint it was never active.
if grep -q 'self-update check skipped' "$DEPLOY"; then
  ok "says so when it cannot hash the script, instead of skipping silently"
else
  bad "no warning when hashing is unavailable — the check would be silently dead"
fi

echo ""
echo "passed: $pass   failed: $fail"
[ "$fail" -eq 0 ]
