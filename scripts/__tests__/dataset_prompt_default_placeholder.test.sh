#!/usr/bin/env bash
#
# Regression test for the dataset-path PROMPT DEFAULT — issue #561.
#
# #343 fixed the WRITE path: update_env_value now calls is_placeholder_value and
# replaces a shipped placeholder instead of preserving it. That fix is real and stays.
#
# The same placeholder still reaches .env through a different door. The installer
# sources .env (which was copied from .env.example, which ships NON-EMPTY placeholders)
# before the wizard runs, so FIRESTARR_DATASET_PATH is set and non-empty. Every prompt
# then does:
#
#     local default_dataset="${FIRESTARR_DATASET_PATH:-$HOME/firestarr_data}"
#
# The :- fallback is dead code whenever .env came from .env.example, so the operator is
# OFFERED /absolute/path/to/firestarr_data and pressing Enter accepts it. update_env_value
# then "replaces" the placeholder with itself and prints a message that reads like the fix
# working. That is #343's outcome reached through the prompt instead of the write.
#
# The predicate that answers "is this one of ours?" already exists. It was only ever asked
# at write time. It must also be asked at the point the default is CHOSEN.
#
# THE CLASS IS THREE INSTALLERS, NOT ONE. install_nomad_setup.sh, install-nomad-headless.sh
# and install-nomad-demo.sh each source .env and each derive a dataset default from it.
# A fix applied to one is not applied to its siblings, so this suite checks all three.
#
# Deps: bash 3.x (macOS ships 3.2), sed, grep only. Exit 0 = all pass, 1 = any failure.
set -u

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPTS_DIR="$TEST_DIR/.."
PLACEHOLDER="/absolute/path/to/firestarr_data"

SETUP="$SCRIPTS_DIR/install_nomad_setup.sh"
HEADLESS="$SCRIPTS_DIR/install-nomad-headless.sh"
DEMO="$SCRIPTS_DIR/install-nomad-demo.sh"
for f in "$SETUP" "$HEADLESS" "$DEMO"; do
    [ -f "$f" ] || { echo "installer not found at $f"; exit 1; }
done

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

pass=0; fail=0
ok()  { echo "    ok   $1"; pass=$((pass+1)); }
bad() { echo "    FAIL $1"; [ $# -gt 1 ] && echo "         $2"; fail=$((fail+1)); }

# ---------------------------------------------------------------------------
# Part 1 — BEHAVIOUR. Run the real prompt with a placeholder in the environment
# and nothing but Enter on stdin, and read what it offered.
# ---------------------------------------------------------------------------

build_harness() { # $1 = installer, $2 = function name, $3 = value to seed
    sed -n '/^is_placeholder_value() {/,/^}/p' "$1" >  "$tmp/fn.sh"
    sed -n "/^$2() {/,/^}/p"                    "$1" >> "$tmp/fn.sh"
    cat > "$tmp/harness.sh" <<EOF
HOME="$tmp/home"
CYAN=''; NC=''; GREEN=''; YELLOW=''; RED=''
print_info(){ :; }; print_warning(){ :; }; print_success(){ :; }; print_error(){ :; }
DATASET_INSTALL_MODE=""
FIRESTARR_DATASET_PATH="$3"

# read -p writes its prompt to the TERMINAL, not to stdout, so capturing the function's
# output does NOT capture what it offered. A "does not contain the placeholder" assertion
# would then pass on a function that was never reached — a dead instrument answering with
# the same silence as a correct one. Shadow read so the offer is observable, and answer
# with an empty line, which is what pressing Enter does.
read() {   # called as: read -p "<prompt>" <varname>
    printf 'OFFERED:%s\n' "\$2"
    eval "\$3=''"
}
source "$tmp/fn.sh"
EOF
}

offers() { # $1 = installer, $2 = function, $3 = seeded value -> the offered prompts
    build_harness "$1" "$2" "$3"
    bash -c "source '$tmp/harness.sh'; $2" 2>/dev/null | grep '^OFFERED:'
}

echo "#561 the prompt must not OFFER our own placeholder"

for fn in prompt_existing_dataset prompt_new_dataset_path; do
    out="$(offers "$SETUP" "$fn" "$PLACEHOLDER")"
    if [ -z "$out" ]; then
        # The null that is not a result. Without this the next branch would "pass".
        bad "install_nomad_setup.sh :: $fn does not offer the placeholder" \
            "the function offered NOTHING — instrument dead, assertion meaningless"
    elif printf '%s' "$out" | grep -qF "$PLACEHOLDER"; then
        bad "install_nomad_setup.sh :: $fn does not offer the placeholder" \
            "it offered: $(printf '%s' "$out" | grep -F "$PLACEHOLDER" | head -1)"
    else
        ok "install_nomad_setup.sh :: $fn does not offer the placeholder"
    fi
done

# CONTROL for part 1, the positive half: a GENUINE operator value must still be offered.
# This proves the harness can see an offer at all, and that #292's protection survives —
# the fix must distinguish our placeholders from an operator's real path, not suppress
# every inherited value.
for fn in prompt_existing_dataset prompt_new_dataset_path; do
    ctrl="$(offers "$SETUP" "$fn" "/srv/operator/chose/this")"
    if printf '%s' "$ctrl" | grep -qF "/srv/operator/chose/this"; then
        ok "CONTROL: $fn still offers a genuine operator value (#292 intact)"
    else
        bad "CONTROL: $fn still offers a genuine operator value (#292 intact)" \
            "saw no offered default, so this function's assertion above proves nothing"
    fi
done

# ---------------------------------------------------------------------------
# Part 2 — SHAPE, across the whole class. Every site that derives a dataset
# default from the sourced environment must put it through the predicate.
# ---------------------------------------------------------------------------

echo "#561 every installer that sources .env gates its dataset default"

gated_sites() { # $1 = file -> "<gated>/<total>"
    local file="$1" total=0 gated=0 ln
    for ln in $(grep -n 'default_dataset="\${FIRESTARR_DATASET_PATH' "$file" | cut -d: -f1); do
        total=$((total+1))
        # the guard must appear within the 4 lines following the assignment
        if sed -n "$((ln+1)),$((ln+4))p" "$file" | grep -q 'is_placeholder_value'; then
            gated=$((gated+1))
        fi
    done
    echo "$gated/$total"
}

for f in "$SETUP" "$HEADLESS"; do
    r="$(gated_sites "$f")"
    g="${r%%/*}"; t="${r##*/}"
    if [ "$t" -eq 0 ]; then
        bad "$(basename "$f"): dataset default sites found" \
            "zero sites matched — the detector is broken, not the file"
    elif [ "$g" -eq "$t" ]; then
        ok "$(basename "$f"): all $t dataset default site(s) gated by is_placeholder_value"
    else
        bad "$(basename "$f"): all $t dataset default site(s) gated by is_placeholder_value" \
            "only $g of $t are gated — a sibling site still offers the placeholder"
    fi
done

# The demo installer takes no prompt, but it sources .env and assigns the same value
# non-interactively, so an inherited placeholder reaches the compose file silently.
if sed -n '/^FIRESTARR_DATASET_PATH=/,+0p;/^FIRESTARR_DATASET_PATH=/{x;}' "$DEMO" >/dev/null 2>&1 &&
   grep -q 'is_placeholder_value "\$FIRESTARR_DATASET_PATH"' "$DEMO"; then
    ok "install-nomad-demo.sh: inherited dataset path is placeholder-checked"
else
    bad "install-nomad-demo.sh: inherited dataset path is placeholder-checked" \
        "it sources .env and assigns FIRESTARR_DATASET_PATH with no placeholder check"
fi

# CONTROL for part 2: the detector must be able to report a MISS. Prove it on a file
# shaped like the bug, so "all gated" cannot be an artefact of matching nothing.
cat > "$tmp/unfixed.sh" <<'EOF'
prompt_existing_dataset() {
    local default_dataset="${FIRESTARR_DATASET_PATH:-$HOME/firestarr_data}"
    read -p "Dataset path [$default_dataset]: " input_dataset
}
EOF
r="$(gated_sites "$tmp/unfixed.sh")"
if [ "$r" = "0/1" ]; then
    ok "CONTROL: the detector reports 0/1 on a deliberately unfixed file"
else
    bad "CONTROL: the detector reports 0/1 on a deliberately unfixed file" \
        "got '$r' — the shape check cannot distinguish fixed from unfixed"
fi

echo ""
echo "dataset_prompt_default_placeholder: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
