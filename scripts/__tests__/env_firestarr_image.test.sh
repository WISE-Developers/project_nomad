#!/usr/bin/env bash
#
# .env.example must name a FireSTARR image tag that actually exists (refs #376).
#
# `.env.example` documented the modelling image as
# `ghcr.io/cwfmf/firestarr-cpp/firestarr:v0.9.5.10`. That tag is not in the
# registry and never was in that repository: two things changed at once, the
# repository moved to `cwfmf/firestarr-cpp/firestarr`, and the version scheme
# went from four parts (`0.9.5.4`) to three (`0.9.20`) with no `v` prefix.
#
# This bites harder than a stale comment normally would, because
# `docker-compose.yaml:47` makes the variable mandatory:
#
#   image: ${FIRESTARR_IMAGE:?FIRESTARR_IMAGE must be set in .env - run the installer}
#
# So someone following the file as written gets a hard failure at pull time
# with no indication that the documentation is what is wrong.
#
# The checks below are deliberately OFFLINE and assert the SHAPE of the tag,
# not its existence. A suite that queries GHCR would fail on an air-gapped
# machine and in CI without credentials, and would turn a documentation check
# into a network dependency. The shape is what was wrong here: a `v` prefix and
# a four-part version, neither of which the current repository uses.
#
# Verified against the registry on 2026-09-24: the repository publishes 33
# tags, the newest plain-semver ones being 0.9.9, 0.9.10, 0.9.11, 0.9.15,
# 0.9.19, 0.9.20. `v0.9.5.10` is absent.
#
# Deps: bash 3.x compatible (macOS ships 3.2). Exit 0 = all pass.

set -u

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_EXAMPLE="$TEST_DIR/../../.env.example"

pass=0
fail=0

ok()  { pass=$((pass + 1)); echo "    ok   $1"; }
bad() { fail=$((fail + 1)); echo "  FAIL   $1"; [ $# -gt 1 ] && echo "         $2"; }

[ -f "$ENV_EXAMPLE" ] || { echo ".env.example not found at $ENV_EXAMPLE"; exit 1; }

# ---------------------------------------------------------------------------
# The tag that does not exist must be gone entirely.
# ---------------------------------------------------------------------------
# Match the dead tag only where it would be USED -- a VERSION assignment or an
# image reference -- not where prose explains that it is dead. Forbidding the
# string outright also forbids the explanation of why it changed, which is the
# part a future reader needs. (Same trap caught twice already today.)
stale="$(grep -nE "^[[:space:]]*#?[[:space:]]*(VERSION=|FIRESTARR_IMAGE=)[^#]*0\.9\.5\.10|ghcr\.io/[^[:space:]]*:v?0\.9\.5\.10" "$ENV_EXAMPLE" || true)"
if [ -z "$stale" ]; then
  ok "the non-existent 0.9.5.10 tag is not used as a value or image reference"
else
  bad "the non-existent 0.9.5.10 tag is not used as a value or image reference" \
      "$(echo "$stale" | head -2 | tr '\n' ' ')"
fi

# ---------------------------------------------------------------------------
# Every FireSTARR image reference must use the current repository.
# ---------------------------------------------------------------------------
wrong_repo="$(grep -nE "ghcr\.io/cwfmf/firestarr:" "$ENV_EXAMPLE" || true)"
if [ -z "$wrong_repo" ]; then
  ok "image references use the current cwfmf/firestarr-cpp repository"
else
  bad "image references use the current cwfmf/firestarr-cpp repository" \
      "the old cwfmf/firestarr repository uses the retired four-part scheme"
fi

# ---------------------------------------------------------------------------
# Tag shape: three-part semver, no `v` prefix, or a documented moving tag.
#
# A moving tag is acceptable HERE, unlike in the offline bundle builder, because
# .env.example documents a deployment a human maintains rather than producing a
# reproducible artifact. It must still be one the registry actually publishes.
# ---------------------------------------------------------------------------
badtag=0
while IFS= read -r line; do
  tag="${line##*:}"
  case "$tag" in
    [0-9]*.[0-9]*.[0-9]*)
      case "$tag" in
        *.*.*.*) echo "         four-part version: $line"; badtag=1 ;;
      esac ;;
    main-latest|dev-latest|unstable-latest) ;;
    *) echo "         unrecognised tag shape: $line"; badtag=1 ;;
  esac
done < <(grep -oE "ghcr\.io/cwfmf/[a-z-]+(/[a-z-]+)?:[A-Za-z0-9._-]+" "$ENV_EXAMPLE")

[ "$badtag" -eq 0 ] && ok "every image tag uses the current three-part scheme" \
                    || bad "every image tag uses the current three-part scheme" \
                           "the repository dropped the v prefix and the fourth version part"

# ---------------------------------------------------------------------------
# VERSION is a separate key and was carrying the same stale string.
# ---------------------------------------------------------------------------
ver="$(grep -E "^VERSION=" "$ENV_EXAMPLE" | head -1 | cut -d= -f2-)"
case "$ver" in
  v*|*.*.*.*) bad "VERSION does not carry a retired FireSTARR version string" "got '$ver'" ;;
  "")         bad "VERSION is set in .env.example" "key missing" ;;
  *)          ok "VERSION does not carry a retired FireSTARR version string ($ver)" ;;
esac

echo
echo "env_firestarr_image: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
