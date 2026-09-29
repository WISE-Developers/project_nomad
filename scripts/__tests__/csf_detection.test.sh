#!/usr/bin/env bash
#
# Installer CSF detection — issue #400, Option 1 (detect and warn).
#
# CSF deletes Docker's iptables chains whenever it rebuilds its ruleset. Nothing
# looks broken until the next container start, because a 127.0.0.1 publish goes
# through docker-proxy and never touches the DOCKER chain. It took the CIFFC demo
# down (#392).
#
# The decision recorded on #400 is WARN ONLY. The installer must not write to
# /etc/csf/csf.conf and must not install a systemd drop-in: modifying a security
# tool it does not own, on someone else's host, is a bigger commitment than an
# install script should make, and would have to be idempotent and reversible to
# be safe.
#
# The two properties that matter most here are the negative ones — it must not
# fail an install on a host without CSF, and it must not write anything — so both
# are asserted directly rather than assumed.
#
# Follows deploy_guards.test.sh: extract the functions from the installer and
# source them with a stub harness, rather than running the installer.
#
# bash 3.x compatible (macOS default). Deps: bash, sed, grep.

set -u

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALLER="$TEST_DIR/../install_nomad_setup.sh"
DOC="$TEST_DIR/../../Documentation/Nomad/deploying-behind-csf.md"

pass=0; fail=0
ok()  { printf '  ok   - %s\n' "$1"; pass=$((pass+1)); }
bad() { printf '  FAIL - %s\n' "$1"; [ $# -gt 1 ] && printf '         %s\n' "$2"; fail=$((fail+1)); }

if [ ! -f "$INSTALLER" ]; then
    bad "install_nomad_setup.sh exists" "not found at $INSTALLER"
    echo; echo "passed: $pass   failed: $fail"; exit 1
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

sed -n '/^csf_present() {/,/^}/p'     "$INSTALLER" >  "$tmp/fn.sh"
sed -n '/^check_csf_early() {/,/^}/p' "$INSTALLER" >> "$tmp/fn.sh"

cat > "$tmp/harness.sh" <<EOF
print_warning(){ echo "WARN: \$*"; }
print_info(){ echo "INFO: \$*"; }
print_step(){ :; }
print_success(){ :; }
print_error(){ echo "ERROR: \$*"; }
source "$tmp/fn.sh"
EOF

# run <command...> -> sets OUT and CODE
run() {
    OUT="$(bash -c "source '$tmp/harness.sh'; $1" 2>&1)"
    CODE=$?
}

echo "csf_present"

if ! grep -q '^csf_present() {' "$INSTALLER"; then
    bad "the installer defines csf_present" "function not found"
else
    ok "the installer defines csf_present"
fi

# Absent: no conf file, and `csf` not on PATH. An empty PATH guarantees the
# command lookup fails regardless of what the host has installed.
run "PATH=/nonexistent csf_present '$tmp/no-such-csf.conf'"
if [ "$CODE" -ne 0 ]; then
    ok "reports absent when there is no csf.conf and no csf command"
else
    bad "reports absent when there is no csf.conf and no csf command" "exit $CODE"
fi

# Present via the config file.
printf 'TESTING = "0"\n' > "$tmp/csf.conf"
run "PATH=/nonexistent csf_present '$tmp/csf.conf'"
if [ "$CODE" -eq 0 ]; then
    ok "reports present when csf.conf exists"
else
    bad "reports present when csf.conf exists" "exit $CODE"
fi

echo
echo "check_csf_early"

if ! grep -q '^check_csf_early() {' "$INSTALLER"; then
    bad "the installer defines check_csf_early" "function not found"
else
    ok "the installer defines check_csf_early"
fi

# --- the most important assertion: it never fails an install ----------------
run "PATH=/nonexistent check_csf_early '$tmp/no-such-csf.conf'"
if [ "$CODE" -eq 0 ]; then
    ok "returns 0 on a host without CSF"
else
    bad "returns 0 on a host without CSF" "exit $CODE — this would break installs everywhere"
fi

case "$OUT" in
    *WARN*) bad "stays silent on a host without CSF" "warned anyway: $OUT" ;;
    *) ok "stays silent on a host without CSF" ;;
esac

run "PATH=/nonexistent check_csf_early '$tmp/csf.conf'"
if [ "$CODE" -eq 0 ]; then
    ok "returns 0 when CSF IS present (warns, does not fail)"
else
    bad "returns 0 when CSF IS present (warns, does not fail)" "exit $CODE"
fi

case "$OUT" in
    *WARN*) ok "warns when CSF is present" ;;
    *) bad "warns when CSF is present" "no warning in output: $OUT" ;;
esac

# --- the warning has to be actionable, or it is just noise -------------------
for needle in 'DOCKER' 'DOCKER_NETWORK4' 'csf.service'; do
    case "$OUT" in
        *"$needle"*) ok "the warning names $needle" ;;
        *) bad "the warning names $needle" "not in output" ;;
    esac
done

case "$OUT" in
    *deploying-behind-csf.md*) ok "the warning points at the documentation" ;;
    *) bad "the warning points at the documentation" "no doc reference in output" ;;
esac

# The doc must actually exist, or the pointer is a dead end.
if [ -f "$DOC" ]; then
    ok "the referenced documentation exists"
else
    bad "the referenced documentation exists" "not found at $DOC"
fi

echo
echo "it writes nothing (Option 1, not Option 2)"

# Assert on the function source: no redirection into csf config, no systemctl,
# no drop-in creation. This is the property the decision turns on.
FN_SRC="$(cat "$tmp/fn.sh")"
if echo "$FN_SRC" | grep -qE '>[[:space:]]*/etc/csf|>>[[:space:]]*/etc/csf|tee[[:space:]]+/etc/csf|sed -i.*csf\.conf'; then
    bad "does not write to CSF configuration" "found a write to /etc/csf in the function body"
else
    ok "does not write to CSF configuration"
fi

# The warning TEXT names `systemctl restart csf`, because the operator needs to
# know that command deletes the chains. So a naive grep for "systemctl" matches
# the documentation and not the behaviour — the first version of this check did
# exactly that and failed on correct code.
#
# What matters is whether systemd is INVOKED. Strip the lines that only print
# text, then look for an actual command position.
EXECUTED="$(printf '%s\n' "$FN_SRC" | grep -vE '^[[:space:]]*(echo|printf|#)')"

# Proof the pattern still bites: a real invocation must be detected. Without
# this, loosening the regex to silence the false positive would go unnoticed.
SYSTEMD_RE='(^|[;&|]|\$\()[[:space:]]*(sudo[[:space:]]+)?(systemctl|systemd-run)[[:space:]]'
if printf '    systemctl restart docker\n' | grep -qE "$SYSTEMD_RE"; then
    ok "the systemd detector catches a real invocation (self-check)"
else
    bad "the systemd detector catches a real invocation (self-check)" \
        "the pattern no longer detects 'systemctl restart docker' — it has been loosened too far"
fi

if printf '%s\n' "$EXECUTED" | grep -qE "$SYSTEMD_RE" \
   || printf '%s\n' "$EXECUTED" | grep -qE '>[[:space:]]*/etc/systemd|tee[[:space:]]+/etc/systemd'; then
    bad "does not install a systemd drop-in or restart services" \
        "found a systemd action outside of printed text"
else
    ok "does not install a systemd drop-in or restart services"
fi

echo
echo "passed: $pass   failed: $fail"
[ "$fail" -eq 0 ]
