#!/usr/bin/env bash
#
# Regression guard: when FIRESTARR_DATASET_INDEX is set, the menu installer's
# own dataset SOURCE menu (prompt_dataset_source, defined in
# install_nomad_setup.sh around lines 484-525, shared verbatim by
# install-nomad-headless.sh) must be SKIPPED - the index decides the source and
# install-firestarr-dataset.sh's year picker (run_year_picker) chooses the
# years. Asking the user to pick a source twice is the bug this guards against.
#
# The PATH prompts must survive: the year picker never asks where the ~50GB
# archive is downloaded or installed, and install-firestarr-dataset.sh exits 1
# if FIRESTARR_DATASET_PATH is unset (load_config, :81-84). Defaulting those
# silently would decide where 50GB lands without telling the user.
#
# Expected behaviour in index mode:
#   - the "Select an option [1-3]" source menu is never shown
#   - exactly 2 prompts remain (download folder, install location)
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

# prompt_dataset_source is duplicated verbatim across both menu installers, so
# both must be guarded - fixing only one leaves the double-prompt alive.
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

check_installer install_nomad_setup.sh
check_installer install-nomad-headless.sh

echo
echo "dataset_index_skip_prompt: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
