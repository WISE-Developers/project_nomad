#!/usr/bin/env bash
#
# install-nomad-headless.sh must actually be headless (#335).
#
# The script's name promises an unattended install and its header calls itself a
# "Setup Wizard". It contains 34 interactive `read` calls, so automating an install
# with it gets a wizard blocked on stdin — and it fails in the least helpful way,
# by hanging rather than erroring. Unattended installation is a real use case: CI,
# provisioning, air-gapped field imaging (#318).
#
# Franco's issue offers two ways out and states the preference: make it genuinely
# unattended (every value from the environment or a flag, no `read` at all, fail
# loudly when a required value is absent). This asserts that contract.
#
# Deps: bash, grep only. Exit 0 = all pass, 1 = any failure.
set -u

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$TEST_DIR/../install-nomad-headless.sh"
[ -f "$SCRIPT" ] || { echo "not found: $SCRIPT"; exit 1; }

pass=0; fail=0
ok()   { echo "  ok   - $1"; pass=$((pass+1)); }
bad()  { echo "  FAIL - $1"; fail=$((fail+1)); }

echo "== install-nomad-headless.sh :: unattended contract"

# ---------------------------------------------------------------------------
# 1. No bare interactive reads.
#
# Source-level, because it is precise and cannot hang. Every `read` that collects
# a value must go through the unattended-aware helper, which takes its answer from
# the environment and fails loudly when a required value is missing. A `read` with
# a `-t` timeout or reading from a here-string is not a prompt and is allowed.
# ---------------------------------------------------------------------------
bare_reads="$(grep -nE '(^|[^_[:alnum:]])read -(p|sp)' "$SCRIPT" | grep -v 'prompt_or_env' || true)"
bare_count="$(printf '%s' "$bare_reads" | grep -c . || true)"
if [ "$bare_count" -eq 0 ]; then
    ok "no interactive 'read -p' prompts remain"
else
    bad "$bare_count interactive prompt(s) remain — an unattended run blocks on each"
    printf '%s\n' "$bare_reads" | head -5 | sed 's/^/         /'
fi

# ---------------------------------------------------------------------------
# 2. The unattended-aware helper exists.
#    The positive half: deleting every `read` would satisfy assertion 1 and leave
#    the script unable to collect anything at all.
# ---------------------------------------------------------------------------
if grep -q '^prompt_or_env() {' "$SCRIPT"; then
    ok "prompt_or_env() helper is defined"
else
    bad "prompt_or_env() is not defined — values have nowhere to come from"
fi

# ---------------------------------------------------------------------------
# 3. A missing REQUIRED value must fail loudly, not prompt and not default.
#    "A silent default is a lie": the install would proceed on an assumption and
#    look fine until it did not.
# ---------------------------------------------------------------------------
if grep -q '^prompt_or_env() {' "$SCRIPT"; then
    tmp="$(mktemp -d)"
    trap 'rm -rf "$tmp"' EXIT
    sed -n '/^prompt_or_env() {/,/^}/p' "$SCRIPT" > "$tmp/fn.sh"
    cat > "$tmp/h.sh" <<EOF
print_error(){ echo "ERROR: \$1" >&2; }
print_info(){ :; }
print_warning(){ :; }
source "$tmp/fn.sh"
EOF

    # required value absent, stdin closed: must exit non-zero and say the key name
    out="$(bash -c "source '$tmp/h.sh'; prompt_or_env NOMAD_TEST_KEY 'A test value' required" </dev/null 2>&1)"
    rc=$?
    if [ "$rc" -ne 0 ]; then ok "missing required value exits non-zero"
    else bad "missing required value exited 0 (rc=$rc) — it defaulted or prompted"; fi
    case "$out" in
        *NOMAD_TEST_KEY*) ok "the error names the key the operator must set" ;;
        *) bad "the error does not name NOMAD_TEST_KEY: ${out:-(no output)}" ;;
    esac

    # supplied via the environment: must be used, silently, with stdin closed
    got="$(bash -c "NOMAD_TEST_KEY=from-env; source '$tmp/h.sh'; prompt_or_env NOMAD_TEST_KEY 'A test value' required" </dev/null 2>/dev/null)"
    if [ "$got" = "from-env" ]; then ok "a value supplied in the environment is used"
    else bad "environment value not used (got: '${got:-}')"; fi

    # an optional value with a default: must take the default without prompting
    got="$(bash -c "source '$tmp/h.sh'; prompt_or_env NOMAD_TEST_OPT 'Optional' optional fallback-value" </dev/null 2>/dev/null)"
    if [ "$got" = "fallback-value" ]; then ok "an optional value falls back to its stated default"
    else bad "optional default not applied (got: '${got:-}')"; fi
else
    bad "skipped the behaviour assertions: prompt_or_env does not exist yet"
fi

# ---------------------------------------------------------------------------
# 4. The header must not advertise a wizard.
#    Franco's point in #335: the name is not the problem, the behaviour is — but a
#    header that still says "Menu-driven installer" sends the next reader the wrong
#    way about which script to automate.
# ---------------------------------------------------------------------------
# Precise about WHOSE behaviour is being described. A header that calls THIS
# script a wizard is the defect; a header that points at install_nomad_setup.sh
# as the menu-driven one is correct and worth keeping, so grepping for
# "menu-driven" anywhere failed on a correct header.
header="$(head -20 "$SCRIPT")"
if printf '%s' "$header" | grep -qiE '^#[[:space:]]*(Project Nomad )?Setup Wizard|^#[[:space:]]*Menu-driven installer'; then
    bad "the header still describes THIS script as a wizard"
    printf '%s' "$header" | grep -niE 'Setup Wizard|Menu-driven installer' | sed 's/^/         /'
else
    ok "the header does not describe this script as a wizard"
fi

if printf '%s' "$header" | grep -qi 'unattended'; then
    ok "the header says it is unattended"
else
    bad "the header does not say the script is unattended"
fi

echo
echo "headless unattended contract: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
