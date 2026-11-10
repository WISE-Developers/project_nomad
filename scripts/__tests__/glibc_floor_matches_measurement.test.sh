#!/usr/bin/env bash
#
# The host-compatibility checks must gate on the artifact that actually constrains the
# host, at the version it actually requires, on the architecture it is running (#336).
#
# WHAT WAS WRONG. Five checks across three scripts, plus a published doc, all commented
# "for FireSTARR binary compatibility", each refusing hosts on a glibc threshold:
#
#   install_nomad_setup.sh:306     2.38  "need Ubuntu 24.04+"   live, in check_metal_deps_early
#   install_nomad_setup.sh:403     2.34                         DEAD — check_glibc_early uncalled
#   install-nomad-headless.sh:300  2.34  "need Ubuntu 22.04+"   live, in check_metal_deps_early
#   install-nomad-headless.sh:397  2.34                         DEAD — check_glibc_early uncalled
#   install-nomad-san-metal.sh:168 2.34                         live
#   NOMAD_REQUIREMENTS.md:64       2.34  "Ubuntu 22.04+"        published
#
# FIRESTARR IMPOSES NOTHING. The release artifact
# firestarr-ubuntu-x64-gcc-Release.tar.gz (v0.9.29) is statically linked: 0 NEEDED
# entries, 0 versioned GLIBC_ references, no .interp section — measured against a control
# in the same command that reported 5 and 85 on a known-dynamic binary. A host on glibc
# 2.17 would run it. So every one of those thresholds was attributed to an artifact that
# does not constrain it, and neither 2.34 nor 2.38 had a measured basis.
#
# WHAT DOES CONSTRAIN THE HOST is gdal-async's prebuild. It installs prebuild-first
# (node-pre-gyp install --fallback-to-build), the prebuild exists for Nomad's ABI, and it
# is bit-for-bit the artifact already inside the published image — identical sha256, with
# a control that differs. Its requirements, read by two independent toolchains:
#
#   x86_64   GLIBC_2.29   GLIBCXX_3.4.26
#   aarch64  GLIBC_2.35   GLIBCXX_3.4.30
#
# TWO CONSEQUENCES THIS TEST ENFORCES.
#
# 1. THE FLOOR IS ARCHITECTURE-DEPENDENT. Six minor versions separate the two prebuilds.
#    A single hard-coded number cannot serve both: 2.35 refuses working x64 hosts, 2.29
#    admits arm64 hosts that then fail to load the addon.
#
# 2. THE CHECK THAT MATTERS DID NOT EXIST. GLIBCXX_3.4.26 is a libstdc++/GCC version. No
#    script tested it and a glibc-only gate cannot see it, so a host could pass every
#    check and still die at require('gdal-async') — a crash after a successful install,
#    which is the exact failure mode the old thresholds were defended as preventing.
#
# WHY THIS IS A SHELL TEST: installer prerequisite logic is not reachable from vitest, and
# a threshold that is only checked by reading it is not checked. CI runs
# scripts/__tests__/*.test.sh as a loop (tests.yml).
#
# MEASUREMENT, not recollection: Documentation/plans/336-glibc-floor.md in sage_workspace
# carries every command and its controls, including the two corrections it forced — the
# published image DOES ship objdump, and the path the original command read does not
# exist, which is what produced an earlier empty result that read as "no requirements".
#
# Deps: bash 3.x (macOS default). Exit 0 = pass, 1 = fail.
set -u

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$TEST_DIR/../.." && pwd)"
SETUP="$REPO/scripts/install_nomad_setup.sh"
HEADLESS="$REPO/scripts/install-nomad-headless.sh"
METAL="$REPO/scripts/install-nomad-san-metal.sh"
DOC="$REPO/NOMAD_REQUIREMENTS.md"

# The measured floors. If a future gdal-async bump moves these, this test is the thing
# that should fail — that is the point of writing them down here.
X64_GLIBC="2.29"
X64_GLIBCXX="3.4.26"
ARM_GLIBC="2.35"
ARM_GLIBCXX="3.4.30"

# The discredited numbers. Neither may appear as a threshold anywhere.
STALE_A="2.34"
STALE_B="2.38"

pass=0; fail=0
ok()  { echo "  ok   - $1"; pass=$((pass+1)); }
bad() { echo "  FAIL - $1"; fail=$((fail+1)); }

for f in "$SETUP" "$HEADLESS" "$METAL" "$DOC"; do
  [ -f "$f" ] || { bad "not found: $f"; echo ""; echo "passed: $pass   failed: $fail"; exit 1; }
done

SCRIPTS="$SETUP $HEADLESS $METAL"

# Does this script gate the host on glibc at all?
#
# THIS DELIBERATELY DOES NOT MATCH THE OLD SPELLING. The first draft asked for a numeric
# `-lt 34` or a `required_version=` assignment — the exact lines the fix removes. So the
# moment the fix landed, sections 2 and 3 would have found nothing to check, skipped
# themselves, and gone green while asserting nothing: a gate that stops firing precisely
# when the code it guards changes. It now matches the ACT of reading the host's glibc,
# which any correct implementation must still do.
gates_on_glibc() {
  grep -qE 'ldd --version|REQUIRED_GLIBC' "$1"
}

# ---------------------------------------------------------------------------
# 1. THE DISCREDITED NUMBERS ARE GONE. 2.34 and 2.38 were attributed to a static
#    binary; neither may survive as a threshold in any script.
# ---------------------------------------------------------------------------
for f in $SCRIPTS; do
  n="$(basename "$f")"
  hits="$(grep -nE "(-lt[[:space:]]+(34|38))|required_version=\"?(2\.34|2\.38)" "$f" || true)"
  if [ -n "$hits" ]; then
    bad "$n still carries a discredited threshold ($STALE_A / $STALE_B):"
    echo "$hits" | sed 's/^/      /'
  else
    ok "$n carries neither $STALE_A nor $STALE_B as a threshold"
  fi
done

# ---------------------------------------------------------------------------
# 2. THE FLOOR IS ARCH-AWARE, AND THE ARCH BRANCH IS WHERE THE FLOOR IS SET.
#
#    WHY THIS IS SCOPED TO ONE FUNCTION. The first draft of this section asked
#    whether the FILE mentioned `uname -m` or `arm64` anywhere, and it went GREEN
#    on all three scripts while every one of them still hard-coded a single glibc
#    number — because they already name arm64 when selecting a container image.
#    It tested a true proposition one step beside the task. So the assertion is
#    now: a function named resolve_native_floors() exists, and BOTH floors and the
#    architecture read live INSIDE it.
# ---------------------------------------------------------------------------
RESOLVER="resolve_native_floors"

# Print the body of a shell function: from its definition line to the first line
# that is a bare closing brace in column 1.
fn_body() {
  awk -v fn="$2" '
    $0 ~ "^"fn"\\(\\)" { inside=1 }
    inside { print }
    inside && /^\}/ { exit }
  ' "$1"
}

for f in $SCRIPTS; do
  n="$(basename "$f")"
  if ! gates_on_glibc "$f"; then
    ok "$n has no glibc threshold to make arch-aware"
    continue
  fi
  body="$(fn_body "$f" "$RESOLVER")"
  if [ -z "$body" ]; then
    bad "$n gates on glibc but defines no $RESOLVER() — the floor cannot be arch-aware"
    continue
  fi
  if echo "$body" | grep -qE 'uname -m'; then
    ok "$n: $RESOLVER() reads the machine architecture"
  else
    bad "$n: $RESOLVER() never reads uname -m — one number cannot serve both prebuilds"
  fi
  if echo "$body" | grep -q "$X64_GLIBC" && echo "$body" | grep -q "$ARM_GLIBC"; then
    ok "$n: $RESOLVER() carries both measured glibc floors ($X64_GLIBC x64 / $ARM_GLIBC arm64)"
  else
    bad "$n: $RESOLVER() does not carry both measured glibc floors ($X64_GLIBC and $ARM_GLIBC)"
  fi
  # And it must actually be called, or it is section 4's dead guard wearing a new name.
  tot="$(grep -c "\b$RESOLVER\b" "$f")"
  def="$(grep -c "^$RESOLVER()" "$f")"
  if [ "$((tot - def))" -gt 0 ]; then
    ok "$n: $RESOLVER() is called"
  else
    bad "$n: $RESOLVER() is defined and never called — a floor nothing resolves"
  fi
done

# ---------------------------------------------------------------------------
# 3. THE CHECK THAT DID NOT EXIST. GLIBCXX is what actually breaks require() on a
#    host that satisfies glibc, so every script that checks glibc must check it too —
#    and both floors must sit inside the resolver, for the same reason as section 2.
# ---------------------------------------------------------------------------
for f in $SCRIPTS; do
  n="$(basename "$f")"
  if ! gates_on_glibc "$f"; then continue; fi
  body="$(fn_body "$f" "$RESOLVER")"
  if echo "$body" | grep -q "$X64_GLIBCXX" && echo "$body" | grep -q "$ARM_GLIBCXX"; then
    ok "$n: $RESOLVER() carries both measured libstdc++ floors ($X64_GLIBCXX / $ARM_GLIBCXX)"
  else
    bad "$n checks glibc but not GLIBCXX — a host can pass and still fail at require('gdal-async')"
  fi
  # The floor is useless unless something compares against it.
  if grep -qE 'GLIBCXX' "$f"; then
    ok "$n compares a libstdc++ version against the floor"
  else
    bad "$n names no GLIBCXX symbol at all — nothing reads the libstdc++ floor"
  fi
done

# ---------------------------------------------------------------------------
# 4. NO DEAD GLIBC GUARD. A function defined and never called has never rejected
#    anything. check_glibc_early() was dead in BOTH wizards — 1 definition and 0 call
#    sites each, measured with check_metal_deps_early() as the positive control, which
#    resolves to 1 and 1. Giving it a corrected number would have left it just as dead.
#
#    SCOPED DELIBERATELY TO THE GLIBC GUARD. Writing this test also found
#    check_node_early() dead in both wizards, which is a real bug and is filed as its
#    own issue — deleting it here would be work nobody asked for, and #336 is the glibc
#    checks. This section therefore names the glibc guard rather than sweeping check_*.
# ---------------------------------------------------------------------------
for f in $SETUP $HEADLESS; do
  n="$(basename "$f")"
  for fn in check_glibc_early $RESOLVER; do
    def="$(grep -c "^$fn()" "$f")"
    [ "$def" -eq 0 ] && continue
    tot="$(grep -c "\b$fn\b" "$f")"
    if [ "$((tot - def))" -eq 0 ]; then
      bad "$n defines $fn() and never calls it — a guard that cannot fire"
    else
      ok "$n: $fn() is defined and called"
    fi
  done
  if [ "$(grep -c '^check_glibc_early()' "$f")" -eq 0 ]; then
    ok "$n: the dead check_glibc_early() is gone rather than renumbered"
  fi
done

# ---------------------------------------------------------------------------
# 5. THE ATTRIBUTION. FireSTARR is statically linked. No glibc REQUIREMENT may be
#    attributed to it, or the next person re-derives the wrong floor from the comment —
#    which is exactly how 2.34 and 2.38 came to be defended.
#
#    This matches requirement CLAIMS, not every mention of the two words together: a
#    comment explaining that FireSTARR imposes no glibc floor is the correction, and a
#    detector that forbade it would forbid the fix.
# ---------------------------------------------------------------------------
for f in $SCRIPTS; do
  n="$(basename "$f")"
  hits="$(grep -niE 'required for FireSTARR|FireSTARR binary requires|glibc version for FireSTARR|FireSTARR[^.]*requires glibc' "$f" || true)"
  if [ -n "$hits" ]; then
    bad "$n still attributes a glibc requirement to FireSTARR, which imposes none:"
    echo "$hits" | sed 's/^/      /'
  else
    ok "$n does not attribute a glibc requirement to FireSTARR"
  fi
done

# ---------------------------------------------------------------------------
# 6. THE PUBLISHED DOC. NOMAD_REQUIREMENTS.md is what an agency reads before
#    provisioning. A doc stating a threshold the scripts no longer enforce is worse
#    than no doc, because it is believed.
# ---------------------------------------------------------------------------
if grep -qE "glibc[^|]*($STALE_A|$STALE_B)" "$DOC"; then
  bad "NOMAD_REQUIREMENTS.md still publishes a discredited glibc threshold"
  grep -nE "glibc[^|]*($STALE_A|$STALE_B)" "$DOC" | sed 's/^/      /'
else
  ok "NOMAD_REQUIREMENTS.md publishes no discredited glibc threshold"
fi
if grep -q "$X64_GLIBC" "$DOC" && grep -q "$X64_GLIBCXX" "$DOC"; then
  ok "NOMAD_REQUIREMENTS.md publishes the measured floors, glibc and libstdc++ both"
else
  bad "NOMAD_REQUIREMENTS.md does not publish both measured floors ($X64_GLIBC, $X64_GLIBCXX)"
fi

# ---------------------------------------------------------------------------
# 7. CONTROLS. A detector that cannot fire proves nothing, and one that fires on
#    everything proves less. Run section 1's detector against the exact line this
#    issue removed, and against a line it must leave alone.
# ---------------------------------------------------------------------------
PROBE="$(mktemp)"
cat > "$PROBE" <<'PROBE_EOF'
            if [ "$glibc_major" -lt 2 ] || { [ "$glibc_major" -eq 2 ] && [ "$glibc_minor" -lt 38 ]; }; then
                missing+=("glibc >= 2.38 (found: $glibc_version) - need Ubuntu 24.04+")
PROBE_EOF
if grep -qE "(-lt[[:space:]]+(34|38))|required_version=\"?(2\.34|2\.38)" "$PROBE"; then
  ok "control: the detector catches install_nomad_setup.sh's original 2.38 line"
else
  bad "CONTROL FAILED — the detector misses the original line, so section 1 proves nothing"
fi

PROBE2="$(mktemp)"
cat > "$PROBE2" <<'PROBE2_EOF'
    if [ "$node_major" -lt 20 ]; then
        missing+=("Node.js >= 20")
    fi
PROBE2_EOF
if grep -qE "(-lt[[:space:]]+(34|38))|required_version=\"?(2\.34|2\.38)" "$PROBE2"; then
  bad "CONTROL FAILED — the detector flags the unrelated Node.js major check"
else
  ok "control: the unrelated Node.js version check is not flagged"
fi

# And a control on the dead-guard detector itself: it must find a call site that exists.
PROBE3="$(mktemp)"
cat > "$PROBE3" <<'PROBE3_EOF'
check_called() {
    echo hi
}
check_dead() {
    echo bye
}
check_called
PROBE3_EOF
dead_found=0
for fn in $(grep -oE '^check_[a-z_]+\(\)' "$PROBE3" | tr -d '()'); do
  tot="$(grep -c "\b$fn\b" "$PROBE3")"; def="$(grep -c "^$fn()" "$PROBE3")"
  [ "$((tot - def))" -eq 0 ] && dead_found=$((dead_found+1))
done
if [ "$dead_found" -eq 1 ]; then
  ok "control: the dead-guard detector finds exactly the one uncalled function, not both"
else
  bad "CONTROL FAILED — dead-guard detector found $dead_found uncalled of a known 1, so section 4 proves nothing"
fi
rm -f "$PROBE" "$PROBE2" "$PROBE3"

echo ""
echo "passed: $pass   failed: $fail"
[ "$fail" -eq 0 ]
