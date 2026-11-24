#!/usr/bin/env bash
#
# `deploy.sh` must REFUSE to deploy when a required `.env` key is missing, and
# NAME the key — issue #571.
#
# Measured before this suite existed: deploy.sh had zero references to any
# required key and no preflight of any kind. It backs up `.env` and tags the
# outgoing image, but checks no keys and no running jobs. So a release that adds
# a required key pulls, tags, recreates, and THEN the backend exits 1 — with the
# site down and nothing before that point reporting an error.
#
# The runbook's "add new required keys before recreating" was the only thing
# standing between a release and an outage, and it is a step a human remembers.
#
# WHERE THE KEY LIST COMES FROM MATTERS MORE THAN THE CHECK. A list maintained
# by hand inside deploy.sh drifts from the backend that enforces it, and the
# drift is invisible until a deploy fails. The backend announces required keys
# in one convention, across three different idioms:
#
#     throw new Error('Required environment variable "KEY" is not set...')
#
# `EnvironmentService.getRequired`, `getFuelNoDataValue`, and
# `JsonlUsageLogger` all use it. So the last test here greps that convention and
# asserts every key it finds is ACCOUNTED FOR by the preflight — either demanded
# unconditionally or recorded as conditional with its condition. A new required
# key in the backend then fails this suite instead of a production deploy.
#
# NOT EVERY REQUIRED KEY IS UNCONDITIONALLY REQUIRED, and getting this wrong
# would be worse than no preflight at all:
#
#   NOMAD_HOME_TIMEZONE        always
#   NOMAD_USAGE_LOG_PATH       always
#   NOMAD_USAGE_LOG_MAX_BYTES  always
#   NOMAD_FUEL_NODATA_VALUE    only on the WCS fuel path (NOMAD_FUEL_SOURCE);
#                              the default is local, where no action is needed
#   COMPOSE_PROJECT_NAME       only in docker mode (FIRESTARR_EXECUTION_MODE);
#                              meaningless in binary mode, which labels and
#                              sweeps no containers
#
# A preflight that demanded all five unconditionally would refuse EVERY deploy
# of the demo, over a fuel key that needs no action there. That is why the
# conditional keys are tested for being conditional, not merely present.
#
# Deps: bash 3.x, grep, sed. Exit 0 = all pass, 1 = any failure.
set -u

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPTS="$TEST_DIR/.."
ROOT="$SCRIPTS/.."
DEPLOY="$SCRIPTS/deploy.sh"
FN="preflight_env"

ALWAYS="NOMAD_HOME_TIMEZONE NOMAD_USAGE_LOG_PATH NOMAD_USAGE_LOG_MAX_BYTES"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

pass=0; fail=0
ok()  { echo "  ok   - $1"; pass=$((pass+1)); }
bad() { echo "  FAIL - $1"; [ -n "${2:-}" ] && echo "         $2"; fail=$((fail+1)); }

echo "deploy_env_preflight"

[ -f "$DEPLOY" ] || { echo "  deploy.sh not found at $DEPLOY"; exit 1; }

# ---- a fake docker that RECORDS whether it was called ---------------------
# The preflight must refuse before anything is pulled, tagged or recreated. A
# refusal that happens after the container is gone is the outage this issue
# exists to prevent, and it would otherwise look identical to a clean refusal.
mkdir -p "$tmp/bin"
cat > "$tmp/bin/docker" <<'FAKE'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$DOCKER_CALLS"
exit 0
FAKE
chmod +x "$tmp/bin/docker"

write_env() {
  # write_env <file> [KEY=VALUE ...]   — a COMPLETE env unless overridden
  local f="$1"; shift
  {
    echo "NOMAD_HOME_TIMEZONE=America/Edmonton"
    echo "NOMAD_USAGE_LOG_PATH=/appl/data/usage/usage.jsonl"
    echo "NOMAD_USAGE_LOG_MAX_BYTES=52428800"
    echo "FIRESTARR_EXECUTION_MODE=docker"
    echo "COMPOSE_PROJECT_NAME=nomad_demo"
  } > "$f"
  local kv
  for kv in "$@"; do
    local k="${kv%%=*}"
    # remove the shipped line, then append the override unless it is a deletion
    grep -v "^${k}=" "$f" > "$f.tmp" && mv "$f.tmp" "$f"
    case "$kv" in
      *=__DELETE__) : ;;
      *) echo "$kv" >> "$f" ;;
    esac
  done
}

# drive <env-file>  -> "<status>|<stdout+stderr>"
# Extracted and run in isolation, the pattern every other installer suite here
# uses, so deploy.sh's top-level flow never executes.
drive() {
  local envfile="$1"
  local d="$tmp/run"; rm -rf "$d"; mkdir -p "$d"
  sed -n "/^${FN}() {/,/^}/p" "$DEPLOY" > "$d/fn.sh"
  if [ ! -s "$d/fn.sh" ]; then echo "NOFN|"; return; fi
  {
    echo 'set -u'
    echo 'print_error()   { echo "$*"; }'
    echo 'print_warning() { echo "$*"; }'
    echo 'print_info()    { echo "$*"; }'
    echo 'print_success() { echo "$*"; }'
    echo 'DRY_RUN=false'
    cat "$d/fn.sh"
    echo "${FN} \"\$1\""
  } > "$d/harness.sh"
  local out status
  out="$(DOCKER_CALLS="$tmp/docker-calls" PATH="$tmp/bin:$PATH" bash "$d/harness.sh" "$envfile" 2>&1)"
  status=$?
  echo "${status}|${out}"
}

: > "$tmp/docker-calls"

# ---- 0. the function must exist and be extractable ----------------------
r="$(drive "/dev/null")"
if [ "${r%%|*}" = "NOFN" ]; then
  bad "deploy.sh defines ${FN}() at top level" \
      "not found — deploy.sh performs no env preflight at all"
  for k in $ALWAYS; do
    bad "a missing $k is refused and named" "no preflight to drive"
    bad "a BLANK $k is refused and named" "no preflight to drive"
  done
  bad "a complete env passes" "no preflight to drive"
  bad "several missing keys are ALL named in one run" "no preflight to drive"
  bad "nothing is pulled, tagged or recreated before refusing" "no preflight to drive"
  bad "COMPOSE_PROJECT_NAME is required in docker mode" "no preflight to drive"
  bad "COMPOSE_PROJECT_NAME is NOT required in binary mode" "no preflight to drive"
  bad "NOMAD_FUEL_NODATA_VALUE is not demanded on the default fuel path" "no preflight to drive"
  bad "every backend-required key is accounted for" "no preflight to drive"
  echo "  $pass passed, $fail failed"
  exit 1
fi
ok "deploy.sh defines ${FN}() at top level"

# ---- 1. a complete env passes -------------------------------------------
write_env "$tmp/complete.env"
r="$(drive "$tmp/complete.env")"
if [ "${r%%|*}" = "0" ]; then
  ok "a complete env passes"
else
  bad "a complete env passes" "status ${r%%|*}: ${r#*|}"
fi

# ---- 2. each unconditional key, removed one at a time, refused AND NAMED -
for k in $ALWAYS; do
  write_env "$tmp/missing.env" "${k}=__DELETE__"
  r="$(drive "$tmp/missing.env")"
  if [ "${r%%|*}" = "0" ]; then
    bad "a missing $k is refused and named" "the preflight PASSED with $k absent"
  elif echo "${r#*|}" | grep -q "$k"; then
    ok "a missing $k is refused and named"
  else
    bad "a missing $k is refused and named" \
        "refused, but the output does not name the key: ${r#*|}"
  fi
done

# ---- 3. BLANK counts as missing -----------------------------------------
# The backend treats blank as unset. A preflight that accepts a blank disagrees
# with the thing it is protecting, which is how COMPOSE_PROJECT_NAME behaves.
for k in $ALWAYS; do
  write_env "$tmp/blank.env" "${k}="
  r="$(drive "$tmp/blank.env")"
  if [ "${r%%|*}" = "0" ]; then
    bad "a BLANK $k is refused and named" "the preflight PASSED with $k blank"
  elif echo "${r#*|}" | grep -q "$k"; then
    ok "a BLANK $k is refused and named"
  else
    bad "a BLANK $k is refused and named" "refused but did not name it: ${r#*|}"
  fi
done

# ---- 4. several missing keys are ALL named in ONE run --------------------
# Naming only the first makes an operator fix them one outage at a time.
write_env "$tmp/multi.env" "NOMAD_HOME_TIMEZONE=__DELETE__" "NOMAD_USAGE_LOG_PATH=__DELETE__"
r="$(drive "$tmp/multi.env")"
if [ "${r%%|*}" != "0" ] \
   && echo "${r#*|}" | grep -q NOMAD_HOME_TIMEZONE \
   && echo "${r#*|}" | grep -q NOMAD_USAGE_LOG_PATH; then
  ok "several missing keys are ALL named in one run"
else
  bad "several missing keys are ALL named in one run" "got: ${r#*|}"
fi

# ---- 5. refuse BEFORE touching docker -----------------------------------
: > "$tmp/docker-calls"
write_env "$tmp/missing.env" "NOMAD_HOME_TIMEZONE=__DELETE__"
r="$(drive "$tmp/missing.env")"
calls="$(wc -l < "$tmp/docker-calls" | tr -d ' ')"
if [ "${r%%|*}" != "0" ] && [ "$calls" = "0" ]; then
  ok "nothing is pulled, tagged or recreated before refusing"
else
  bad "nothing is pulled, tagged or recreated before refusing" \
      "docker was invoked $calls time(s) during a refused preflight"
fi
# control: the recorder works, or the zero above proves nothing
PATH="$tmp/bin:$PATH" DOCKER_CALLS="$tmp/docker-calls" docker compose ls >/dev/null 2>&1
if [ "$(wc -l < "$tmp/docker-calls" | tr -d ' ')" -gt 0 ]; then
  ok "control: the fake docker DOES record calls when invoked"
else
  bad "control: the fake docker DOES record calls when invoked" \
      "the recorder is broken, so the check above cannot discriminate"
fi

# ---- 6. the mode-conditional keys ---------------------------------------
write_env "$tmp/docker-mode.env" "COMPOSE_PROJECT_NAME=__DELETE__" "FIRESTARR_EXECUTION_MODE=docker"
r="$(drive "$tmp/docker-mode.env")"
if [ "${r%%|*}" != "0" ] && echo "${r#*|}" | grep -q COMPOSE_PROJECT_NAME; then
  ok "COMPOSE_PROJECT_NAME is required in docker mode"
else
  bad "COMPOSE_PROJECT_NAME is required in docker mode" "got status ${r%%|*}: ${r#*|}"
fi

write_env "$tmp/binary-mode.env" "COMPOSE_PROJECT_NAME=__DELETE__" "FIRESTARR_EXECUTION_MODE=binary"
r="$(drive "$tmp/binary-mode.env")"
if [ "${r%%|*}" = "0" ]; then
  ok "COMPOSE_PROJECT_NAME is NOT required in binary mode"
else
  bad "COMPOSE_PROJECT_NAME is NOT required in binary mode" \
      "binary mode labels and sweeps no containers; refusing there blocks a valid deploy: ${r#*|}"
fi

# ---- 7. the fuel key must NOT be demanded on the default path -----------
# NOMAD_FUEL_SOURCE defaults to local. Demanding this unconditionally would
# refuse every deploy of a deployment that never uses the WCS fuel path.
write_env "$tmp/nofuel.env"
r="$(drive "$tmp/nofuel.env")"
if [ "${r%%|*}" = "0" ]; then
  ok "NOMAD_FUEL_NODATA_VALUE is not demanded on the default fuel path"
else
  bad "NOMAD_FUEL_NODATA_VALUE is not demanded on the default fuel path" \
      "a complete env with no fuel override was refused: ${r#*|}"
fi

# ---- 8. DRIFT GUARD: every backend-required key is accounted for ---------
# The backend announces required keys in one convention. Any key it names must
# appear in deploy.sh — demanded, or recorded as conditional with its condition.
# This is what stops the preflight's list rotting while the backend moves.
backend_keys="$(grep -rhoE 'Required environment variable \\?"[A-Z0-9_]+' "$ROOT/backend/src" \
                  --include='*.ts' 2>/dev/null \
                | sed -E 's/.*"//' | sort -u | grep -v '^KEY$' || true)"
if [ -z "$backend_keys" ]; then
  bad "control: the backend convention grep finds keys at all" \
      "found none — an empty list would make the drift guard vacuous"
else
  ok "control: the backend convention grep finds keys ($(echo "$backend_keys" | wc -l | tr -d ' '))"
  unaccounted=""
  for k in $backend_keys; do
    grep -q "$k" "$DEPLOY" || unaccounted="$unaccounted $k"
  done
  if [ -z "$unaccounted" ]; then
    ok "every backend-required key is accounted for in deploy.sh"
  else
    bad "every backend-required key is accounted for in deploy.sh" \
        "deploy.sh never mentions:$unaccounted — the preflight cannot protect a key it does not know"
  fi
fi

echo "  $pass passed, $fail failed"
[ "$fail" -eq 0 ] || exit 1
