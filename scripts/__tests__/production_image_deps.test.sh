#!/usr/bin/env bash
#
# The production image must not ship the development dependency tree (refs #382).
#
# Measured on the built image before this was fixed: /app/node_modules was
# 850 MB and 448 packages, and contained tar 7.5.13, vitest 2.1.9, typescript
# 5.9.3 and eslint 9.39.4. Two of those carry CRITICAL advisories.
#
# The cause was three lines with no subtlety: the builder ran `npm ci` with no
# --omit=dev, the production stage copied node_modules wholesale, and nothing
# pruned afterwards.
#
# Why it matters more than image size: a scanner pointed at the image reports
# every advisory in the dev tree, not just what the runtime can reach. A green
# scan is unobtainable by fixing runtime dependencies alone, and each CRITICAL
# that surfaces this way costs someone an investigation into a package we never
# intended to ship. #375 set vitest aside as "a devDependency, so it should not
# reach a production image" -- that reasoning was wrong about the image.
#
# The builder stage legitimately needs devDependencies: typescript compiles the
# backend. So the fix is not to strip the builder, but for production to take
# its node_modules from a stage that installed production dependencies only.
#
# THE TRAP, and the reason this suite checks for an explicit removal as well as
# the flag: --omit=dev is NOT sufficient on its own. vitest is an optional PEER
# dependency of better-auth, npm resolves peers automatically, and `npm ci`
# installs from the lockfile where the peer is already recorded -- so neither
# --omit=dev nor --omit=peer excludes it. This was found the hard way in #318,
# where the first version of the offline bundle passed its own tests with vitest
# sitting inside it. Asserting a flag is not asserting an outcome.
#
# Deps: bash 3.x compatible (macOS ships 3.2). Exit 0 = all pass.

set -u

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCKERFILE="$TEST_DIR/../../backend/Dockerfile"

pass=0
fail=0

# A note on the patterns below: they use `.*`, never `[^\n]*`. Inside a POSIX
# bracket expression `\n` is not a newline -- it is the two characters
# backslash and "n" -- so `[^\n]*` means "not a backslash and not the letter
# n", which cannot cross the word "node_modules". An earlier version of this
# suite used it and silently could not match once a second path was added.
ok()  { pass=$((pass + 1)); echo "    ok   $1"; }
bad() { fail=$((fail + 1)); echo "  FAIL   $1"; [ $# -gt 1 ] && echo "         $2"; }

[ -f "$DOCKERFILE" ] || { echo "Dockerfile not found at $DOCKERFILE"; exit 1; }

# Executable lines only: the Dockerfile carries comments explaining these very
# rules, and a naive grep matches the warning as readily as the mistake.
CODE="$(grep -vE '^[[:space:]]*#' "$DOCKERFILE")"

# A Dockerfile line ending in a backslash continues -- the RUN is one logical
# command spread over several physical lines. Matching per-line would miss a
# multi-line `rm -rf`, so continuations are folded first. This reads the
# Dockerfile the way Docker does rather than the way `grep` does by default.
JOINED="$(echo "$CODE" | awk '{
  cur = $0
  sub(/^[ \t]+/, "", cur)
  if (acc != "") { acc = acc " " cur } else { acc = cur }
  if (acc ~ /\\$/) { sub(/\\$/, "", acc) } else { print acc; acc = "" }
} END { if (acc != "") print acc }')"

# ---------------------------------------------------------------------------
# A stage that installs production dependencies only.
# ---------------------------------------------------------------------------
if echo "$CODE" | grep -qE 'npm ci[^&|]*--omit=dev'; then
  ok "a stage installs with --omit=dev"
else
  bad "a stage installs with --omit=dev" \
      "the runtime tree is whatever the builder needed, including the compiler"
fi

if echo "$CODE" | grep -qE 'npm ci[^&|]*--omit=peer'; then
  ok "that install also omits peer dependencies"
else
  bad "that install also omits peer dependencies" \
      "vitest arrives as an optional peer of better-auth"
fi

# ---------------------------------------------------------------------------
# Production must not take node_modules from the build stage.
# ---------------------------------------------------------------------------
if echo "$CODE" | grep -qE 'COPY --from=backend-builder.*node_modules'; then
  bad "production does not copy node_modules from backend-builder" \
      "that stage holds the full dev tree; it needs typescript to compile"
else
  ok "production does not copy node_modules from backend-builder"
fi

if echo "$CODE" | grep -qE 'COPY --from=[a-z-]*(prod|runtime)[a-z-]*.*node_modules'; then
  ok "production copies node_modules from a production-deps stage"
else
  bad "production copies node_modules from a production-deps stage" \
      "nothing supplies a runtime-only dependency tree"
fi

# ---------------------------------------------------------------------------
# The flag is not enough. There must be an explicit removal AND a check.
# ---------------------------------------------------------------------------
if echo "$JOINED" | grep -qE 'rm -rf.*node_modules/(vitest|@vitest|typescript|eslint)'; then
  ok "test and lint packages are removed explicitly"
else
  bad "test and lint packages are removed explicitly" \
      "--omit=dev does not exclude vitest, which is an optional peer of better-auth"
fi

if echo "$CODE" | grep -qE 'exit 1' && echo "$CODE" | grep -qiE 'vitest|typescript'; then
  ok "the build fails if a test or lint package is still present"
else
  bad "the build fails if a test or lint package is still present" \
      "checking the flag is not checking the outcome; this is what #318 got wrong first"
fi

# ---------------------------------------------------------------------------
# node-gyp compiles native addons. It is a runtime dependency of gdal-async on
# paper, but only because gdal-async may fall back to building from source --
# and the image already has a built binding. It drags in `tar`, which carries a
# CRITICAL advisory (#379).
#
# Verified in the built image before asserting it: with node-gyp and the
# hoisted tar both deleted, gdal-async reports GDAL 3.12.3, lists 139 drivers
# and round-trips a raster, and better-sqlite3 round-trips a query.
#
# This removes ONE of the two tar instances. The other is bundled inside
# gdal-async's own tarball (bundleDependencies: ["@mapbox/node-pre-gyp"]) and
# cannot be reached by npm overrides at all -- that one is upstream's.
# ---------------------------------------------------------------------------
if echo "$JOINED" | grep -qE 'rm -rf.*node_modules/node-gyp'; then
  ok "node-gyp is removed from the production tree"
else
  bad "node-gyp is removed from the production tree" \
      "it exists to compile from source, and it drags in tar (CRITICAL)"
fi

if echo "$JOINED" | grep -qE 'rm -rf.*node_modules/tar([^a-z/-]|$)'; then
  ok "the hoisted tar is removed from the production tree"
else
  bad "the hoisted tar is removed from the production tree" \
      "nothing in the runtime needs it once node-gyp is gone"
fi

# ---------------------------------------------------------------------------
# The native modules are genuine runtime dependencies and must survive.
#
# This is the part most likely to break silently: pruning that removes
# gdal-async or better-sqlite3 still produces a smaller image that builds
# cleanly, and fails only when the server starts.
# ---------------------------------------------------------------------------
# Requiring is not enough -- a broken binding can import and fail on first use.
if echo "$JOINED" | grep -qE 'gdal\.open|drivers\.count|gdal\.version'; then
  ok "the build exercises GDAL, not just imports it"
else
  bad "the build exercises GDAL, not just imports it" \
      "a require that succeeds proves the module resolves, not that the binding works"
fi

if echo "$CODE" | grep -qE 'gdal-async' && echo "$CODE" | grep -qE 'better-sqlite3'; then
  ok "the build asserts the native runtime modules survived"
else
  bad "the build asserts the native runtime modules survived" \
      "pruning that drops gdal-async or better-sqlite3 still builds cleanly and fails at startup"
fi

echo
echo "production_image_deps: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
