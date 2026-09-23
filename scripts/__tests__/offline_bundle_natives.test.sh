#!/usr/bin/env bash
#
# Offline bundle: native modules must match the Node we ship (refs #318).
#
# This is the highest-risk part of the whole ticket, and the reason is the
# failure location rather than the failure itself.
#
# `better-sqlite3` and `gdal-async` are compiled native addons. A prebuilt
# addon is valid only for one Node ABI on one platform and architecture. If we
# bundle Node 22 (ABI 127) and an addon built for a different ABI, nothing
# fails at build time -- the file is present, the right size, and the bundle
# looks complete. It fails when the practitioner runs it, on a laptop, at an
# incident, with no network to fetch a replacement and no way to interpret the
# error.
#
# So the thing worth testing is not "did we download something" but "is what
# we downloaded the thing this bundle's Node can actually load".
#
# The specific trap: NODE_VERSION and the ABI are two numbers that must move
# together and look nothing alike. Node 22 is ABI 127, Node 24 is not. Someone
# bumping NODE_VERSION to a newer major -- entirely reasonable, and we already
# have a live suggestion to move to Node 24 -- would leave the ABI behind, and
# every prebuild would then be silently wrong. Hence the builder derives the
# ABI from the version rather than carrying an unrelated constant, and this
# suite checks the two agree.
#
# Runs offline: functions are extracted and called directly, no downloads.
#
# Deps: bash 3.x compatible (macOS ships 3.2). Exit 0 = all pass.

set -u

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILDER="$TEST_DIR/../build-offline-bundle.sh"

pass=0
fail=0

ok()  { pass=$((pass + 1)); echo "    ok   $1"; }
bad() { fail=$((fail + 1)); echo "  FAIL   $1"; [ $# -gt 1 ] && echo "         $2"; }

[ -f "$BUILDER" ] || { echo "builder not found at $BUILDER"; exit 1; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# ---------------------------------------------------------------------------
# The ABI must be derived, not carried as a loose constant beside the version.
# ---------------------------------------------------------------------------
sed -n '/^node_abi_for() {/,/^}/p' "$BUILDER" > "$tmp/fn.sh"

if [ ! -s "$tmp/fn.sh" ]; then
  bad "builder defines node_abi_for()" \
      "the Node ABI must be derived from NODE_VERSION; a constant beside it goes stale the moment someone bumps the major"
  echo
  echo "offline_bundle_natives: $pass passed, $fail failed"
  exit 1
fi
ok "builder defines node_abi_for()"

cat > "$tmp/harness.sh" <<HARNESS
info() { :; }
die()  { echo "die: \$*" >&2; exit 1; }
source "$tmp/fn.sh"
HARNESS

abi_of() { bash -c "source '$tmp/harness.sh'; node_abi_for '$1'" 2>/dev/null; }

# Known-good mappings. These are facts about Node, verified against
# nodejs.org/dist/index.json, not preferences.
for pair in "v22.23.2:127" "v22.12.0:127" "v20.11.0:115"; do
  ver="${pair%%:*}"; want="${pair#*:}"
  got="$(abi_of "$ver")"
  if [ "$got" = "$want" ]; then
    ok "node_abi_for($ver) = $want"
  else
    bad "node_abi_for($ver) = $want" "got '${got:-<nothing>}'"
  fi
done

# An unknown major must stop the build, not guess. Guessing here produces a
# bundle that cannot load its own database driver.
if bash -c "source '$tmp/harness.sh'; node_abi_for 'v99.0.0'" >/dev/null 2>&1; then
  bad "an unknown Node major is fatal" \
      "node_abi_for accepted v99.0.0 -- a guessed ABI ships addons Node cannot load"
else
  ok "an unknown Node major is fatal"
fi

# ---------------------------------------------------------------------------
# The declared NODE_VERSION and whatever ABI the builder will use must agree.
# This is the assertion that catches a Node major bump.
# ---------------------------------------------------------------------------
declared_version="$(grep -E '^readonly NODE_VERSION=' "$BUILDER" | head -1 | cut -d'"' -f2)"
if [ -n "$declared_version" ]; then
  derived="$(abi_of "$declared_version")"
  if [ -n "$derived" ]; then
    ok "pinned $declared_version resolves to ABI $derived"
  else
    bad "pinned $declared_version resolves to an ABI" \
        "node_abi_for does not know this major -- prebuilds cannot be selected"
  fi
else
  bad "NODE_VERSION is declared" "cannot cross-check the ABI without it"
fi

# ---------------------------------------------------------------------------
# Both native packages pinned by explicit version.
# ---------------------------------------------------------------------------
for spec in "BETTER_SQLITE3_VERSION:better-sqlite3" "GDAL_ASYNC_VERSION:gdal-async"; do
  var="${spec%%:*}"; what="${spec#*:}"
  if grep -qE "^[[:space:]]*(readonly[[:space:]]+)?${var}=" "$BUILDER"; then
    ok "$what pinned via \$$var"
  else
    bad "$what pinned via \$$var" "an unpinned native addon is an unreproducible bundle"
  fi
done

# ---------------------------------------------------------------------------
# Prebuild asset names must be composed from the target's ABI/platform/arch.
#
# A literal ABI or a build-host platform in an asset name is the exact bug this
# suite exists for: it would download a real, valid, checksummable addon that
# the bundled Node cannot load.
# ---------------------------------------------------------------------------
offenders="$(grep -nE '(node-v1[0-9][0-9]-|-v1[0-9][0-9]-(win32|linux|darwin))' "$BUILDER" \
             | grep -v '^[0-9]*:[[:space:]]*#' | grep -v 'node_abi_for' || true)"
if [ -z "$offenders" ]; then
  ok "no hardcoded ABI in prebuild asset names"
else
  bad "no hardcoded ABI in prebuild asset names" \
      "$(echo "$offenders" | head -2 | tr '\n' ' ')"
fi

if grep -qE 'darwin-arm64.*better-sqlite3|better-sqlite3.*\$\(uname' "$BUILDER"; then
  bad "prebuilds are selected for the TARGET, not the build host"
else
  ok "prebuilds are selected for the TARGET, not the build host"
fi

# ---------------------------------------------------------------------------
# Verified like every other input. Both projects publish digests.
# ---------------------------------------------------------------------------
natives_block="$(sed -n '/^fetch_natives() {/,/^}/p' "$BUILDER" 2>/dev/null || true)"
if [ -z "$natives_block" ]; then
  bad "builder defines fetch_natives()" "nothing acquires the native addons"
elif echo "$natives_block" | grep -qE 'verify_sha256|digest'; then
  ok "native addons are checksum-verified"
else
  bad "native addons are checksum-verified" \
      "an unverified addon is indistinguishable from a corrupted one until it fails to load offline"
fi

echo
echo "offline_bundle_natives: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
