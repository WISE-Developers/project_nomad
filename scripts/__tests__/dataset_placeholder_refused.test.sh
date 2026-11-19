#!/usr/bin/env bash
#
# Regression test for the dataset DOWNLOAD path — issue #562.
#
# Three doors reach the same harm, and this is the third:
#   #343 guarded the WRITE path   — update_env_value now asks is_placeholder_value.
#   #561 guarded the PROMPT path  — all three installers ask it when choosing a default.
#   #562 is the DOWNLOAD path     — install-firestarr-dataset.sh, where the data lands.
#
# That script takes FIRESTARR_DATASET_PATH from the sourced .env and checks only `-z`.
# A shipped placeholder is not empty, so it passes, and `mkdir -p` then creates a literal
# /absolute/path/to/firestarr_data with ~11 GB of rasters inside it. Unlike the three
# installers, this script carries no copy of is_placeholder_value at all, so there was no
# predicate here to start asking.
#
# WHY load_config AND NOT THE WHOLE SCRIPT: load_config is the gate — it runs at line 465,
# before any download or mkdir. Driving the whole script for the ACCEPT half would start an
# 11 GB download, so the function is extracted the way the #561 suite extracts its prompts.
#
# Deps: bash 3.x (macOS ships 3.2), sed, grep only. Exit 0 = all pass, 1 = any failure.
set -u

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPTS_DIR="$TEST_DIR/.."
INSTALLER="$SCRIPTS_DIR/install-firestarr-dataset.sh"
PLACEHOLDER="/absolute/path/to/firestarr_data"
GENUINE="/srv/operator/chose/this"

[ -f "$INSTALLER" ] || { echo "installer not found at $INSTALLER"; exit 1; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

pass=0; fail=0
ok()  { echo "    ok   $1"; pass=$((pass+1)); }
bad() { echo "    FAIL $1"; [ $# -gt 1 ] && echo "         $2"; fail=$((fail+1)); }

# ---------------------------------------------------------------------------
# Part 1 — BEHAVIOUR. Run the real load_config against a crafted .env and read
# what it did: its exit status, and whether it left a directory behind.
# ---------------------------------------------------------------------------

# $1 = the FIRESTARR_DATASET_PATH value to put in .env
# Echoes "<exit status>" and writes combined output to $tmp/out
run_load_config() {
    local value="$1"
    local work="$tmp/work"
    rm -rf "$work"; mkdir -p "$work"

    # The installer reads ENV_FILE=".env", relative to cwd, so the crafted .env goes
    # beside the working directory the function runs in.
    cat > "$work/.env" <<ENVEOF
FIRESTARR_DATASET_SOURCE=https://example.invalid/dataset.zip
FIRESTARR_DATASET_PATH=$value
ENVEOF

    # Extract only what load_config needs: the print_* helpers it calls on the failure
    # path, is_placeholder_value if the script has one yet, and load_config itself.
    {
        sed -n '/^print_error() {/,/^}/p'          "$INSTALLER"
        sed -n '/^print_warning() {/,/^}/p'        "$INSTALLER"
        sed -n '/^print_step() {/,/^}/p'           "$INSTALLER"
        sed -n '/^print_success() {/,/^}/p'        "$INSTALLER"
        sed -n '/^print_info() {/,/^}/p'           "$INSTALLER"
        sed -n '/^is_placeholder_value() {/,/^}/p' "$INSTALLER"
        sed -n '/^load_config() {/,/^}/p'          "$INSTALLER"
    } > "$tmp/fn.sh"

    ( cd "$work" \
        && ENV_FILE=".env" RED='' GREEN='' YELLOW='' BLUE='' NC='' \
           bash -c "source '$tmp/fn.sh'; load_config" ) > "$tmp/out" 2>&1
    echo "$?"
}

echo "#562 the download script must refuse our own placeholder"

status="$(run_load_config "$PLACEHOLDER")"
if [ "$status" = "0" ]; then
    bad "load_config refuses the shipped placeholder" \
        "it ACCEPTED $PLACEHOLDER — mkdir -p would create it and ~11 GB would follow"
else
    # A non-zero exit is not enough on its own: the script exits 1 for a missing .env and
    # for a missing SOURCE too, so a refusal for the WRONG reason would pass here. The
    # message must name the key, which is what tells an operator what to fix.
    if grep -qF 'FIRESTARR_DATASET_PATH' "$tmp/out"; then
        ok "load_config refuses the shipped placeholder, naming the key"
    else
        bad "load_config refuses the shipped placeholder, naming the key" \
            "it exited $status but never named FIRESTARR_DATASET_PATH: $(head -2 "$tmp/out" | tr '\n' ' ')"
    fi
fi

# CONTROL, the positive half. Without this the assertion above is satisfied by a
# load_config that refuses EVERYTHING — including an operator's real path — and a test
# that cannot tell a correct fix from a broken one is worse than no test.
status="$(run_load_config "$GENUINE")"
if [ "$status" = "0" ]; then
    ok "CONTROL: a genuine operator path is still accepted (#292 intact)"
else
    bad "CONTROL: a genuine operator path is still accepted (#292 intact)" \
        "it refused $GENUINE with exit $status, so the refusal above proves nothing: $(head -2 "$tmp/out" | tr '\n' ' ')"
fi

# CONTROL, the instrument half. If the harness cannot reach load_config at all, both
# assertions above are answering with the same silence a correct script would give.
# An empty .env must be refused for the SOURCE reason, which only a reached function
# can report.
status="$(run_load_config "")"
if [ "$status" != "0" ] && grep -qF 'FIRESTARR_DATASET_PATH' "$tmp/out"; then
    ok "CONTROL: the harness reaches load_config (empty value still refused by -z)"
else
    bad "CONTROL: the harness reaches load_config (empty value still refused by -z)" \
        "exit $status, output: $(head -2 "$tmp/out" | tr '\n' ' ') — the -z branch predates #562 and must still fire"
fi

# ---------------------------------------------------------------------------
# Part 2 — SHAPE. The predicate must exist in THIS script. #561's fix lives in
# three other files; a sibling's copy does nothing for the script that downloads.
# ---------------------------------------------------------------------------

echo "#562 the predicate exists in this script and is asked of the dataset path"

if grep -q '^is_placeholder_value() {' "$INSTALLER"; then
    ok "install-firestarr-dataset.sh defines is_placeholder_value"
else
    bad "install-firestarr-dataset.sh defines is_placeholder_value" \
        "no definition found — the script has no predicate to ask"
fi

if sed -n '/^load_config() {/,/^}/p' "$INSTALLER" | grep -q 'is_placeholder_value "\$FIRESTARR_DATASET_PATH"'; then
    ok "load_config asks the predicate about FIRESTARR_DATASET_PATH"
else
    bad "load_config asks the predicate about FIRESTARR_DATASET_PATH" \
        "the gate that runs before every mkdir does not ask it"
fi

# The predicate must be defined ABOVE load_config. Bash resolves a function at call
# time, so order is harmless when the whole script is sourced — but this suite extracts
# functions, every installer in the class defines it above its first caller, and a
# definition that trails its use is the kind of thing that survives until someone
# reorders the file.
def_line="$(grep -n '^is_placeholder_value() {' "$INSTALLER" | head -1 | cut -d: -f1)"
use_line="$(grep -n '^load_config() {' "$INSTALLER" | head -1 | cut -d: -f1)"
if [ -n "$def_line" ] && [ -n "$use_line" ] && [ "$def_line" -lt "$use_line" ]; then
    ok "is_placeholder_value is defined above load_config"
else
    bad "is_placeholder_value is defined above load_config" \
        "definition at line ${def_line:-none}, load_config at line ${use_line:-none}"
fi

echo ""
echo "  $pass passed, $fail failed"
[ "$fail" -eq 0 ] || exit 1
