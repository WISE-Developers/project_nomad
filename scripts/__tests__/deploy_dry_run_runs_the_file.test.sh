#!/usr/bin/env bash
#
# `deploy.sh --dry-run` must RUN — the whole file, top to bottom, as a program.
#
# WHY THIS EXISTS, and why it is not the same test as the one beside it.
# v0.70.0's deploy.sh aborted every real deploy with
#
#     deploy.sh: line 481: preflight_jobs: command not found
#
# because #572's helpers were defined inside `main`'s body. Fifteen suites
# covering deploy.sh were green, because every one of them EXTRACTS the function
# it tests with `sed -n '/^name() {/,/^}/p'` and sources the fragment. A nested
# definition still starts at column 0, so extraction kept working perfectly
# while the program it came from could not start.
#
# `deploy_defines_its_functions.test.sh` asks bash what the file defines.
# This one does the other half: it builds a throwaway world and EXECUTES
# deploy.sh in it, so the file is exercised as a file. Between them, a helper
# dropped into the wrong brace has nowhere to hide.
#
# WHAT IS FAKED, AND WHAT DELIBERATELY IS NOT. The git repository, the remote,
# the `.env` and the SQLite database are real — built here, thrown away after.
# Nothing about deploy.sh is stubbed or extracted: the file under test is the
# file that ships, copied byte for byte.
#
# THE ASSERTION IS ON THE OUTPUT, NOT THE EXIT CODE, AND THAT IS THE POINT.
# `--dry-run` reports what a real deploy would refuse instead of refusing, so it
# calls the preflights as `preflight_jobs ".env" || print_warning ...`. A missing
# function returns 127, `|| print_warning` swallows it, and the dry run exits 0.
# **On the broken file this test would PASS if it checked only the exit code.**
# So it asserts that `command not found` never appears — and proves that
# assertion can fail, by running the same check against a copy with one helper
# renamed out from under its caller.
#
# Deps: bash 3.x, git, python3 (or sqlite3). Exit 0 = all pass, 1 = any failure.
set -u

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPTS="$TEST_DIR/.."
DEPLOY="$SCRIPTS/deploy.sh"
[ -f "$DEPLOY" ] || { echo "deploy.sh not found at $DEPLOY"; exit 1; }

command -v git >/dev/null 2>&1 || { echo "SKIP: git is required"; exit 0; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

pass=0; fail=0
ok()  { echo "  ok   - $1"; pass=$((pass+1)); }
bad() { echo "  FAIL - $1"; [ -n "${2:-}" ] && echo "         $2"; fail=$((fail+1)); }

# ---- build a throwaway deployment ------------------------------------------
#
# deploy.sh resolves its root as the parent of its own directory, so the script
# has to live at <root>/scripts/deploy.sh for the layout to be real.
build_world() {
    local root="$1" script_src="$2"
    mkdir -p "$root/scripts" "$root/data"
    cp "$script_src" "$root/scripts/deploy.sh"
    chmod +x "$root/scripts/deploy.sh"

    # A real repo with a real remote, so `git fetch` and `git rev-parse
    # origin/<branch>` resolve rather than being mocked into always agreeing.
    git init -q --bare "$root.origin.git"
    (
        cd "$root"
        git init -q
        git config user.email "test@example.invalid"
        git config user.name "deploy test"
        git config commit.gpgsign false
        git add -A >/dev/null 2>&1
        git commit -qm "world" >/dev/null 2>&1
        git branch -M main >/dev/null 2>&1
        git remote add origin "$root.origin.git"
        git push -q origin main >/dev/null 2>&1
        git fetch -q origin main >/dev/null 2>&1
    )

    # The three unconditionally required keys, plus SAN so the running-jobs
    # check takes its SQLite path.
    #
    # COMPOSE_PROJECT_NAME IS REQUIRED HERE, and an earlier draft of this file
    # left it out on the belief that an unset FIRESTARR_EXECUTION_MODE means
    # binary mode. It does not — unset means DOCKER, so the key is demanded, and
    # preflight_env refused this fixture until it was added. A declared default
    # is not a running value, including in a test's own assumptions.
    {
        echo "NOMAD_HOME_TIMEZONE=America/Edmonton"
        echo "NOMAD_USAGE_LOG_PATH=/tmp/usage.jsonl"
        echo "NOMAD_USAGE_LOG_MAX_BYTES=52428800"
        echo "NOMAD_DEPLOYMENT_MODE=SAN"
        echo "NOMAD_DATA_PATH=$root/data"
        echo "COMPOSE_PROJECT_NAME=nomad-dry-run-test"
    } > "$root/.env"

    # A real database with a real jobs table and one terminal row, so the
    # running-jobs query returns a genuine 0 in flight against a genuine total.
    python3 - "$root/data/nomad.db" <<'PY' 2>/dev/null || true
import sqlite3, sys
con = sqlite3.connect(sys.argv[1])
con.execute("create table jobs (id integer primary key, status text)")
con.execute("insert into jobs (status) values ('completed')")
con.commit()
PY
}

run_dry() {
    local root="$1"
    # A FAKE `docker` IS REQUIRED HERE, AND LEAVING IT OUT MADE THIS GUARD
    # NON-DETERMINISTIC (#582).
    #
    # preflight_jobs now locates the database by asking Docker which host path is
    # mounted at the container's data directory. With nothing faked, this test passed
    # when a local Docker daemon happened to be responding and FAILED when it was not —
    # identical code, different verdict, and the failure read as "preflight_jobs did not
    # report its success line". A real-file guard whose result depends on the developer's
    # colima state is not a guard.
    #
    # It answers the mount inspect with this fixture's own data directory and stays silent
    # for anything else, so the dry run reaches the running-jobs success line on the SAME
    # path a real deploy would take.
    mkdir -p "$root/fakebin"
    cat > "$root/fakebin/docker" <<EOF
#!/usr/bin/env bash
case "\$1" in
  inspect) printf '%s' "$root/data"; exit 0 ;;
esac
exit 0
EOF
    chmod +x "$root/fakebin/docker"
    ( cd "$root" && PATH="$root/fakebin:$PATH" bash scripts/deploy.sh --dry-run 2>&1 )
}

# ---- 1. the real file runs ---------------------------------------------------
echo "deploy.sh --dry-run, executed as a program"

world="$tmp/app"
build_world "$world" "$DEPLOY"

if [ -f "$world/data/nomad.db" ]; then
    ok "control: the throwaway world has a real database to read"
else
    bad "control: no database was created" "the running-jobs path cannot be exercised"
fi

out="$(run_dry "$world")"; rc=$?

if [ "$rc" -eq 0 ]; then
    ok "exit 0"
else
    bad "exit $rc" "$(printf '%s' "$out" | tail -5)"
fi

if printf '%s' "$out" | grep -q 'command not found'; then
    bad "the run reported 'command not found'" \
        "$(printf '%s' "$out" | grep 'command not found' | head -3)"
else
    ok "no 'command not found' anywhere in the output"
fi

# The dry run has to have reached its own work, or the two checks above pass on
# a script that bailed out in its first ten lines.
if printf '%s' "$out" | grep -q '\[dry-run\]'; then
    ok "the dry-run path was reached"
else
    bad "no [dry-run] marker in the output" "$(printf '%s' "$out" | tail -5)"
fi

if printf '%s' "$out" | grep -q 'would move'; then
    ok "it resolved the commit move against the real remote"
else
    bad "it never reported the commit move" "$(printf '%s' "$out" | tail -5)"
fi

# preflight_env and preflight_jobs are the two calls that sit in the middle of
# main. If either is unreachable the run says so, and these are the lines that
# prove they actually executed rather than being skipped.
# These two assert the EXACT success line each preflight prints, and nothing
# broader. An earlier draft accepted `REFUSING TO DEPLOY` as proof that
# preflight_jobs had run — and it passed on the broken file, because
# preflight_env prints that same phrase on its own refusals. An assertion that
# one function satisfies on another's behalf cannot fail for the reason it
# claims to test.
if printf '%s' "$out" | grep -q 'Required .env keys present'; then
    ok "preflight_env ran and passed"
else
    bad "preflight_env did not report its success line" "$(printf '%s' "$out" | tail -8)"
fi

if printf '%s' "$out" | grep -q 'No jobs pending or running'; then
    ok "preflight_jobs ran, read the database and passed"
else
    bad "preflight_jobs did not report its success line" \
        "only preflight_jobs prints this; its absence means the call did not reach the function"
fi

# ---- 2. the mutation control -------------------------------------------------
#
# Rename one helper's DEFINITION and leave its CALL alone. That is this bug in
# miniature: the call site is fine, the name is simply not there when main runs.
# If the checks above cannot go red on this, they cannot go red on the real
# thing either.
echo
echo "mutation control: a helper renamed out from under its caller must be caught"

mutant="$tmp/mutant-deploy.sh"
sed 's/^preflight_jobs() {/preflight_jobs_RENAMED() {/' "$DEPLOY" > "$mutant"

if [ "$(grep -c '^preflight_jobs_RENAMED() {' "$mutant")" = "1" ]; then
    ok "control: the mutation applied"
else
    bad "control: the mutation did not apply" "the control below proves nothing"
fi

mworld="$tmp/mapp"
build_world "$mworld" "$mutant"
mout="$(run_dry "$mworld")" || true

if printf '%s' "$mout" | grep -q 'command not found'; then
    ok "the mutant DOES report 'command not found', so the check discriminates"
else
    bad "the mutant ran clean" \
        "the 'command not found' assertion cannot fail, so its pass above is meaningless"
fi

# And the exit-code-only version of this test would have missed it. Recorded as
# an assertion so nobody simplifies this file back into one.
mrc=0
( cd "$mworld" && bash scripts/deploy.sh --dry-run >/dev/null 2>&1 ) || mrc=$?
if [ "$mrc" -eq 0 ]; then
    ok "the mutant still exits 0 — which is why this suite asserts on OUTPUT, not exit code"
else
    ok "the mutant exits $mrc (it would also have been caught by exit code here)"
fi

echo
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ] || exit 1
