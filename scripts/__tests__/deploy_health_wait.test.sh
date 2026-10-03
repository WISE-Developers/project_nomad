#!/usr/bin/env bash
#
# deploy.sh must wait for the backend to answer, not ask once and give up.
#
# Every healthy deploy of v0.21.0 to the CIFFC demo ended on
# "[WARN] Could not read /api/v1/info — check 'docker logs nomad'". Nothing was
# wrong: the script slept 10s, asked once, and the backend was still running
# migrations. It answered correctly about twenty seconds later.
#
# A warning that fires on every successful deploy is worse than no warning. It
# trains whoever is deploying to ignore the one time it means something, and it
# makes a real failure indistinguishable from a slow boot.
#
# Deps: bash 3.x, sed, grep. Exit 0 = all pass, 1 = any failure.
set -u

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY="$TEST_DIR/../deploy.sh"
[ -f "$DEPLOY" ] || { echo "deploy.sh not found at $DEPLOY"; exit 1; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

pass=0; fail=0
ok()   { echo "  ok   - $1"; pass=$((pass+1)); }
bad()  { echo "  FAIL - $1"; fail=$((fail+1)); }

sed -n '/^await_version() {/,/^}/p' "$DEPLOY" > "$tmp/fn.sh"
if [ ! -s "$tmp/fn.sh" ]; then
  echo "  FAIL - deploy.sh defines no await_version() to test"
  echo ""
  echo "passed: 0   failed: 1"
  exit 1
fi

# Harness: curl succeeds only after $READY_AFTER calls. sleep is a no-op so the
# test does not actually wait. Call count survives in a file, not a variable,
# because the stub runs in a subshell.
make_harness() {
  cat > "$tmp/harness.sh" <<EOF
set -u
COUNTER="$tmp/calls"
: > "\$COUNTER"
READY_AFTER=\${READY_AFTER:-3}
curl() {
  n=\$(( \$(wc -c < "\$COUNTER") + 1 ))
  printf 'x' >> "\$COUNTER"
  # Record the URL asked for, so a malformed one is visible to the test.
  for a in "\$@"; do case "\$a" in http*|localhost*) echo "\$a" > "$tmp/url";; esac; done
  if [ "\$n" -ge "\$READY_AFTER" ]; then
    echo '{"name":"Project Nomad","version":"0.21.0","environment":"production"}'
    return 0
  fi
  return 7
}
sleep() { :; }
. "$tmp/fn.sh"
EOF
}
make_harness

# 1. The real case: backend answers on the 3rd attempt, as it does in production.
out="$(READY_AFTER=3 bash -c '. '"$tmp"'/harness.sh; await_version 3001 60' 2>&1)"
rc=$?
if [ $rc -eq 0 ] && echo "$out" | grep -q '0.21.0'; then
  ok "reports the version when the backend answers after a few attempts"
else
  bad "a backend that answers on attempt 3 must be reported, got rc=$rc out=[$out]"
fi

# 2. It must still fail when the backend never answers — otherwise the check is
#    decorative and a genuinely dead deploy reports success.
out="$(READY_AFTER=9999 bash -c '. '"$tmp"'/harness.sh; await_version 3001 6' 2>&1)"
rc=$?
if [ $rc -ne 0 ]; then
  ok "still fails when the backend never answers"
else
  bad "a backend that never answers must not report success, got rc=$rc out=[$out]"
fi

# 3. It must give up rather than hang forever on a dead backend.
calls_before="$(wc -c < "$tmp/calls" | tr -d ' ')"
if [ "$calls_before" -gt 1 ] && [ "$calls_before" -lt 100 ]; then
  ok "retries a bounded number of times ($calls_before) rather than once or forever"
else
  bad "expected a bounded retry count, saw $calls_before"
fi

# 4. THE REAL DEFECT. NOMAD_FRONTEND_HOST_PORT holds a compose bind spec --
#    "127.0.0.1:53000" on the CIFFC demo -- not a bare port. Interpolating it
#    straight into a URL produced "localhost:127.0.0.1:53000/api/v1/info", which
#    can never resolve. That is why EVERY healthy deploy warned; the backend is
#    up in under 4 seconds. Retrying a malformed URL just fails more slowly.
READY_AFTER=1 bash -c '. '"$tmp"'/harness.sh; await_version "127.0.0.1:53000" 10' >/dev/null 2>&1
asked="$(cat "$tmp/url" 2>/dev/null || echo '(none)')"
case "$asked" in
  *localhost:53000/api/v1/info*) ok "extracts the port from a host:port bind spec" ;;
  *) bad "built a malformed URL from a bind spec: [$asked]" ;;
esac

# 5. A bare port must still work -- that is what a plain install has.
READY_AFTER=1 bash -c '. '"$tmp"'/harness.sh; await_version "3001" 10' >/dev/null 2>&1
asked="$(cat "$tmp/url" 2>/dev/null || echo '(none)')"
case "$asked" in
  *localhost:3001/api/v1/info*) ok "still accepts a bare port" ;;
  *) bad "a bare port must stay supported, asked for [$asked]" ;;
esac

echo ""
echo "passed: $pass   failed: $fail"
[ "$fail" -eq 0 ]
