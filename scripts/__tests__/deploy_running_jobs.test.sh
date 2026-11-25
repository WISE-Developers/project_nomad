#!/usr/bin/env bash
#
# `deploy.sh` must REFUSE to recreate the container while any job is pending or
# running, NAME the jobs, and require an explicit flag to override — issue #572.
#
# Measured on dev before this existed: deploy.sh had no reference to the jobs
# table, the database, or job state anywhere. A deploy tears down the running
# container and every FireSTARR run in flight dies with it; startup recovery
# then marks those jobs failed — correctly, they did fail — so the operator's
# model is gone and the record blames nothing the operator can see.
#
# FAIL CLOSED IS THE WHOLE DIFFICULTY. An empty result and a zero are the same
# bytes. A check that reads "0 non-terminal" out of a FAILED query is a guard
# that cannot fire, and it reads green on exactly the deploy that kills someone's
# model. So every assertion below that expects a refusal has a sibling that
# expects a pass, and the suite injects a fake `sqlite3` for the one case that
# cannot be built as a real database: the non-terminal count readable while the
# total is not.
#
# WHY THE POSITIVE CONTROL IS ASSERTED AND NOT ASSUMED. "0 non-terminal" is only
# trustworthy beside "N total" where N is plausible. If the total cannot be read,
# that is a refusal, not a pass — and that case has its own test here, because it
# is the one a naive implementation gets wrong while looking correct.
#
# SCOPE: SQLite only. No deployment runs Postgres today, so an unsupported client
# must be REFUSED AND NAMED rather than skipped — a check silently inert on an
# untested database is the same defect wearing a different costume.
#
# Deps: bash 3.x, python3 (for building fixture databases), sed, grep.
# Exit 0 = all pass, 1 = any failure.
set -u

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPTS="$TEST_DIR/.."
ROOT="$SCRIPTS/.."
DEPLOY="$SCRIPTS/deploy.sh"
JOB_TS="$ROOT/backend/src/domain/entities/Job.ts"
FN="preflight_jobs"

pass=0; fail=0
ok()  { echo "  ok   - $1"; pass=$((pass+1)); }
bad() { echo "  FAIL - $1"; [ -n "${2:-}" ] && echo "         $2"; fail=$((fail+1)); }

echo "deploy_running_jobs"

[ -f "$DEPLOY" ] || { echo "  deploy.sh not found at $DEPLOY"; exit 1; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# ---- fixture database builder ---------------------------------------------
# Built with python3's sqlite3 module so the suite does not depend on the
# sqlite3 CLI being installed on the machine running the tests.
# make_db <file> [status:id:model:started ...]
make_db() {
  local f="$1"; shift
  python3 - "$f" "$@" <<'PY'
import sqlite3, sys
f = sys.argv[1]
rows = sys.argv[2:]
c = sqlite3.connect(f)
c.execute("create table jobs (id text primary key, model_id text, status text, created_at text, started_at text)")
c.execute("create table fire_models (id text primary key, name text)")
for r in rows:
    jid, model, status, started = r.split("|")
    c.execute("insert into jobs values (?,?,?,?,?)", (jid, model, status, "2026-11-25T10:00:00Z", started))
    c.execute("insert or ignore into fire_models values (?,?)", (model, "model " + model))
c.commit(); c.close()
PY
}

# ---- a fake docker that RECORDS whether it was called ---------------------
# A refusal that happens after the container is gone is the outage this issue
# exists to prevent, and it would look identical to a clean refusal.
mkdir -p "$tmp/bin"
cat > "$tmp/bin/docker" <<'FAKE'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$DOCKER_CALLS"
exit 0
FAKE
chmod +x "$tmp/bin/docker"

write_env() {
  # write_env <file> [KEY=VALUE ...]
  local f="$1"; shift
  : > "$f"
  local kv
  for kv in "$@"; do echo "$kv" >> "$f"; done
}

# drive <env-file> [extra-path-dir] [extra env assignments...] -> "<status>|<output>"
# Extracts the function and runs it in isolation — the pattern every other
# deploy suite here uses, so deploy.sh's top-level flow never executes.
drive() {
  local envfile="$1"; shift
  local extradir="${1:-}"; [ $# -gt 0 ] && shift
  local d="$tmp/run"; rm -rf "$d"; mkdir -p "$d"
  sed -n "/^${FN}() {/,/^}/p" "$DEPLOY" > "$d/fn.sh"
  if [ ! -s "$d/fn.sh" ]; then echo "NOFN|"; return; fi
  # The function under test depends on two helpers and one constant, all defined
  # at top level in deploy.sh. Extract them too, or every case refuses with
  # "env_value: command not found" — which looks exactly like a correct refusal
  # and would have let this suite pass for the wrong reason.
  sed -n '/^env_value() {/,/^}/p'    "$DEPLOY" >  "$d/helpers.sh"
  sed -n '/^sqlite_query() {/,/^}/p' "$DEPLOY" >> "$d/helpers.sh"
  sed -n '/^ignore_jobs_override() {/,/^}/p' "$DEPLOY" >> "$d/helpers.sh"
  grep '^JOB_TERMINAL_STATUSES=' "$DEPLOY"     >> "$d/helpers.sh"
  {
    echo 'set -u'
    echo 'print_error()   { echo "$*"; }'
    echo 'print_warning() { echo "$*"; }'
    echo 'print_info()    { echo "$*"; }'
    echo 'print_success() { echo "$*"; }'
    echo 'DRY_RUN=false'
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

# ---- 0. the function must exist and be extractable ------------------------
r="$(drive "/dev/null")"
if [ "${r%%|*}" = "NOFN" ]; then
  bad "deploy.sh defines ${FN}() at top level" \
      "not found — deploy.sh performs no running-jobs check at all"
  for t in \
    "no non-terminal jobs lets the deploy proceed" \
    "a PENDING job is refused and NAMED" \
    "a RUNNING job is refused and NAMED" \
    "several non-terminal jobs are ALL named in one run" \
    "a query that ERRORS refuses and says the check could not run" \
    "a MISSING database refuses" \
    "an unreadable TOTAL refuses even when non-terminal reads 0" \
    "no sqlite tool at all refuses" \
    "the override flag proceeds and prints the jobs it will kill" \
    "the override flag appears in --help" \
    "nothing is pulled, tagged or recreated before a refusal" \
    "the terminal-status list agrees with Job.isTerminalStatus" \
    "an unsupported database client is refused and NAMED" \
    "the SQLite path honours NOMAD_DATA_PATH" \
    "the SQLite path falls back to FIRESTARR_DATASET_PATH" \
    ; do bad "$t" "no ${FN} to drive"; done
  echo ""
  echo "  $pass passed, $fail failed"
  exit 1
fi
ok "deploy.sh defines ${FN}() at top level"

# ---- 1. clean database: proceed -------------------------------------------
make_db "$tmp/clean.db" "j1|m1|completed|2026-11-25T09:00:00Z" "j2|m1|failed|2026-11-25T09:10:00Z"
write_env "$tmp/env.clean" "NOMAD_DEPLOYMENT_MODE=SAN" "NOMAD_DATA_PATH=$tmp/clean_dir"
mkdir -p "$tmp/clean_dir"; cp "$tmp/clean.db" "$tmp/clean_dir/nomad.db"
r="$(drive "$tmp/env.clean")"; st="${r%%|*}"; out="${r#*|}"
[ "$st" = "0" ] && ok "no non-terminal jobs lets the deploy proceed" \
  || bad "no non-terminal jobs lets the deploy proceed" "status=$st out=$out"

# ---- 2/3. a pending and a running job are refused AND NAMED ---------------
for pair in "pending:a PENDING" "running:a RUNNING"; do
  s="${pair%%:*}"; label="${pair#*:}"
  mkdir -p "$tmp/d_$s"
  make_db "$tmp/d_$s/nomad.db" "job-$s-1|model-7|$s|2026-11-25T09:30:00Z" "j9|m2|completed|x"
  write_env "$tmp/env.$s" "NOMAD_DEPLOYMENT_MODE=SAN" "NOMAD_DATA_PATH=$tmp/d_$s"
  r="$(drive "$tmp/env.$s")"; st="${r%%|*}"; out="${r#*|}"
  if [ "$st" != "0" ] && printf '%s' "$out" | grep -q "job-$s-1"; then
    ok "$label job is refused and NAMED"
  else
    bad "$label job is refused and NAMED" "status=$st (want non-zero), job id named=$(printf '%s' "$out" | grep -c "job-$s-1")"
  fi
done

# ---- 4. several non-terminal jobs are ALL named ---------------------------
mkdir -p "$tmp/d_many"
make_db "$tmp/d_many/nomad.db" \
  "job-aaa|m1|pending|2026-11-25T09:00:00Z" \
  "job-bbb|m2|running|2026-11-25T09:05:00Z" \
  "job-ccc|m3|pending|2026-11-25T09:06:00Z" \
  "job-ddd|m4|completed|x"
write_env "$tmp/env.many" "NOMAD_DEPLOYMENT_MODE=SAN" "NOMAD_DATA_PATH=$tmp/d_many"
r="$(drive "$tmp/env.many")"; st="${r%%|*}"; out="${r#*|}"
named=0
for j in job-aaa job-bbb job-ccc; do printf '%s' "$out" | grep -q "$j" && named=$((named+1)); done
if [ "$st" != "0" ] && [ "$named" = "3" ]; then
  ok "several non-terminal jobs are ALL named in one run"
else
  bad "several non-terminal jobs are ALL named in one run" "status=$st named=$named/3"
fi
if printf '%s' "$out" | grep -q 'job-ddd'; then
  bad "a terminal job is NOT named" "job-ddd (completed) was listed as in flight"
else
  ok "a terminal job is NOT named"
fi

# ---- 5. a query that ERRORS refuses --------------------------------------
mkdir -p "$tmp/d_bad"; printf 'this is not a database at all' > "$tmp/d_bad/nomad.db"
write_env "$tmp/env.bad" "NOMAD_DEPLOYMENT_MODE=SAN" "NOMAD_DATA_PATH=$tmp/d_bad"
r="$(drive "$tmp/env.bad")"; st="${r%%|*}"; out="${r#*|}"
if [ "$st" != "0" ] && printf '%s' "$out" | grep -qiE 'could not|cannot|unable|fail'; then
  ok "a query that ERRORS refuses and says the check could not run"
else
  bad "a query that ERRORS refuses and says the check could not run" "status=$st out=$out"
fi

# ---- 6. a MISSING database refuses ---------------------------------------
write_env "$tmp/env.missing" "NOMAD_DEPLOYMENT_MODE=SAN" "NOMAD_DATA_PATH=$tmp/does-not-exist"
r="$(drive "$tmp/env.missing")"; st="${r%%|*}"; out="${r#*|}"
[ "$st" != "0" ] && ok "a MISSING database refuses" \
  || bad "a MISSING database refuses" "status=$st out=$out"

# ---- 7. THE POSITIVE CONTROL, ASSERTED -----------------------------------
# Non-terminal reads 0 while the TOTAL cannot be read. This cannot be built as a
# real database, so a fake sqlite3 is injected: it answers the non-terminal
# query with 0 and errors on the total. A naive check passes here; a fail-closed
# one refuses.
mkdir -p "$tmp/fakebin" "$tmp/d_ctl"
make_db "$tmp/d_ctl/nomad.db" "j1|m1|completed|x"
cat > "$tmp/fakebin/sqlite3" <<'FAKESQL'
#!/usr/bin/env bash
# Any query mentioning "not in" (the non-terminal filter) answers 0.
# Everything else — notably the total — fails.
for a in "$@"; do
  case "$a" in
    *"not in"*|*"NOT IN"*) echo "0"; exit 0 ;;
  esac
done
echo "Error: unable to open database" >&2
exit 1
FAKESQL
chmod +x "$tmp/fakebin/sqlite3"
cat > "$tmp/fakebin/python3" <<'FAKEPY'
#!/usr/bin/env bash
# The implementation may fall back to python3; it must fail here too, or the
# fake sqlite3 above would simply be bypassed and this test would prove nothing.
echo "Error: unable to open database" >&2
exit 1
FAKEPY
chmod +x "$tmp/fakebin/python3"
write_env "$tmp/env.ctl" "NOMAD_DEPLOYMENT_MODE=SAN" "NOMAD_DATA_PATH=$tmp/d_ctl"
r="$(drive "$tmp/env.ctl" "$tmp/fakebin")"; st="${r%%|*}"; out="${r#*|}"
if [ "$st" != "0" ]; then
  ok "an unreadable TOTAL refuses even when non-terminal reads 0"
else
  bad "an unreadable TOTAL refuses even when non-terminal reads 0" \
      "status=0 — the positive control is not being asserted; a failed query was read as a zero"
fi

# ---- 8. no sqlite tool at all refuses ------------------------------------
mkdir -p "$tmp/emptybin"
write_env "$tmp/env.notool" "NOMAD_DEPLOYMENT_MODE=SAN" "NOMAD_DATA_PATH=$tmp/d_many"
d="$tmp/run"; rm -rf "$d"; mkdir -p "$d"
sed -n "/^${FN}() {/,/^}/p" "$DEPLOY" > "$d/fn.sh"
sed -n '/^env_value() {/,/^}/p'    "$DEPLOY" >  "$d/helpers.sh"
sed -n '/^sqlite_query() {/,/^}/p' "$DEPLOY" >> "$d/helpers.sh"
sed -n '/^ignore_jobs_override() {/,/^}/p' "$DEPLOY" >> "$d/helpers.sh"
grep '^JOB_TERMINAL_STATUSES=' "$DEPLOY"     >> "$d/helpers.sh"
{
  echo 'set -u'
  for f in print_error print_warning print_info print_success; do echo "$f() { echo \"\$*\"; }"; done
  echo 'DRY_RUN=false'; echo 'IGNORE_RUNNING_JOBS=false'
  cat "$d/helpers.sh"
  cat "$d/fn.sh"
  echo "${FN} \"\$1\""
} > "$d/harness.sh"
out="$(cd "$d" && PATH="$tmp/emptybin" DOCKER_CALLS="$tmp/docker-calls" /bin/bash "$d/harness.sh" "$tmp/env.notool" 2>&1)"; st=$?
[ "$st" != "0" ] && ok "no sqlite tool at all refuses" \
  || bad "no sqlite tool at all refuses" "status=$st out=$out"

# ---- 9. the override flag proceeds AND prints what it will kill ----------
r="$(drive "$tmp/env.many" "" IGNORE_RUNNING_JOBS=true)"; st="${r%%|*}"; out="${r#*|}"
if [ "$st" = "0" ] && printf '%s' "$out" | grep -q 'job-aaa'; then
  ok "the override flag proceeds and prints the jobs it will kill"
else
  bad "the override flag proceeds and prints the jobs it will kill" \
      "status=$st (want 0), named job-aaa=$(printf '%s' "$out" | grep -c 'job-aaa')"
fi

# ---- 10. the override flag appears in --help ----------------------------
# --help prints lines 2-12 of the script, so the flag has to be documented there
# and not merely parsed.
if sed -n '2,12p' "$DEPLOY" | grep -q 'ignore-running-jobs'; then
  ok "the override flag appears in --help"
else
  bad "the override flag appears in --help" \
      "not in lines 2-12, which is what -h/--help prints"
fi

# ---- 11. nothing is pulled, tagged or recreated before a refusal --------
: > "$tmp/docker-calls"
r="$(drive "$tmp/env.many")"
if [ -s "$tmp/docker-calls" ]; then
  bad "nothing is pulled, tagged or recreated before a refusal" \
      "docker was called: $(head -3 "$tmp/docker-calls" | tr '\n' ' ')"
else
  ok "nothing is pulled, tagged or recreated before a refusal"
fi
# CONTROL: the recorder must actually record, or the assertion above is vacuous.
DOCKER_CALLS="$tmp/docker-calls" PATH="$tmp/bin:$PATH" docker compose pull nomad >/dev/null 2>&1 || true
if [ -s "$tmp/docker-calls" ]; then
  ok "CONTROL: the docker recorder does record when docker IS called"
else
  bad "CONTROL: the docker recorder does record when docker IS called" \
      "the recorder is broken, so the assertion above proved nothing"
fi

# ---- 12. the terminal-status list must agree with the code --------------
# Job.isTerminalStatus is the definition. A list retyped into a shell script is
# one more thing that drifts, and the drift is invisible until a deploy kills a
# job it should have refused over.
if [ -f "$JOB_TS" ]; then
  code_terms="$(sed -n '/isTerminalStatus(status: JobStatus)/,/}/p' "$JOB_TS" \
    | grep -oE 'JobStatus\.[A-Za-z]+' | sed 's/JobStatus\.//' | tr 'A-Z' 'a-z' | sort -u | tr '\n' ' ')"
  # Read the CONSTANT, which is where the list lives — reading the function body
  # found nothing and reported a drift that did not exist.
  sh_terms="$(grep '^JOB_TERMINAL_STATUSES=' "$DEPLOY" \
    | grep -oE "'(completed|failed|cancelled|pending|running)'" | tr -d "'" | sort -u | tr '\n' ' ')"
  if [ -z "$code_terms" ]; then
    bad "the terminal-status list agrees with Job.isTerminalStatus" \
        "could not read the definition out of Job.ts — this check cannot run"
  elif [ "$code_terms" = "$sh_terms" ]; then
    ok "the terminal-status list agrees with Job.isTerminalStatus ($code_terms)"
  else
    bad "the terminal-status list agrees with Job.isTerminalStatus" \
        "Job.ts says [$code_terms], deploy.sh says [$sh_terms]"
  fi
else
  bad "the terminal-status list agrees with Job.isTerminalStatus" "Job.ts not found"
fi

# ---- 13. an unsupported database client is refused AND NAMED -----------
write_env "$tmp/env.pg" "NOMAD_DEPLOYMENT_MODE=ACN" "NOMAD_DB_CLIENT=pg"
r="$(drive "$tmp/env.pg")"; st="${r%%|*}"; out="${r#*|}"
if [ "$st" != "0" ] && printf '%s' "$out" | grep -q 'pg'; then
  ok "an unsupported database client is refused and NAMED"
else
  bad "an unsupported database client is refused and NAMED" "status=$st out=$out"
fi
# ACN defaults to pg when the key is absent — that must refuse too.
write_env "$tmp/env.acn" "NOMAD_DEPLOYMENT_MODE=ACN"
r="$(drive "$tmp/env.acn")"; st="${r%%|*}"
[ "$st" != "0" ] && ok "ACN with no client set refuses (it defaults to pg)" \
  || bad "ACN with no client set refuses (it defaults to pg)" "status=$st"
# ACN *with* sqlite is supported by knexConfig.ts:69-73, so it must NOT refuse.
mkdir -p "$tmp/d_acnlite"; cp "$tmp/clean.db" "$tmp/d_acnlite/nomad.db"
write_env "$tmp/env.acnlite" "NOMAD_DEPLOYMENT_MODE=ACN" "NOMAD_DB_CLIENT=better-sqlite3" "NOMAD_DATA_PATH=$tmp/d_acnlite"
r="$(drive "$tmp/env.acnlite")"; st="${r%%|*}"
[ "$st" = "0" ] && ok "ACN with a SQLite client is checked, not refused" \
  || bad "ACN with a SQLite client is checked, not refused" "status=$st — knexConfig.ts:69-73 supports it"

# ---- 13b. the override must cover the FAIL-CLOSED paths too -------------
# Every refusal message tells the operator to re-run with --ignore-running-jobs.
# If the flag does not actually get them past that refusal, the message is a
# promise the code does not keep — and an operator on an unsupported database
# would have no way to deploy at all.
r="$(drive "$tmp/env.pg" "" IGNORE_RUNNING_JOBS=true)"; st="${r%%|*}"; out="${r#*|}"
if [ "$st" = "0" ] && printf '%s' "$out" | grep -qiE 'not (been )?(checked|verified|run)|without checking|unverified|skipp' ; then
  ok "the override gets past an unsupported client, and says the check did NOT run"
else
  bad "the override gets past an unsupported client, and says the check did NOT run" \
      "status=$st — the refusal message advises a flag that does not work"
fi
r="$(drive "$tmp/env.missing" "" IGNORE_RUNNING_JOBS=true)"; st="${r%%|*}"
[ "$st" = "0" ] && ok "the override gets past a missing database" \
  || bad "the override gets past a missing database" "status=$st"
r="$(drive "$tmp/env.bad" "" IGNORE_RUNNING_JOBS=true)"; st="${r%%|*}"
[ "$st" = "0" ] && ok "the override gets past an unreadable database" \
  || bad "the override gets past an unreadable database" "status=$st"
# ...and WITHOUT the flag every one of those still refuses, or the override has
# simply disabled the check rather than overriding it.
for e in env.pg env.missing env.bad; do
  r="$(drive "$tmp/$e")"; st="${r%%|*}"
  [ "$st" != "0" ] || bad "CONTROL: $e still refuses without the override" "status=0"
done
ok "CONTROL: all three still refuse without the override"

# ---- 14. the path fallback chain ---------------------------------------
# A hardcoded path would silently miss a deployment configured either of the
# other two ways, and "no jobs" from the wrong file is the guard not firing.
mkdir -p "$tmp/d_fs"
make_db "$tmp/d_fs/nomad.db" "job-fsfallback|m1|running|2026-11-25T09:00:00Z"
write_env "$tmp/env.fs" "NOMAD_DEPLOYMENT_MODE=SAN" "FIRESTARR_DATASET_PATH=$tmp/d_fs"
r="$(drive "$tmp/env.fs")"; st="${r%%|*}"; out="${r#*|}"
if [ "$st" != "0" ] && printf '%s' "$out" | grep -q 'job-fsfallback'; then
  ok "the SQLite path falls back to FIRESTARR_DATASET_PATH"
else
  bad "the SQLite path falls back to FIRESTARR_DATASET_PATH" "status=$st out=$out"
fi
# NOMAD_DATA_PATH must WIN over FIRESTARR_DATASET_PATH, as in knexConfig.ts.
write_env "$tmp/env.both" "NOMAD_DEPLOYMENT_MODE=SAN" "NOMAD_DATA_PATH=$tmp/clean_dir" "FIRESTARR_DATASET_PATH=$tmp/d_fs"
r="$(drive "$tmp/env.both")"; st="${r%%|*}"
[ "$st" = "0" ] && ok "NOMAD_DATA_PATH takes precedence over FIRESTARR_DATASET_PATH" \
  || bad "NOMAD_DATA_PATH takes precedence over FIRESTARR_DATASET_PATH" "status=$st — read the wrong database"

echo ""
echo "  $pass passed, $fail failed"
[ "$fail" -eq 0 ] || exit 1
