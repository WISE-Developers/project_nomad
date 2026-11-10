#!/usr/bin/env bash
#
# Regression test for update_env_value() in EVERY installer that has one (#336).
#
# update_env_value_all_installers.test.sh exists because update_env_value.test.sh
# did its job and still missed this: it asserts the set-if-absent behaviour against
# ONE script, and the bug it guards was reachable the whole time through the other
# copy of the same wizard.
#
# The #292 lesson: an installer must never overwrite a value already set in an
# existing .env, so a re-run cannot clobber a manually-tuned config. It clobbered a
# hand-set NOMAD_FRONTEND_HOST_PORT on the demo and broke the Cloudflare tunnel.
# The fix went into install_nomad_setup.sh and not into install-nomad-headless.sh.
#
# So this suite is parameterised over the installers rather than naming one. A new
# installer with its own update_env_value is picked up by the glob below and must
# satisfy the same contract — which is the only way a fix stays applied to every
# member of the class instead of the one someone happened to be looking at.
#
# Deps: bash, sed, grep only. Exit 0 = all pass, 1 = any failure.
set -u

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPTS_DIR="$TEST_DIR/.."

# Every installer that defines the function. Discovered, not listed.
installers=()
for f in "$SCRIPTS_DIR"/*.sh; do
    [ -f "$f" ] || continue
    if grep -q '^update_env_value() {' "$f" 2>/dev/null; then
        installers+=("$f")
    fi
done

if [ "${#installers[@]}" -lt 2 ]; then
    # A control on the discovery itself. Two copies of this wizard are known to
    # exist; finding fewer means the glob or the pattern broke, and a suite that
    # silently checks nothing is worse than one that fails.
    echo "FAIL - expected at least 2 installers defining update_env_value, found ${#installers[@]}"
    printf '  %s\n' "${installers[@]:-(none)}"
    exit 1
fi

total_pass=0
total_fail=0

for INSTALLER in "${installers[@]}"; do
    name="$(basename "$INSTALLER")"
    echo "== $name"

    tmp="$(mktemp -d)"

    # Extract the real function, plus is_placeholder_value when the script has one,
    # and stub the printers.
    sed -n '/^update_env_value() {/,/^}/p' "$INSTALLER" > "$tmp/fn.sh"
    if grep -q '^is_placeholder_value() {' "$INSTALLER"; then
        sed -n '/^is_placeholder_value() {/,/^}/p' "$INSTALLER" >> "$tmp/fn.sh"
    fi

    # Stub BOTH printer naming conventions. install_nomad_setup.sh and
    # install-nomad-headless.sh use print_info/print_warning/print_dry_run;
    # install-nomad-demo.sh uses info/warn/dry. Stubbing only one set left the other
    # script's function calling an undefined command, which wrote to stderr and was
    # reported as the function erroring — a harness gap masquerading as a defect.
    cat > "$tmp/harness.sh" <<EOF
DRY_RUN=false
ENV_FILE="$tmp/.env"
print_dry_run(){ :; }
print_info(){ :; }
print_warning(){ :; }
dry(){ :; }
info(){ :; }
warn(){ :; }
source "$tmp/fn.sh"
EOF

    # Capture stderr. A function whose `sed -i` fails writes NOTHING, which leaves an
    # existing value in place and looks exactly like correct set-if-absent behaviour.
    # install-nomad-demo.sh uses GNU `sed -i` with no OSTYPE branch, so on BSD/macOS
    # every write errors and the preservation assertion passed for the wrong reason.
    # A test that cannot tell "preserved because fixed" from "preserved because the
    # write crashed" is measuring nothing.
    run() { bash -c "source '$tmp/harness.sh'; $1" 2> "$tmp/stderr"; }

    pass=0; fail=0
    expect_no_write_error() {
        if [ -s "$tmp/stderr" ]; then
            echo "  FAIL - $1: the function errored, so the .env state proves nothing"
            sed 's/^/         /' "$tmp/stderr" | head -2
            fail=$((fail+1))
            return 1
        fi
        return 0
    }
    expect_line() {
        expect_no_write_error "$1" || return
        if grep -qx "$2" "$tmp/.env"; then echo "  ok   - $1"; pass=$((pass+1))
        else echo "  FAIL - $1 (.env: $(tr '\n' '|' < "$tmp/.env"))"; fail=$((fail+1)); fi
    }
    expect_single() {
        local n; n="$(grep -c "^$1=" "$tmp/.env")"
        if [ "$n" -eq 1 ]; then echo "  ok   - single $1"; pass=$((pass+1))
        else echo "  FAIL - $1 appears $n times (expected 1)"; fail=$((fail+1)); fi
    }

    # 1. THE REGRESSION. An operator's value survives a re-run.
    printf 'NOMAD_FRONTEND_HOST_PORT=53000\n' > "$tmp/.env"
    run 'update_env_value NOMAD_FRONTEND_HOST_PORT 3901'
    expect_line "existing non-empty value preserved" "NOMAD_FRONTEND_HOST_PORT=53000"
    expect_single NOMAD_FRONTEND_HOST_PORT

    # 2. Present but empty is filled. The positive half: a guard that preserved
    #    everything would pass test 1 and leave the installer unable to set anything.
    printf 'PORT=\n' > "$tmp/.env"
    run 'update_env_value PORT 4901'
    expect_line "empty value filled" "PORT=4901"
    expect_single PORT

    # 3. Commented default is uncommented and set.
    printf '#FIRESTARR_EXECUTION_MODE=docker\n' > "$tmp/.env"
    run 'update_env_value FIRESTARR_EXECUTION_MODE metal'
    expect_line "commented default set" "FIRESTARR_EXECUTION_MODE=metal"
    expect_single FIRESTARR_EXECUTION_MODE

    # 4. Missing key is appended.
    printf 'OTHER=x\n' > "$tmp/.env"
    run 'update_env_value NOMAD_DEPLOYMENT_MODE SAN'
    expect_line "missing key appended" "NOMAD_DEPLOYMENT_MODE=SAN"
    expect_single NOMAD_DEPLOYMENT_MODE

    # 5. Our own shipped placeholder is NOT an operator value (#343).
    printf 'FIRESTARR_DATASET_PATH=/absolute/path/to/firestarr_data\n' > "$tmp/.env"
    run 'update_env_value FIRESTARR_DATASET_PATH /srv/nomad/data'
    expect_line "shipped placeholder replaced" "FIRESTARR_DATASET_PATH=/srv/nomad/data"
    expect_single FIRESTARR_DATASET_PATH

    # 6. A real path that merely looks placeholder-ish is an operator value.
    printf 'FIRESTARR_DATASET_PATH=/home/yourname/data\n' > "$tmp/.env"
    run 'update_env_value FIRESTARR_DATASET_PATH /srv/nomad/data'
    expect_line "operator path preserved" "FIRESTARR_DATASET_PATH=/home/yourname/data"
    expect_single FIRESTARR_DATASET_PATH

    echo "  -> $name: $pass passed, $fail failed"
    echo
    total_pass=$((total_pass+pass))
    total_fail=$((total_fail+fail))
    rm -rf "$tmp"
done

echo "update_env_value across ${#installers[@]} installer(s): $total_pass passed, $total_fail failed"
[ "$total_fail" -eq 0 ]
