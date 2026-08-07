#!/usr/bin/env bash
#
# Every install path must end up with a usable dataset source in .env.
#
# Regression: .env.example was switched to FIRESTARR_DATASET_INDEX by default
# (#322), which only helps installers that COPY the example. Two installers
# WRITE .env programmatically and never emitted any dataset source at all, so
# a completed install could not fetch a dataset:
#
#   install-firestarr-dataset.sh -> "Set FIRESTARR_DATASET_INDEX (year picker)
#   or FIRESTARR_DATASET_SOURCE (single dataset) in .env"
#
# A third installer (demo) read FIRESTARR_DATASET_SOURCE straight out of
# .env.example and hard-failed when it was commented out.
#
# Found on a real install, not by any test — hence this file.
#
# Deps: bash 3.x, grep/sed. Exit 0 = all pass.
set -u

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPTS="$TEST_DIR/.."
ENV_EXAMPLE="$SCRIPTS/../.env.example"

pass=0; fail=0
ok()   { echo "  ok   - $1"; pass=$((pass+1)); }
bad()  { echo "  FAIL - $1"; [ -n "${2:-}" ] && echo "         $2"; fail=$((fail+1)); }

INDEX_URL="https://fgmfiles.spyd.com/datasets/nomad/index.json"

# ---- .env.example still ships a working default --------------------------
if grep -qE '^FIRESTARR_DATASET_INDEX=' "$ENV_EXAMPLE"; then
  ok ".env.example enables FIRESTARR_DATASET_INDEX by default"
else
  bad ".env.example enables FIRESTARR_DATASET_INDEX by default"
fi

# ---- installers that WRITE .env must emit a dataset source ---------------
# These build .env key-by-key rather than copying the example, so the example's
# default never reaches them.
for f in install-nomad-san-docker.sh install-nomad-san-metal.sh; do
  s="$SCRIPTS/$f"
  if [ ! -f "$s" ]; then bad "$f exists"; continue; fi
  if grep -qE 'update_env(_value)?[[:space:]]+"FIRESTARR_DATASET_(INDEX|SOURCE)"' "$s"; then
    ok "$f writes a dataset source into .env"
  else
    bad "$f writes a dataset source into .env" \
        "generated .env would have neither INDEX nor SOURCE; dataset install refuses to run"
  fi
done

# ---- the demo installer must not depend on a commented-out example key ----
s="$SCRIPTS/install-nomad-demo.sh"
if grep -qE 'fail "FIRESTARR_DATASET_SOURCE missing from \.env\.example"' "$s"; then
  bad "demo installer does not hard-fail on a commented FIRESTARR_DATASET_SOURCE" \
      "it greps ^FIRESTARR_DATASET_SOURCE= out of .env.example, which is now commented"
else
  ok "demo installer does not hard-fail on a commented FIRESTARR_DATASET_SOURCE"
fi

if grep -qE 'FIRESTARR_DATASET_INDEX' "$s"; then
  ok "demo installer understands index mode"
else
  bad "demo installer understands index mode" "no reference to FIRESTARR_DATASET_INDEX"
fi

# ---- the default index URL is consistent wherever it is hardcoded --------
badurl=0
for s in "$SCRIPTS"/*.sh "$ENV_EXAMPLE"; do
  while IFS= read -r line; do
    case "$line" in
      *fgmfiles.spyd.com/datasets/nomad/index.json*) ;;
      *) badurl=1; echo "         odd index URL in $(basename "$s"): $line" ;;
    esac
  done < <(grep -hoE 'https?://[^"'"'"' ]*index\.json' "$s" 2>/dev/null)
done
[ "$badurl" -eq 0 ] && ok "index URL is consistent everywhere it appears" \
                    || bad "index URL is consistent everywhere it appears"

echo
echo "env_dataset_source: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
