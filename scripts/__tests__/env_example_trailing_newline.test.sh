#!/usr/bin/env bash
#
# .env.example MUST end with a newline.
#
# Regression: the file ended with "CFS_FIRESTARR_AUTHKEY=" and no trailing
# newline. Installers that APPEND keys with `echo "KEY=value" >> .env` after
# copying the example therefore concatenate the first appended key onto the
# last existing line:
#
#   CFS_FIRESTARR_AUTHKEY=NOMAD_SERVER_HOSTNAME=nomad.example.ca
#
# Both keys are then unreadable. This silently ate NOMAD_SERVER_HOSTNAME on a
# real menu install — no error, no warning, the installer reported success.
#
# Found on a real install, not by any test — hence this file.
#
# Deps: bash 3.x, tail/od. Exit 0 = all pass.
set -u

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPTS="$TEST_DIR/.."
ENV_EXAMPLE="$SCRIPTS/../.env.example"

pass=0; fail=0
ok()   { echo "  ok   - $1"; pass=$((pass+1)); }
bad()  { echo "  FAIL - $1"; [ -n "${2:-}" ] && echo "         $2"; fail=$((fail+1)); }

echo "env_example_trailing_newline"

# ---- the file itself ends with a newline ---------------------------------
if [ ! -f "$ENV_EXAMPLE" ]; then
  bad ".env.example exists" "not found at $ENV_EXAMPLE"
else
  last_byte="$(tail -c 1 "$ENV_EXAMPLE" | od -An -c | tr -d ' ')"
  if [ "$last_byte" = '\n' ]; then
    ok ".env.example ends with a newline"
  else
    bad ".env.example ends with a newline" \
        "last byte is '$last_byte' — appending a key would concatenate onto the last line"
  fi
fi

# ---- appending a key must produce a readable key on its own line ----------
# This is the behaviour the newline actually protects. Reproduces what an
# installer does: copy the example, append a key, then read it back.
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cp "$ENV_EXAMPLE" "$TMP/.env"
echo "NOMAD_HOME_TIMEZONE=America/Edmonton" >> "$TMP/.env"

if grep -qE '^NOMAD_HOME_TIMEZONE=America/Edmonton$' "$TMP/.env"; then
  ok "a key appended to a copy of .env.example is readable on its own line"
else
  mangled="$(grep -n 'NOMAD_HOME_TIMEZONE' "$TMP/.env" | head -1)"
  bad "a key appended to a copy of .env.example is readable on its own line" \
      "got: ${mangled:-<key not found at all>}"
fi

# ---- the last existing key must survive the append -----------------------
# The newline bug corrupts TWO keys: the appended one and the one before it.
if grep -qE '^# ?CFS_FIRESTARR_AUTHKEY=$' "$TMP/.env"; then
  ok "the last key in .env.example survives an append intact"
else
  bad "the last key in .env.example survives an append intact" \
      "got: $(grep -n 'CFS_FIRESTARR_AUTHKEY' "$TMP/.env" | head -1)"
fi

echo "  $pass passed, $fail failed"
[ "$fail" -eq 0 ] || exit 1
