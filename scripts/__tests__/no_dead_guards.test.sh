#!/usr/bin/env bash
#
# No installer may define a check_*() guard it never calls (#524).
#
# A guard that cannot fire is worse than no guard, because the next person reads it and
# believes the thing is checked. Two of these were found in the same sweep:
#
#   check_glibc_early()  1 definition, 0 call sites, in BOTH wizards  -> removed under #336
#   check_node_early()   1 definition, 0 call sites, in BOTH wizards  -> this issue
#
# WHY A CLASS CHECK RATHER THAN TWO NAMED ONES. #336 removed the glibc guard by name, and
# the sweep that proved it dead found the Node one standing beside it, untouched, in the
# same two files. Fixing a member is not fixing the class — so this asserts the property
# for every check_*() either wizard defines, and will catch the third one without anybody
# going looking.
#
# WHAT THE FIX WAS, and why it was a deletion rather than a wiring-up: the dead
# check_node_early() enforced `required_major=20`, and the LIVE test inside
# check_metal_deps_early enforces `node_major -lt 20`. Identical floor, so the dead
# function was a true duplicate and deleting it changes nothing an operator experiences.
# Had the two floors DISAGREED, deleting the dead one would have silently moved the
# enforced minimum — which is why this was measured before it was decided.
#
# Deps: bash 3.x (macOS default). Exit 0 = pass, 1 = fail.
set -u

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$TEST_DIR/../.." && pwd)"

pass=0; fail=0
ok()  { echo "  ok   - $1"; pass=$((pass+1)); }
bad() { echo "  FAIL - $1"; fail=$((fail+1)); }

# call_sites <file> <fn>  -> references minus definitions
call_sites() {
  local tot def
  tot="$(grep -c "\b$2\b" "$1")"
  def="$(grep -c "^$2()" "$1")"
  echo "$((tot - def))"
}

SCRIPTS="install_nomad_setup.sh install-nomad-headless.sh install-nomad-san-metal.sh install-nomad-demo.sh"

# ---------------------------------------------------------------------------
# 1. THE PROPERTY, for every check_*() the installers define.
# ---------------------------------------------------------------------------
for n in $SCRIPTS; do
  f="$REPO/scripts/$n"
  [ -f "$f" ] || { bad "not found: scripts/$n"; continue; }

  fns="$(grep -oE '^check_[a-z_]+\(\)' "$f" | tr -d '()' | sort -u)"
  if [ -z "$fns" ]; then
    ok "$n defines no check_*() guards"
    continue
  fi

  dead=""
  for fn in $fns; do
    [ "$(call_sites "$f" "$fn")" -eq 0 ] && dead="$dead $fn"
  done

  if [ -n "$dead" ]; then
    bad "$n defines check_*() guards it never calls:"
    for fn in $dead; do echo "        $fn()"; done
  else
    ok "$n: every check_*() it defines is called ($(echo "$fns" | grep -c .) guards)"
  fi
done

# ---------------------------------------------------------------------------
# 2. CONTROLS. The detector must find a call site that exists and report zero for
#    one that does not — otherwise section 1 passing means only that it never
#    speaks. Both directions, against a fixture whose answer is known.
# ---------------------------------------------------------------------------
PROBE="$(mktemp)"
cat > "$PROBE" <<'PROBE_EOF'
check_called() {
    echo hi
}
check_dead() {
    echo bye
}
check_called_twice() {
    echo thrice
}
main() {
    check_called
    check_called_twice
    check_called_twice
}
PROBE_EOF

if [ "$(call_sites "$PROBE" check_called)" -eq 1 ]; then
  ok "control: detector counts 1 call site for a function called once"
else
  bad "CONTROL FAILED — expected 1 call site, got $(call_sites "$PROBE" check_called)"
fi
if [ "$(call_sites "$PROBE" check_called_twice)" -eq 2 ]; then
  ok "control: detector counts 2 call sites for a function called twice"
else
  bad "CONTROL FAILED — expected 2 call sites, got $(call_sites "$PROBE" check_called_twice)"
fi
if [ "$(call_sites "$PROBE" check_dead)" -eq 0 ]; then
  ok "control: detector reports 0 call sites for an uncalled function"
else
  bad "CONTROL FAILED — an uncalled function reported $(call_sites "$PROBE" check_dead) call sites"
fi
rm -f "$PROBE"

# ---------------------------------------------------------------------------
# 3. NO INDIRECT DISPATCH. Section 1 counts literal references, so a script that
#    invokes functions through a variable or `eval` could hide a call site and make
#    a live guard look dead. Assert that neither wizard does that — if one ever
#    starts, this test must be reconsidered rather than silently trusted.
# ---------------------------------------------------------------------------
for n in install_nomad_setup.sh install-nomad-headless.sh; do
  f="$REPO/scripts/$n"
  [ -f "$f" ] || continue
  # eval lines that look like function dispatch rather than variable expansion
  hits="$(grep -nE 'eval[[:space:]]+"?\$\{?[a-z_]+\}?"?[[:space:]]*$|\$\{?FUNC|declare -f' "$f" || true)"
  if [ -n "$hits" ]; then
    bad "$n may dispatch functions indirectly — section 1's count could be wrong:"
    echo "$hits" | sed 's/^/      /'
  else
    ok "$n has no indirect function dispatch, so literal reference counts are sound"
  fi
done

echo ""
echo "passed: $pass   failed: $fail"
[ "$fail" -eq 0 ]
