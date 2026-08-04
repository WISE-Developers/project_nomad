#!/usr/bin/env bash
#
# ensure_unzip — install unzip when it's missing instead of just refusing.
#
# A fresh Ubuntu 24.04 does not ship unzip, and the fuel dataset installer
# hard-requires it. Telling someone "unzip is required" and exiting sends them
# to a search engine mid-install; we can just install it.
#
# It must still FAIL LOUDLY when it genuinely can't: no known package manager,
# no root, or the install not actually producing a working unzip. Silently
# continuing without unzip would fail later, further from the cause.
#
# Deps: bash 3.x compatible. Exit 0 = all pass.
set -u

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$TEST_DIR/../install-firestarr-dataset.sh"
[ -f "$SCRIPT" ] || { echo "installer not found at $SCRIPT"; exit 1; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

for fn in detect_unzip_installer ensure_unzip; do
  sed -n "/^${fn}() {/,/^}/p" "$SCRIPT" >> "$tmp/fn.sh"
done

# Harness: `command` is overridable as a shell function, which lets us simulate
# which binaries exist without touching the real PATH.
#   HAVE="apt-get sudo"  -> those exist, nothing else does
#   UNZIP_APPEARS=1      -> unzip shows up only AFTER the install runs
make_harness() {
  cat > "$tmp/harness.sh" <<EOF
RED=""; GREEN=""; YELLOW=""; BLUE=""; NC=""
print_error(){ echo "ERROR: \$1"; }
print_success(){ echo "OK: \$1"; }
print_info(){ echo "INFO: \$1"; }
print_step(){ echo "STEP: \$1"; }
print_warning(){ echo "WARN: \$1"; }

HAVE="\${HAVE:-}"
UNZIP_APPEARS="\${UNZIP_APPEARS:-0}"
INSTALL_RAN="$tmp/install_ran"
INSTALL_FAILS="\${INSTALL_FAILS:-0}"
FAKE_UID="\${FAKE_UID:-0}"

command() {
  if [ "\$1" = "-v" ]; then
    local want="\$2"
    if [ "\$want" = "unzip" ] && [ -f "\$INSTALL_RAN" ] && [ "\$UNZIP_APPEARS" = "1" ]; then return 0; fi
    case " \$HAVE " in *" \$want "*) return 0;; *) return 1;; esac
  fi
  builtin command "\$@"
}

id() { [ "\$1" = "-u" ] && echo "\$FAKE_UID"; }

# Stand in for the real package manager: records the invocation.
apt-get(){ echo "\$*" > "\$INSTALL_RAN"; return "\$INSTALL_FAILS"; }
eval_install(){ :; }

source "$tmp/fn.sh"
EOF
}
make_harness

run() { rm -f "$tmp/install_ran"; bash -c "source '$tmp/harness.sh'; $1"; }

pass=0; fail=0
expect_eq() { # desc, expected, actual
  if [ "$2" = "$3" ]; then echo "  ok   - $1"; pass=$((pass+1))
  else echo "  FAIL - $1"; echo "         expected: [$2]"; echo "         actual:   [$3]"; fail=$((fail+1)); fi
}

# ---- detect_unzip_installer maps package managers -------------------------
expect_eq "detects apt-get" "apt-get install -y unzip" \
  "$(run "HAVE='apt-get' detect_unzip_installer")"
expect_eq "detects dnf" "dnf install -y unzip" \
  "$(run "HAVE='dnf' detect_unzip_installer")"
expect_eq "detects apk" "apk add --no-cache unzip" \
  "$(run "HAVE='apk' detect_unzip_installer")"
run "HAVE='' detect_unzip_installer" >/dev/null 2>&1
expect_eq "fails when no package manager is known" "1" "$?"

# ---- ensure_unzip --------------------------------------------------------
run "HAVE='unzip apt-get' ensure_unzip" >/dev/null 2>&1
expect_eq "no-op when unzip is already present" "0" "$?"

expect_eq "does not run an installer when unzip already exists" "no" \
  "$(run "HAVE='unzip apt-get' ensure_unzip >/dev/null 2>&1; [ -f '$tmp/install_ran' ] && echo yes || echo no")"

run "HAVE='apt-get' UNZIP_APPEARS=1 ensure_unzip" >/dev/null 2>&1
expect_eq "installs unzip when missing and a package manager exists" "0" "$?"

run "HAVE='' ensure_unzip" >/dev/null 2>&1
expect_eq "fails loudly when no package manager can install it" "1" "$?"

# Install command reports success but unzip still isn't there — must not lie.
run "HAVE='apt-get' UNZIP_APPEARS=0 ensure_unzip" >/dev/null 2>&1
expect_eq "fails when the install did not actually produce unzip" "1" "$?"

# Non-root with no sudo cannot install.
run "HAVE='apt-get' FAKE_UID=1000 ensure_unzip" >/dev/null 2>&1
expect_eq "fails when not root and sudo is unavailable" "1" "$?"

expect_eq "explains what to do when it cannot install" "yes" \
  "$(run "HAVE='' ensure_unzip 2>&1" | grep -qi 'install unzip' && echo yes || echo no)"

echo
echo "ensure_unzip: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
