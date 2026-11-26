#!/usr/bin/env bash
#
# `preflight_jobs` must resolve the database from WHAT IS ACTUALLY MOUNTED, not by
# applying a container-side rule to host-side values — issue #582.
#
# THE DEFECT. `knexConfig.ts getSqlitePath()` is `NOMAD_DATA_PATH || FIRESTARR_DATASET_PATH
# || ./data`, and that rule runs INSIDE the container, where those keys hold container
# paths. `preflight_jobs` runs on the HOST and reads the host `.env`, where the same keys
# hold MOUNT SOURCES. The rule was copied across a namespace boundary. Inside the
# container the value is `/appl/data` on every box, because compose overrides it, so the
# host value is never the backend's path.
#
# WHY A SECOND SUITE RATHER THAN MORE CASES IN deploy_running_jobs.test.sh. That suite
# proves the VERDICT logic — refuse on a pending job, refuse on a failed query, pass with
# a positive control. This one proves the check is pointed at the right FILE. Those are
# different propositions and the first can pass completely while the second is wrong,
# which is exactly what happened: the demo's configuration satisfies the broken rule by
# coincidence, so every existing test and the production box both read green.
#
# THE CASE THAT MATTERS IS NOT THE REFUSAL, IT IS THE FALSE PASS. A deployment whose
# resolved path lands on a stale or unrelated `nomad.db` gets
# "[OK] No jobs pending or running (N job(s) total)" and proceeds to recreate the
# container, killing whatever was running in the REAL database. The positive control in
# the other suite cannot catch it: `N total` proves the query path works, not that it was
# aimed at the right file. `<app dir>/backend/nomad.db` exists on both real boxes today,
# so this is reachable rather than theoretical.
#
# So the first two cases below are a PAIR and must disagree: identical configuration,
# differing only in whether the MOUNTED database has a job in flight. If both pass or
# both refuse, this suite is measuring something other than which file was read.
#
# Deps: bash 3.x, python3 (fixture databases), sed, grep.
# Exit 0 = all pass, 1 = any failure.
set -u

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPTS="$TEST_DIR/.."
DEPLOY="$SCRIPTS/deploy.sh"
FN="preflight_jobs"

pass=0; fail=0
good() { printf '  ok   %s\n' "$1"; pass=$((pass + 1)); }
bad()  { printf '  FAIL %s\n       %s\n' "$1" "$2"; fail=$((fail + 1)); }

tmp="$(mktemp -d "${TMPDIR:-/tmp}/preflight-db-path.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin"

# ---- fixtures -------------------------------------------------------------

# THE FIXTURE CARRIES EVERY COLUMN THE PRODUCTION QUERIES READ, and that is not
# incidental. preflight_jobs' listing query selects `model_id` and `started_at`; a table
# holding only (id, status) makes that query FAIL, the listing falls back to its
# "could not be listed" message, and the suite reports "the code does not name jobs"
# when the code is fine and the fixture was short a column. Cost me two false failures
# on first run.
JOBS_SCHEMA="create table jobs (id text primary key, status text, model_id text, started_at text)"

# A sqlite database with one job in the given status.
mkdb() { # <path> <status> [id]
  python3 - "$1" "$2" "${3:-j1}" "$JOBS_SCHEMA" <<'PY'
import sqlite3, sys
con = sqlite3.connect(sys.argv[1])
con.execute(sys.argv[4])
con.execute("insert into jobs values (?, ?, 'model-1', '2026-11-26T12:00:00Z')",
            (sys.argv[3], sys.argv[2]))
con.commit(); con.close()
PY
}

# A sqlite database with a jobs table and no rows at all.
mkdb_empty() { # <path>
  python3 - "$1" "$JOBS_SCHEMA" <<'PY'
import sqlite3, sys
con = sqlite3.connect(sys.argv[1])
con.execute(sys.argv[2])
con.commit(); con.close()
PY
}

# A fake `docker` that answers the mount-source inspect and records its argv.
fake_docker() { # <dir> <mount-source-or-empty>
  mkdir -p "$1"
  cat > "$1/docker" <<EOF
#!/usr/bin/env bash
echo "\$*" >> "\${DOCKER_CALLS:-/dev/null}"
case "\$1" in
  inspect) printf '%s' "$2"; exit 0 ;;
esac
exit 0
EOF
  chmod +x "$1/docker"
}

# ---- the harness, matching deploy_running_jobs.test.sh ---------------------
# drive <env-file> [extra-path-dir] [extra env assignments...] -> "<status>|<output>"
drive() {
  local envfile="$1"; shift
  local extradir="${1:-}"; [ $# -gt 0 ] && shift
  local d="$tmp/run"; rm -rf "$d"; mkdir -p "$d"
  sed -n "/^${FN}() {/,/^}/p" "$DEPLOY" > "$d/fn.sh"
  if [ ! -s "$d/fn.sh" ]; then echo "NOFN|"; return; fi
  sed -n '/^env_value() {/,/^}/p'    "$DEPLOY" >  "$d/helpers.sh"
  sed -n '/^sqlite_query() {/,/^}/p' "$DEPLOY" >> "$d/helpers.sh"
  sed -n '/^ignore_jobs_override() {/,/^}/p' "$DEPLOY" >> "$d/helpers.sh"
  grep '^JOB_TERMINAL_STATUSES=' "$DEPLOY"     >> "$d/helpers.sh"
  grep '^CONTAINER_DATA_DIR=' "$DEPLOY"        >> "$d/helpers.sh"
  {
    echo 'set -u'
    echo 'print_error()   { echo "$*"; }'
    echo 'print_warning() { echo "$*"; }'
    echo 'print_info()    { echo "$*"; }'
    echo 'print_success() { echo "$*"; }'
    echo 'DRY_RUN=false'
    echo 'SERVICE=${SERVICE:-nomad}'
    echo 'IGNORE_RUNNING_JOBS=${IGNORE_RUNNING_JOBS:-false}'
    cat "$d/helpers.sh"
    cat "$d/fn.sh"
    echo "${FN} \"\$1\""
  } > "$d/harness.sh"
  local p="$tmp/bin:$PATH"
  [ -n "$extradir" ] && p="$extradir:$p"
  local out status
  out="$(cd "$d" && env "$@" DOCKER_CALLS="$tmp/docker-calls" PATH="$p" bash "$d/harness.sh" "$envfile" 2>&1)"
  status=$?
  printf '%s|%s' "$status" "$out"
}

: > "$tmp/docker-calls"

r="$(drive "/dev/null")"
if [ "${r%%|*}" = "NOFN" ]; then
  bad "deploy.sh defines ${FN}() at top level" "not found"
  printf '\n%d passed, %d failed\n' "$pass" "$fail"
  exit 1
fi

# ---- the mismatched-box shape, which is nomad-rehearse's -------------------
# NOMAD_DATA_PATH points one way; the actual /appl/data mount points another. On the
# demo these coincide, which is the only reason the broken rule reads green there.
setup_mismatch() { # <mounted-db-status: running|empty>
  rm -rf "$tmp/configured" "$tmp/mounted" "$tmp/dbin"
  mkdir -p "$tmp/configured" "$tmp/mounted"
  # The database the BROKEN rule resolves to: always quiet, so reading it always
  # produces a pass. This is the stale leftover the issue describes.
  mkdb_empty "$tmp/configured/nomad.db"
  # The database the deployment ACTUALLY uses.
  if [ "$1" = "running" ]; then
    mkdb "$tmp/mounted/nomad.db" running
  else
    mkdb_empty "$tmp/mounted/nomad.db"
  fi
  cat > "$tmp/env" <<EOF
NOMAD_DEPLOYMENT_MODE=SAN
FIRESTARR_EXECUTION_MODE=docker
NOMAD_DATA_PATH=$tmp/configured
FIRESTARR_DATASET_PATH=$tmp/mounted
EOF
  fake_docker "$tmp/dbin" "$tmp/mounted"
}

# 1. THE DEFECT. The mounted database has a RUNNING job; the configured path is quiet.
setup_mismatch running
r="$(drive "$tmp/env" "$tmp/dbin")"
st="${r%%|*}"; out="${r#*|}"
if [ "$st" != "0" ] && printf '%s' "$out" | grep -qi "refus"; then
  good "a RUNNING job in the MOUNTED database is refused, though the configured path is quiet"
else
  bad "a RUNNING job in the MOUNTED database is refused, though the configured path is quiet" \
      "status=$st, output: $(printf '%s' "$out" | tr '\n' ' ' | cut -c1-200)"
fi

# 2. ITS CONTROL, same shape, mounted database quiet. Must PASS.
#    Without this, case 1 could be satisfied by a check that refuses unconditionally.
setup_mismatch empty
r="$(drive "$tmp/env" "$tmp/dbin")"
st="${r%%|*}"; out="${r#*|}"
if [ "$st" = "0" ]; then
  good "CONTROL: the same configuration passes when the MOUNTED database is quiet"
else
  bad "CONTROL: the same configuration passes when the MOUNTED database is quiet" \
      "status=$st, output: $(printf '%s' "$out" | tr '\n' ' ' | cut -c1-200)"
fi

# 3. The mount is consulted at all — asserted on the argv, not inferred from a verdict.
setup_mismatch empty
: > "$tmp/docker-calls"
drive "$tmp/env" "$tmp/dbin" >/dev/null
if grep -q "inspect" "$tmp/docker-calls" && grep -q "Mounts" "$tmp/docker-calls"; then
  good "the mount source is read from docker inspect, naming the Mounts field"
else
  bad "the mount source is read from docker inspect, naming the Mounts field" \
      "docker calls were: $(tr '\n' ';' < "$tmp/docker-calls" | cut -c1-200)"
fi

# 4. Docker mode with NO container running must REFUSE, not silently fall back to the
#    host-interpreted value — a deploy that cannot locate the database must not guess.
setup_mismatch running
fake_docker "$tmp/dbin" ""   # inspect returns nothing: no such container
r="$(drive "$tmp/env" "$tmp/dbin")"
st="${r%%|*}"; out="${r#*|}"
if [ "$st" != "0" ] && printf '%s' "$out" | grep -qi "refus"; then
  good "docker mode with no running container refuses rather than guessing a path"
else
  bad "docker mode with no running container refuses rather than guessing a path" \
      "status=$st, output: $(printf '%s' "$out" | tr '\n' ' ' | cut -c1-200)"
fi

# 5. BINARY MODE KEEPS THE .env DERIVATION. There is no container and no mount, and
#    there the host value genuinely IS the backend's path. This is the regression guard
#    for the half of the behaviour that was always correct.
rm -rf "$tmp/binary"; mkdir -p "$tmp/binary"
mkdb "$tmp/binary/nomad.db" pending
cat > "$tmp/env-binary" <<EOF
NOMAD_DEPLOYMENT_MODE=SAN
FIRESTARR_EXECUTION_MODE=binary
NOMAD_DATA_PATH=$tmp/binary
EOF
r="$(drive "$tmp/env-binary" "$tmp/dbin")"
st="${r%%|*}"; out="${r#*|}"
if [ "$st" != "0" ] && printf '%s' "$out" | grep -qi "refus"; then
  good "binary mode resolves from .env and still refuses a PENDING job"
else
  bad "binary mode resolves from .env and still refuses a PENDING job" \
      "status=$st, output: $(printf '%s' "$out" | tr '\n' ' ' | cut -c1-200)"
fi

# 6. Binary mode must not consult docker at all — asserted as an ABSENCE beside case 3's
#    presence, so the pair shows the argv check can distinguish the two modes.
: > "$tmp/docker-calls"
drive "$tmp/env-binary" "$tmp/dbin" >/dev/null
if [ ! -s "$tmp/docker-calls" ]; then
  good "binary mode makes no docker call"
else
  bad "binary mode makes no docker call" \
      "docker was called: $(tr '\n' ';' < "$tmp/docker-calls" | cut -c1-160)"
fi

# ---- DOCKER-MODE COVERAGE FOR THE MODE-AGNOSTIC PATHS --------------------------------
#
# WHY THIS SECTION EXISTS, stated plainly because it records a mistake of mine.
#
# Making the mount the source of truth meant deploy_running_jobs.test.sh's fixtures had
# to declare a mode, and I declared them all `binary`. Every assertion in that suite kept
# its exact wording and the diff touched no assertion logic, so I reported the change as
# cosmetic. IT WAS NOT. Those cases had been running in the DEFAULT mode, which is docker,
# and moving them to binary silently removed docker coverage from every path they test.
# Franco caught it: "switching those 12 cases to binary changed what they test, not just
# how they're written."
#
# Two of those paths genuinely belong to binary alone — the FIRESTARR_DATASET_PATH
# fallback and the NOMAD_DATA_PATH precedence — because in docker mode that rule no longer
# applies at all. The rest are MODE-AGNOSTIC: a refusal is a refusal, an override is an
# override, and an unreadable total must refuse whichever way the path was resolved.
# Those are re-covered here, in docker mode, reached through the mount.
#
# They live in this suite rather than being duplicated into the other one so there is a
# single place that knows how to fake the mount, and so the binary cases stay where they
# correctly are.

# A docker-mode env whose mount holds the given database directory.
docker_env() { # <mount-dir> [extra KEY=VALUE ...]
  local mount="$1"; shift
  {
    echo "NOMAD_DEPLOYMENT_MODE=SAN"
    echo "FIRESTARR_EXECUTION_MODE=docker"
    # Deliberately pointed somewhere ELSE, so any case that passes here proves the mount
    # was used rather than this value.
    echo "NOMAD_DATA_PATH=$tmp/decoy"
    for kv in "$@"; do echo "$kv"; done
  } > "$tmp/env.docker"
  fake_docker "$tmp/dbin" "$mount"
}
mkdir -p "$tmp/decoy"
mkdb_empty "$tmp/decoy/nomad.db"   # a quiet decoy: reading it would always look like a pass

# 7. A pending job is REFUSED AND NAMED in docker mode.
rm -rf "$tmp/m_named"; mkdir -p "$tmp/m_named"
mkdb "$tmp/m_named/nomad.db" pending job-named-1
docker_env "$tmp/m_named"
r="$(drive "$tmp/env.docker" "$tmp/dbin")"
st="${r%%|*}"; out="${r#*|}"
if [ "$st" != "0" ] && printf '%s' "$out" | grep -q "job-named-1"; then
  good "docker mode: a pending job is refused and NAMED"
else
  bad "docker mode: a pending job is refused and NAMED" \
      "status=$st named=$(printf '%s' "$out" | grep -c 'job-named-1')"
fi

# 8. The override proceeds AND names what it will kill, in docker mode.
r="$(drive "$tmp/env.docker" "$tmp/dbin" IGNORE_RUNNING_JOBS=true)"
st="${r%%|*}"; out="${r#*|}"
if [ "$st" = "0" ] && printf '%s' "$out" | grep -q "job-named-1"; then
  good "docker mode: the override proceeds and still names the jobs it will kill"
else
  bad "docker mode: the override proceeds and still names the jobs it will kill" \
      "status=$st named=$(printf '%s' "$out" | grep -c 'job-named-1')"
fi

# 9. A MISSING database at the mount refuses — and the decoy must not rescue it.
rm -rf "$tmp/m_none"; mkdir -p "$tmp/m_none"
docker_env "$tmp/m_none"
r="$(drive "$tmp/env.docker" "$tmp/dbin")"
st="${r%%|*}"; out="${r#*|}"
if [ "$st" != "0" ] && printf '%s' "$out" | grep -qi "no database"; then
  good "docker mode: a missing database AT THE MOUNT refuses, despite a readable decoy"
else
  bad "docker mode: a missing database AT THE MOUNT refuses, despite a readable decoy" \
      "status=$st out=$(printf '%s' "$out" | tr '\n' ' ' | cut -c1-160)"
fi

# 10. A database whose jobs table is unreadable refuses — a failed query is not a zero.
rm -rf "$tmp/m_bad"; mkdir -p "$tmp/m_bad"
printf 'not a sqlite database at all' > "$tmp/m_bad/nomad.db"
docker_env "$tmp/m_bad"
r="$(drive "$tmp/env.docker" "$tmp/dbin")"
st="${r%%|*}"
if [ "$st" != "0" ]; then
  good "docker mode: an unreadable database refuses rather than reporting zero"
else
  bad "docker mode: an unreadable database refuses rather than reporting zero" "status=0"
fi

# 11. ACN with a SQLite client still takes NOMAD_DB_NAME and never consults the mount —
#     the ACN branch sets the database itself, so docker mode must not override it.
rm -rf "$tmp/acn"; mkdir -p "$tmp/acn"
mkdb "$tmp/acn/nomad.db" running
docker_env "$tmp/m_named" "NOMAD_DEPLOYMENT_MODE=ACN" "NOMAD_DB_CLIENT=better-sqlite3" \
  "NOMAD_DB_NAME=$tmp/acn/nomad.db"
: > "$tmp/docker-calls"
r="$(drive "$tmp/env.docker" "$tmp/dbin")"
st="${r%%|*}"
if [ "$st" != "0" ] && [ ! -s "$tmp/docker-calls" ]; then
  good "docker mode: ACN with a SQLite client uses NOMAD_DB_NAME and makes no docker call"
else
  bad "docker mode: ACN with a SQLite client uses NOMAD_DB_NAME and makes no docker call" \
      "status=$st docker_called=$([ -s "$tmp/docker-calls" ] && echo yes || echo no)"
fi

# 12. ACN with an unsupported client is refused and NAMED, in docker mode.
docker_env "$tmp/m_named" "NOMAD_DEPLOYMENT_MODE=ACN" "NOMAD_DB_CLIENT=pg"
r="$(drive "$tmp/env.docker" "$tmp/dbin")"
st="${r%%|*}"; out="${r#*|}"
if [ "$st" != "0" ] && printf '%s' "$out" | grep -q "pg"; then
  good "docker mode: an unsupported database client is refused and NAMED"
else
  bad "docker mode: an unsupported database client is refused and NAMED" \
      "status=$st out=$(printf '%s' "$out" | tr '\n' ' ' | cut -c1-160)"
fi

# 13. NOTHING is pulled, tagged or recreated before a refusal. `docker inspect` is a READ
#     and is expected; a pull, tag or run is not. Asserted on the recorded argv, with the
#     inspect present as the control that the recorder is live at all.
rm -rf "$tmp/m_run"; mkdir -p "$tmp/m_run"
mkdb "$tmp/m_run/nomad.db" running
docker_env "$tmp/m_run"
: > "$tmp/docker-calls"
drive "$tmp/env.docker" "$tmp/dbin" >/dev/null
if grep -q "inspect" "$tmp/docker-calls" \
   && ! grep -qE "(^| )(pull|tag|run|compose|rm|stop)( |$)" "$tmp/docker-calls"; then
  good "docker mode: only a read-only inspect happens before a refusal — no pull, tag or run"
else
  bad "docker mode: only a read-only inspect happens before a refusal — no pull, tag or run" \
      "calls: $(tr '\n' ';' < "$tmp/docker-calls" | cut -c1-200)"
fi

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
