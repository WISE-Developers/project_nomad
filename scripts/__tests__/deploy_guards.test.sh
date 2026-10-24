#!/usr/bin/env bash
#
# Guards for scripts/deploy.sh
#
# The CIFFC demo broke mid-deploy because 507 files under /opt/nomad-app —
# including .git internals — were owned by root while the repo and the app run
# as `nomad`. git updated what it could, hit "Permission denied", and left the
# working tree half-applied with HEAD unmoved. Someone had run `sudo git pull`
# by hand; nothing automated does it.
#
# These cover the two guards that stop it happening again: refusing to run as
# root, and detecting ownership drift before touching git.
#
# Deps: bash, sed, grep only. Exit 0 = all pass, 1 = any failure.
set -u

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY="$TEST_DIR/../deploy.sh"
[ -f "$DEPLOY" ] || { echo "deploy.sh not found at $DEPLOY"; exit 1; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

sed -n '/^refuse_root() {/,/^}/p'      "$DEPLOY" >  "$tmp/fn.sh"
sed -n '/^owner_drift_count() {/,/^}/p' "$DEPLOY" >> "$tmp/fn.sh"
sed -n '/^probe_docker_chain() {/,/^}/p'   "$DEPLOY" >> "$tmp/fn.sh"
sed -n '/^docker_chain_verdict() {/,/^}/p' "$DEPLOY" >> "$tmp/fn.sh"
sed -n '/^await_version() {/,/^}/p'        "$DEPLOY" >> "$tmp/fn.sh"

cat > "$tmp/harness.sh" <<EOF
print_error(){ echo "ERROR: \$*"; }
print_info(){ :; }
print_warning(){ :; }
source "$tmp/fn.sh"
EOF

pass=0; fail=0
check() { # desc, expected-status, command
  local actual
  bash -c "source '$tmp/harness.sh'; $3" >/dev/null 2>&1 && actual=0 || actual=$?
  if [ "$actual" -eq "$2" ]; then echo "  ok   - $1"; pass=$((pass+1))
  else echo "  FAIL - $1 (status $actual, expected $2)"; fail=$((fail+1)); fi
}

echo "refuse_root"
check "allows a normal user"       0 'refuse_root 1000'
check "refuses uid 0"              1 'refuse_root 0'

echo
echo "owner_drift_count"

# A tree owned entirely by the invoking user has no drift.
mkdir -p "$tmp/clean/sub"
touch "$tmp/clean/a" "$tmp/clean/sub/b"
check "clean tree reports no drift" 0 "[ \"\$(owner_drift_count '$tmp/clean' \$(id -un))\" = 0 ]"

# A tree containing files owned by someone else does.
mkdir -p "$tmp/drift"
touch "$tmp/drift/mine"
# Files here are owned by the invoking user, so measuring drift against root
# must count them. (Using a NON-EXISTENT user would just make find error.)
check "counts files owned by another user" 0 \
  "[ \"\$(owner_drift_count '$tmp/drift' root)\" -ge 1 ]"

check "missing directory reports 0 rather than erroring" 0 \
  "[ \"\$(owner_drift_count '$tmp/nope' \$(id -un))\" = 0 ]"

echo
echo "probe_docker_chain"

# CSF deletes Docker's DOCKER/DOCKER-USER chains whenever it restores its saved
# ruleset. Running containers keep serving (a 127.0.0.1 publish is handled by
# docker-proxy and never traverses the chain), so the fault is invisible until
# something STARTS a container — which is exactly what a deploy does, after it
# has already torn the working container down. Refs #392.
#
# Three outcomes, and the third matters: a host with no iptables, or no sudo
# rights to read it, must not have its deploys blocked. Only a definite
# "iptables answered and the chain is not there" aborts.

# Chain present: probe command succeeds.
check "reports present (0) when the probe succeeds" 0 \
  "probe_docker_chain true; [ \$? -eq 0 ]"

# Chain missing: probe runs but exits non-zero, the way iptables does with
# "No chain/target/match by that name".
check "reports missing (1) when the probe exits non-zero" 0 \
  "probe_docker_chain false; [ \$? -eq 1 ]"

# Cannot determine: the probe command does not exist at all.
check "reports undeterminable (2) when the probe is not installed" 0 \
  "probe_docker_chain '$tmp/definitely-not-a-command'; [ \$? -eq 2 ]"

echo
echo "docker_chain_verdict"

check "proceeds when the chain is present"         0 'docker_chain_verdict 0'
check "ABORTS when the chain is definitely missing" 1 'docker_chain_verdict 1'
check "proceeds when it cannot be determined"      0 'docker_chain_verdict 2'

# A missing chain must say so loudly; a silent abort is as bad as no guard.
check "names the chain in the abort message" 0 \
  "docker_chain_verdict 1 2>&1 | grep -q DOCKER"

# The operator needs to know rollback is not an escape route: the previous
# image cannot start either, for the same reason.
check "abort message rules out rollback as a workaround" 0 \
  "docker_chain_verdict 1 2>&1 | grep -qi rollback"

# ---------------------------------------------------------------------------
# THE IMAGE SBOM SECTION WAS REMOVED HERE, WITH THE FEATURE IT GUARDED (#465).
#
# It asserted that deploy.sh invoked generate-image-sbom.sh and swallowed its
# exit status with `|| true`, so a failing bill of materials could never abort a
# deploy — plus a control proving the assertion failed when the `|| true` was
# stripped. All three are gone because the deploy no longer produces a document
# at all: CI publishes the image and the registry carries its SPDX attestation,
# beside the source it was built from.
#
# Recorded rather than silently dropped. A guard that disappears without a word
# reads as an oversight to the next person, and the lessons behind it are still
# live elsewhere: #464 (a step that exits 0 on every failure path can fail
# invisibly for months) and #469 (the bare-version assertion below, which was
# what named those files).

# ---------------------------------------------------------------------------
# THE REPORTED VERSION MUST BE A BARE VERSION, NOT A JSON FRAGMENT (#469).
#
# deploy.sh used `grep -oE '"version":"[^"]+"'`, which prints the WHOLE match
# because grep has no capture-group extraction. So `reported` held
# `"version":"0.36.0"`. That was invisible for as long as it only reached one
# log line -- and #460 then passed it to generate-image-sbom.sh, which names
# files with it. The v0.36.0 deploy wrote
# `nomad-image-"version":"0.36.0".spdx.json` on the CIFFC demo.
#
# This calls the REAL await_version with curl and sleep stubbed, rather than
# re-implementing its pipeline here. The first version of this test lifted the
# line out with a regex, produced an empty string, and then "passed" a
# filename-safety assertion on that emptiness -- a test failing for the wrong
# reason, which would have gone green after the fix for a reason unrelated to
# the fix.
echo
echo "reported version is a bare version (#469)"

vbin="$tmp/vbin"
mkdir -p "$vbin"
cat > "$vbin/curl" <<'STUB'
#!/usr/bin/env bash
# The real shape of GET /api/v1/info, version deliberately not first.
printf '{"name":"nomad","version":"0.36.0","engine":"firestarr"}'
STUB
cat > "$vbin/sleep" <<'STUB'
#!/usr/bin/env bash
exit 0
STUB
chmod +x "$vbin/curl" "$vbin/sleep"

got="$(PATH="$vbin:$PATH" bash -c "source '$tmp/harness.sh'; await_version 3001 3" 2>/dev/null)"

if [ "$got" = "0.36.0" ]; then
  echo "  ok   - await_version returns 0.36.0"
  pass=$((pass+1))
else
  echo "  FAIL - await_version returned '$got', expected '0.36.0' (#469)"
  fail=$((fail+1))
fi

# Guard against passing on emptiness: a blank result is filename-safe and useless.
if [ -z "$got" ]; then
  echo "  FAIL - await_version returned nothing, so the stub or extraction is wrong, not the version"
  fail=$((fail+1))
else
  case "$got" in
    *'"'*|*:*|*/*)
      echo "  FAIL - returned version contains a quote, colon or slash, so it cannot safely name a file"
      fail=$((fail+1)) ;;
    *)
      echo "  ok   - returned version is filename-safe and non-empty"
      pass=$((pass+1)) ;;
  esac
fi

echo
echo "passed: $pass   failed: $fail"
[ "$fail" -eq 0 ] || exit 1
