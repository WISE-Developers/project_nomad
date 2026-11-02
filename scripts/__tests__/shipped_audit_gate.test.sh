#!/usr/bin/env bash
#
# The shipped-tree advisory gate (#499).
#
# WHY THIS GATE EXISTS. The per-package currency tests guard six packages with
# hand-typed ceilings. Two of them went stale and each hid a live advisory:
# betterAuthCurrency sat at 1.6.21 through a CRITICAL auth bypass, and
# multerCurrency sat at 2.2.0 -- BELOW the installed version -- over a live
# HIGH. A ceiling that must be remembered is a guard that stops guarding.
#
# WHY IT USES THE IMAGE'S OWN FLAGS. "What ships" is not `npm audit`, and it is
# not `npm audit --omit=dev` either: that still reports vite and vitest, which
# are provably absent from the image, because --omit=dev drops only entries
# flagged `dev` and a devOptional entry survives it. backend/Dockerfile prunes
# with --omit=dev --omit=peer --omit=optional, so the gate uses exactly those
# three. Sharing the definition is the point; inventing a second one is how the
# two measurements drift apart.
#
# WHY THE TEST USES FIXTURES. The gate queries the live advisory database. A
# test that did the same would change its verdict when the world changed, which
# makes it a measurement of npm rather than of the gate. Every case here feeds
# the gate a recorded audit document.
#
# Deps: bash 3.x, node. Exit 0 = all pass.
set -u

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$TEST_DIR/../.." && pwd)"
GATE="$REPO_ROOT/scripts/audit-shipped-tree.mjs"

pass=0; fail=0
ok()  { echo "  ok   - $1"; pass=$((pass+1)); }
bad() { echo "  FAIL - $1"; fail=$((fail+1)); }

if [ ! -f "$GATE" ]; then
  echo "  FAIL - scripts/audit-shipped-tree.mjs does not exist"
  echo ""
  echo "passed: 0   failed: 1"
  exit 1
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

mkaudit() { # mkaudit <file> <name:severity:range> ...
  local out="$1"; shift
  local first=1
  { printf '{"vulnerabilities":{'
    for spec in "$@"; do
      local n="${spec%%:*}"; local rest="${spec#*:}"
      local sev="${rest%%:*}"; local range="${rest#*:}"
      [ $first -eq 1 ] || printf ','
      first=0
      printf '"%s":{"name":"%s","severity":"%s","range":"%s","via":[{"title":"t","url":"u"}]}' "$n" "$n" "$sev" "$range"
    done
    printf '},"metadata":{"vulnerabilities":{"critical":0,"high":0,"moderate":0,"low":0,"info":0,"total":0}}}'
  } > "$out"
}

mkallow() { # mkallow <file> <json-body>
  printf '%s\n' "$2" > "$1"
}

run() { # run <audit> <allowlist> -> exit code
  node "$GATE" --input "$1" --allowlist "$2" >"$WORK/out.txt" 2>&1
  echo $?
}

# ---------------------------------------------------------------------------
# 1. An unallowlisted CRITICAL must fail the build.
# ---------------------------------------------------------------------------
mkaudit "$WORK/a1.json" "tar:critical:<=7.5.20"
mkallow "$WORK/empty.json" '{"allow":[]}'
if [ "$(run "$WORK/a1.json" "$WORK/empty.json")" != "0" ]; then
  ok "fails on an unallowlisted critical"
else
  bad "passed with an unallowlisted critical"
fi
grep -q "tar" "$WORK/out.txt" && ok "names the offending package" || bad "did not name the package"

# ---------------------------------------------------------------------------
# 2. THE CONTROL. A clean audit must PASS, or case 1 proves nothing.
# ---------------------------------------------------------------------------
mkaudit "$WORK/a2.json"
if [ "$(run "$WORK/a2.json" "$WORK/empty.json")" = "0" ]; then
  ok "passes on a clean tree (control)"
else
  bad "failed on a clean tree — the gate cannot pass"
fi

# ---------------------------------------------------------------------------
# 3. Moderates are below the threshold and must not fail the build.
# ---------------------------------------------------------------------------
mkaudit "$WORK/a3.json" "qs:moderate:6.7.0 - 6.16.0" "glob:moderate:*"
if [ "$(run "$WORK/a3.json" "$WORK/empty.json")" = "0" ]; then
  ok "moderates do not fail the build"
else
  bad "a moderate failed the build — threshold is critical/high"
fi

# ---------------------------------------------------------------------------
# 4. An allowlisted critical passes — but ONLY with a reason.
# ---------------------------------------------------------------------------
mkallow "$WORK/allow_tar.json" '{"allow":[{"package":"tar","reason":"bundled inside gdal-async; overrides cannot reach it","review_by":"2099-01-01"}]}'
if [ "$(run "$WORK/a1.json" "$WORK/allow_tar.json")" = "0" ]; then
  ok "an allowlisted critical with a reason passes"
else
  bad "allowlist did not take effect"
fi

mkallow "$WORK/allow_noreason.json" '{"allow":[{"package":"tar"}]}'
if [ "$(run "$WORK/a1.json" "$WORK/allow_noreason.json")" != "0" ]; then
  ok "an allowlist entry with no reason is rejected"
else
  bad "accepted an allowlist entry with no reason — the exception would be unexplained"
fi

# ---------------------------------------------------------------------------
# 5. A STALE ALLOWLIST MUST BE REPORTED.
#
# This is the whole lesson of #499 pointed at the gate itself. An allowlist is a
# hand-maintained exception, which is the same thing as a hand-maintained
# ceiling: it outlives the advisory it was written for and nothing says so. An
# entry matching nothing in the audit is reported, so the exception cannot
# quietly become permanent.
# ---------------------------------------------------------------------------
mkallow "$WORK/allow_stale.json" '{"allow":[{"package":"left-pad","reason":"gone upstream","review_by":"2099-01-01"}]}'
run "$WORK/a2.json" "$WORK/allow_stale.json" >/dev/null
if grep -qi "stale\|no longer\|matches nothing\|unused" "$WORK/out.txt"; then
  ok "reports an allowlist entry that no longer matches any advisory"
else
  bad "a stale allowlist entry passed unmentioned"
fi

# ---------------------------------------------------------------------------
# 6. An expired review date must fail, so an exception cannot be permanent by
#    inattention.
# ---------------------------------------------------------------------------
mkallow "$WORK/allow_expired.json" '{"allow":[{"package":"tar","reason":"upstream","review_by":"2000-01-01"}]}'
if [ "$(run "$WORK/a1.json" "$WORK/allow_expired.json")" != "0" ]; then
  ok "an expired allowlist entry stops suppressing"
else
  bad "an expired entry still suppressed the finding"
fi

# ---------------------------------------------------------------------------
# 7. The gate must use the image's own omit flags, not a second definition.
# ---------------------------------------------------------------------------
if grep -q -- "--omit=dev" "$GATE" && grep -q -- "--omit=peer" "$GATE" && grep -q -- "--omit=optional" "$GATE"; then
  ok "invokes npm audit with the Dockerfile's three omit flags"
else
  bad "does not use --omit=dev --omit=peer --omit=optional — it would measure a different tree than ships"
fi

# The repo's real allowlist must exist and parse, with a reason on every entry.
REAL="$REPO_ROOT/.audit-allowlist.json"
if [ -f "$REAL" ]; then
  if node -e "
const a=require('$REAL');
if(!Array.isArray(a.allow)) process.exit(1);
for(const e of a.allow){ if(!e.package||!e.reason||!e.review_by) process.exit(1); }
" 2>/dev/null; then
    ok "the committed allowlist parses and every entry has package, reason and review_by"
  else
    bad "the committed allowlist is malformed or an entry lacks a reason/review_by"
  fi
else
  bad ".audit-allowlist.json does not exist"
fi

echo ""
echo "passed: $pass   failed: $fail"
[ "$fail" -eq 0 ]
