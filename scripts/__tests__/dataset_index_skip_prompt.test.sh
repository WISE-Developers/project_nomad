#!/usr/bin/env bash
#
# Regression guard: when FIRESTARR_DATASET_INDEX is set, the menu installer's
# own dataset SOURCE menu (prompt_dataset_source, defined in
# install_nomad_setup.sh around lines 484-525, shared verbatim by
# install-nomad-headless.sh) must be SKIPPED - the index decides the source and
# install-firestarr-dataset.sh's year picker (run_year_picker) chooses the
# years. Asking the user to pick a source twice is the bug this guards against.
#
# The dataset PATHS must never be decided silently: the year picker never asks
# where the ~11GB archive is downloaded or installed, and
# install-firestarr-dataset.sh exits 1 if FIRESTARR_DATASET_PATH is unset
# (load_config, :81-84). Defaulting those would decide where 11GB lands without
# telling the operator.
#
# THE TWO INSTALLERS NOW MEET THAT INTENT DIFFERENTLY (#335), so each is asserted
# on its own terms rather than by one shared prompt count:
#
#   install_nomad_setup.sh  - the interactive wizard. It ASKS: exactly 2 prompts
#                             remain (download folder, install location).
#   install-nomad-headless.sh - unattended, and contains no `read` at all. It
#                             REQUIRES: with the paths unset it exits loudly and
#                             names the variable; with them set it proceeds.
#
# Counting `read` calls in the headless script would now assert the opposite of
# what that script is for, which is why this guard failed after #335 and why the
# fix is here rather than in the installer.
#
# Expected behaviour in index mode, both scripts:
#   - the "Select an option [1-3]" source menu is never shown
#   - DATASET_INSTALL_MODE ends as "download" so install_dataset() runs and
#     routes through install-firestarr-dataset.sh -> run_year_picker
#
# Standalone: extracts the REAL functions from the installer and exercises them
# with a stubbed `read` builtin that records invocations. Exit 0 = all pass.
# Deps: bash, sed, grep only. bash 3.x compatible.
set -u

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

pass=0; fail=0
expect() { # desc, condition (0/1)
  if [ "$2" -eq 0 ]; then echo "  ok   - $1"; pass=$((pass+1))
  else echo "  FAIL - $1"; fail=$((fail+1)); fi
}

# prompt_dataset_source is duplicated across the installers, so both must be
# guarded - fixing only one leaves the double-prompt alive.
#
# This variant is for an installer that PROMPTS.
check_installer() { # installer filename
INSTALLER="$TEST_DIR/../$1"
echo "== $1"
[ -f "$INSTALLER" ] || { echo "installer not found at $INSTALLER"; exit 1; }

# Extract the real function chain (prompt_dataset_source calls
# prompt_existing_dataset / prompt_new_dataset_path on some branches).
sed -n '/^prompt_dataset_source() {/,/^}/p' "$INSTALLER" > "$tmp/fn.sh"
sed -n '/^prompt_existing_dataset() {/,/^}/p' "$INSTALLER" >> "$tmp/fn.sh"
sed -n '/^prompt_new_dataset_path() {/,/^}/p' "$INSTALLER" >> "$tmp/fn.sh"

cat > "$tmp/harness.sh" <<EOF
CYAN=""; GREEN=""; YELLOW=""; NC=""
print_success(){ :; }
print_warning(){ :; }
print_info(){ :; }
DATASET_INSTALL_MODE=""
read_calls="$tmp/read_calls"
: > "\$read_calls"
read() { echo "called" >> "\$read_calls"; REPLY=""; return 0; }
source "$tmp/fn.sh"
EOF

run() { bash -c "source '$tmp/harness.sh'; $1"; }

INDEX_URL="https://fgmfiles.spyd.com/datasets/nomad/index.json"

# The menu is detected by a line the function echoes to stdout. NOT by the
# `read -p` prompt text: -p writes to stderr and the read stub drops it, so
# "Select an option" is never observable here.
MENU_MARKER="1) Use existing dataset"

has() { echo "$1" | grep -q "$2"; }   # returns 0 when found

# Capture stdout and the resulting install mode in one run.
out="$(run "FIRESTARR_DATASET_INDEX='$INDEX_URL' prompt_dataset_source; echo \"MODE=\$DATASET_INSTALL_MODE\"")"
calls="$(wc -l < "$tmp/read_calls" | tr -d ' ')"

if has "$out" "$MENU_MARKER"; then r=1; else r=0; fi   # found => assertion fails
expect "source menu is not shown when FIRESTARR_DATASET_INDEX is set" "$r"

if [ "$calls" -eq 2 ]; then r=0; else r=1; fi
expect "only the 2 path prompts remain (download folder, install location) - got $calls" "$r"

if has "$out" "MODE=download"; then r=0; else r=1; fi
expect "DATASET_INSTALL_MODE is 'download' so install_dataset() routes to the year picker" "$r"

# Control: with no index configured, the source menu must still be shown.
: > "$tmp/read_calls"
out_noidx="$(run "FIRESTARR_DATASET_INDEX='' prompt_dataset_source")"
if has "$out_noidx" "$MENU_MARKER"; then r=0; else r=1; fi
expect "source menu is still shown when no index is configured" "$r"
}

# The unattended variant: no `read`, values come from the environment, and the
# dataset paths are REQUIRED rather than defaulted.
check_installer_unattended() { # installer filename
INSTALLER="$TEST_DIR/../$1"
echo "== $1 (unattended)"
[ -f "$INSTALLER" ] || { echo "installer not found at $INSTALLER"; exit 1; }

sed -n '/^prompt_dataset_source() {/,/^}/p' "$INSTALLER" > "$tmp/fn.sh"
sed -n '/^prompt_existing_dataset() {/,/^}/p' "$INSTALLER" >> "$tmp/fn.sh"
sed -n '/^prompt_new_dataset_path() {/,/^}/p' "$INSTALLER" >> "$tmp/fn.sh"
# The real prompt_or_env, not a stub: its required-vs-optional behaviour is what
# replaced the prompts and is therefore the thing under test.
sed -n '/^prompt_or_env() {/,/^}/p' "$INSTALLER" >> "$tmp/fn.sh"

cat > "$tmp/harness.sh" <<EOF
CYAN=""; GREEN=""; YELLOW=""; NC=""
print_success(){ :; }
print_warning(){ :; }
print_info(){ :; }
print_error(){ echo "ERROR: \$1" >&2; }
DATASET_INSTALL_MODE=""
source "$tmp/fn.sh"
EOF

run_u() { bash -c "source '$tmp/harness.sh'; $1" </dev/null; }

INDEX_URL="https://fgmfiles.spyd.com/datasets/nomad/index.json"
MENU_MARKER="1) Use existing dataset"
has() { echo "$1" | grep -q "$2"; }

# 1. Menu still skipped when the index decides the source.
out="$(run_u "FIRESTARR_DATASET_INDEX='$INDEX_URL' prompt_dataset_source" 2>/dev/null)"
if has "$out" "$MENU_MARKER"; then r=1; else r=0; fi
expect "source menu is not shown when FIRESTARR_DATASET_INDEX is set" "$r"

# 2. THE INTENT THE PROMPT COUNT USED TO GUARD. With the paths unset, an
#    unattended run must fail loudly and name the variable - never pick a
#    destination for ~11GB on the operator's behalf.
#    Both keys are checked SEPARATELY. The function fails at the first missing
#    required value, so asserting one name only would pass while the other was
#    silently defaulted - the exact failure this guard exists to prevent.
err="$(run_u "FIRESTARR_DATASET_INDEX='$INDEX_URL' FIRESTARR_DATASET_PATH='' NOMAD_DATASET_DOWNLOAD_DIR='' prompt_dataset_source" 2>&1 >/dev/null)"
if has "$err" "NOMAD_DATASET_DOWNLOAD_DIR"; then r=0; else r=1; fi
expect "unset download folder fails loudly and names NOMAD_DATASET_DOWNLOAD_DIR" "$r"

if has "$err" "unattended"; then r=0; else r=1; fi
expect "the error tells the operator this installer is unattended" "$r"

# With the download folder supplied, the install location must still be required.
err2="$(run_u "FIRESTARR_DATASET_INDEX='$INDEX_URL' NOMAD_DATASET_DOWNLOAD_DIR=/tmp/dl FIRESTARR_DATASET_PATH='' prompt_dataset_source" 2>&1 >/dev/null)"
if has "$err2" "FIRESTARR_DATASET_PATH"; then r=0; else r=1; fi
expect "unset install location fails loudly and names FIRESTARR_DATASET_PATH" "$r"

# 3. Supplied in the environment, it proceeds and routes to the year picker.
out="$(run_u "FIRESTARR_DATASET_INDEX='$INDEX_URL' FIRESTARR_DATASET_PATH=/srv/nomad/data NOMAD_DATASET_DOWNLOAD_DIR=/tmp/dl prompt_dataset_source; echo \"MODE=\$DATASET_INSTALL_MODE\"" 2>/dev/null)"
if has "$out" "MODE=download"; then r=0; else r=1; fi
expect "DATASET_INSTALL_MODE is 'download' so install_dataset() routes to the year picker" "$r"

# 4. Control: with no index configured, the source menu must still be shown.
out_noidx="$(run_u "FIRESTARR_DATASET_INDEX='' prompt_dataset_source" 2>/dev/null)"
if has "$out_noidx" "$MENU_MARKER"; then r=0; else r=1; fi
expect "source menu is still shown when no index is configured" "$r"
}

check_installer install_nomad_setup.sh
check_installer_unattended install-nomad-headless.sh

echo
echo "dataset_index_skip_prompt: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
