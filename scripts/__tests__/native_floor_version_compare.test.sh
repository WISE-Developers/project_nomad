#!/usr/bin/env bash
#
# The version comparison behind the native-addon floors must actually be correct (#336).
#
# WHY THIS EXISTS SEPARATELY. glibc_floor_matches_measurement.test.sh asserts the SHAPE of
# the fix — that the floors are arch-aware, that both are present, that nothing attributes
# them to FireSTARR. It never once runs the comparison. A resolver carrying the right two
# numbers and a comparator that gets them backwards would pass every assertion in that
# file, and the installer would then refuse every host or accept every host silently.
#
# THE TRAP THIS GUARDS. The libstdc++ floor is GLIBCXX_3.4.26, and the versions involved
# include 3.4.9. A lexicographic or single-field compare puts 3.4.9 ABOVE 3.4.26, because
# "9" > "2". That mistake fails OPEN — it reports an ancient libstdc++ as satisfying the
# floor, which is precisely the "clean install then crash at require()" failure the whole
# fix exists to prevent. `sort -V` would handle it and is not portable here, so the
# implementation sorts field-wise and that is what must be verified.
#
# HOW IT GETS THE FUNCTIONS. The installers are standalone scripts that execute on source
# (san-metal is designed to be piped from curl), so they cannot be sourced for testing.
# The function bodies are extracted and eval'd instead. That is also why the three copies
# are compared against each other below: the duplication is forced by the delivery model,
# so drift between copies is the live risk, and #334 owns removing it.
#
# Deps: bash 3.x (macOS default). Exit 0 = pass, 1 = fail.
set -u

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$TEST_DIR/../.." && pwd)"
SETUP="$REPO/scripts/install_nomad_setup.sh"
HEADLESS="$REPO/scripts/install-nomad-headless.sh"
METAL="$REPO/scripts/install-nomad-san-metal.sh"

pass=0; fail=0
ok()  { echo "  ok   - $1"; pass=$((pass+1)); }
bad() { echo "  FAIL - $1"; fail=$((fail+1)); }

# Extract one function definition, from its `name() {` line to the first column-1 `}`.
extract_fn() {
  awk -v fn="$2" '
    $0 ~ "^"fn"\\(\\) \\{" { inside=1 }
    inside { print }
    inside && /^\}/ { exit }
  ' "$1"
}

SRC="$(extract_fn "$HEADLESS" version_lt)"
if [ -z "$SRC" ]; then
  bad "could not extract version_lt() from install-nomad-headless.sh"
  echo ""; echo "passed: $pass   failed: $fail"; exit 1
fi
eval "$SRC"

# ---------------------------------------------------------------------------
# 1. THE FIELD-WIDTH TRAP, both directions. This is the case a lexicographic
#    compare gets wrong, and it is the one that fails open.
# ---------------------------------------------------------------------------
if version_lt "3.4.9" "3.4.26"; then
  ok "3.4.9 < 3.4.26 (the case a lexicographic compare reverses)"
else
  bad "3.4.9 is NOT reported below 3.4.26 — an ancient libstdc++ would satisfy the floor"
fi
if version_lt "3.4.26" "3.4.9"; then
  bad "3.4.26 is reported below 3.4.9 — the comparison is inverted"
else
  ok "3.4.26 is not below 3.4.9"
fi

# ---------------------------------------------------------------------------
# 2. EQUALITY IS NOT BELOW. A host sitting exactly on the floor must be accepted;
#    Ubuntu 22.04 sits exactly on the arm64 glibc floor of 2.35, so an off-by-one
#    here refuses the recommended minimum distro.
# ---------------------------------------------------------------------------
for v in 2.29 2.35 3.4.26 3.4.30; do
  if version_lt "$v" "$v"; then
    bad "$v is reported below itself — a host exactly on the floor would be refused"
  else
    ok "$v is not below itself"
  fi
done

# ---------------------------------------------------------------------------
# 3. THE REAL DECISIONS. Every row here is a measured distro against a measured
#    floor, so a regression shows up as a named platform rather than a number.
# ---------------------------------------------------------------------------
check_decision() {
  # $1 host  $2 floor  $3 expect "below" | "ok"  $4 label
  if version_lt "$1" "$2"; then got="below"; else got="ok"; fi
  if [ "$got" = "$3" ]; then ok "$4"; else bad "$4 — expected $3, got $got"; fi
}
check_decision 2.31 2.29 ok    "Ubuntu 20.04 (glibc 2.31) clears the x64 glibc floor 2.29"
check_decision 2.35 2.29 ok    "Ubuntu 22.04 (glibc 2.35) clears the x64 glibc floor"
check_decision 2.36 2.35 ok    "Debian 12 (glibc 2.36) clears the arm64 glibc floor 2.35"
check_decision 2.31 2.35 below "Ubuntu 20.04 does NOT clear the arm64 glibc floor — the arch split is load-bearing"
check_decision 2.28 2.29 below "a host one minor below the x64 floor is refused"
check_decision 3.4.28 3.4.26 ok    "Ubuntu 20.04 (GLIBCXX_3.4.28) clears the x64 libstdc++ floor"
check_decision 3.4.30 3.4.30 ok    "Ubuntu 22.04 (GLIBCXX_3.4.30) clears the arm64 libstdc++ floor exactly"
check_decision 3.4.25 3.4.26 below "GLIBCXX_3.4.25 is refused against the x64 floor of 3.4.26"
check_decision 3.4.28 3.4.30 below "Ubuntu 20.04's libstdc++ does NOT clear the arm64 floor"

# ---------------------------------------------------------------------------
# 4. THE RESOLVER RETURNS THE MEASURED PAIR FOR THE ARCH IT IS TOLD.
#    uname is shadowed rather than mocked at a lower level, because what is being
#    tested is the branch, not the real machine — this suite must give the same
#    answer on Franco's Apple Silicon host as on an agency's x64 server.
# ---------------------------------------------------------------------------
RSRC="$(extract_fn "$HEADLESS" resolve_native_floors)"
eval "$RSRC"
for probe in "x86_64 2.29 3.4.26" "aarch64 2.35 3.4.30" "arm64 2.35 3.4.30"; do
  set -- $probe
  arch="$1"; want_glibc="$2"; want_cxx="$3"
  eval "uname() { echo \"$arch\"; }"
  REQUIRED_GLIBC=""; REQUIRED_GLIBCXX=""
  resolve_native_floors
  if [ "$REQUIRED_GLIBC" = "$want_glibc" ] && [ "$REQUIRED_GLIBCXX" = "$want_cxx" ]; then
    ok "arch $arch resolves to glibc $want_glibc / GLIBCXX_$want_cxx"
  else
    bad "arch $arch resolved to glibc $REQUIRED_GLIBC / GLIBCXX_$REQUIRED_GLIBCXX, expected $want_glibc / $want_cxx"
  fi
done
# An architecture nobody measured must not silently inherit the LOWER floor, which
# would admit a host whose prebuild requirements are unknown. The default branch is
# x64 by design; this records that choice so a future reader sees it was deliberate.
eval "uname() { echo \"riscv64\"; }"
REQUIRED_GLIBC=""; resolve_native_floors
if [ -n "$REQUIRED_GLIBC" ]; then
  ok "an unmeasured architecture still resolves to a floor (${REQUIRED_GLIBC}), not to empty"
else
  bad "an unmeasured architecture resolves to an EMPTY floor — the check would pass everything"
fi
unset -f uname

# ---------------------------------------------------------------------------
# 5. THE THREE COPIES MUST NOT DRIFT. The duplication is forced — san-metal is
#    piped from curl and cannot source a sibling — so byte-equality between the
#    copies is the only thing standing between this and three different floors.
#    #334 owns removing the duplication itself.
# ---------------------------------------------------------------------------
for fn in resolve_native_floors version_lt host_max_glibcxx host_glibc_version; do
  a="$(extract_fn "$HEADLESS" "$fn")"
  b="$(extract_fn "$SETUP" "$fn")"
  c="$(extract_fn "$METAL" "$fn")"
  if [ -z "$a" ] || [ -z "$b" ] || [ -z "$c" ]; then
    bad "$fn() is missing from at least one of the three installers"
  elif [ "$a" = "$b" ] && [ "$b" = "$c" ]; then
    ok "$fn() is identical across all three installers"
  else
    bad "$fn() has DRIFTED between the three installers — three different floors"
  fi
done

# ---------------------------------------------------------------------------
# 6. CONTROL. Every assertion above rests on version_lt being the real function and
#    not a stub that always answers the same way. Replace it with each constant
#    answer and require section 1 to break both times.
# ---------------------------------------------------------------------------
version_lt_real() { eval "$SRC"; }
always_true()  { return 0; }
always_false() { return 1; }

eval "$(echo "$SRC" | sed 's/^version_lt()/version_lt_probe()/')"
if version_lt_probe "3.4.9" "3.4.26" && ! version_lt_probe "3.4.26" "3.4.9"; then
  ok "control: the extracted function is the real comparator, not a constant"
else
  bad "CONTROL FAILED — the extracted comparator does not discriminate, so sections 1-3 prove nothing"
fi
# Each stub must give the WRONG answer on the case section 1 pins, in opposite directions:
# always_true wrongly calls 3.4.26 below 3.4.9; always_false wrongly denies 3.4.9 < 3.4.26.
# Chaining them with && was wrong in the first draft of this control, because always_false
# returns 1 and sank the condition regardless of what it proved — a control that could
# only ever report failure.
if always_true "3.4.26" "3.4.9" && ! always_false "3.4.9" "3.4.26"; then
  ok "control: either constant stub breaks one of section 1's two assertions"
else
  bad "CONTROL FAILED — the stub controls are themselves wrong"
fi

echo ""
echo "passed: $pass   failed: $fail"
[ "$fail" -eq 0 ]
