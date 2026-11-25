#!/usr/bin/env bash
#
# `deploy.sh`'s self-update re-exec must PRESERVE its arguments — issue #575.
#
# The script re-executes itself when a pull changes it, and its own comment at
# that point says "Arguments pass through, or --dry-run would quietly become a
# real deploy." The code did not do that. The option-parse loop runs at TOP
# LEVEL and `shift`s the positional parameters away, so by the time main() is
# invoked as `main "$@"` there is nothing left, and `exec "$SCRIPT_PATH" "$@"`
# re-ran the new copy with NO arguments. Every flag silently reverted to its
# default — most dangerously BRANCH, which became `main`.
#
# MEASURED IN PRODUCTION-SHAPED CONDITIONS, 2026-11-24, on the rehearsal box:
#
#   [INFO] Deploying /home/sage/nomad-app from origin/rehearse/570-stack as sage
#   [OK]   Checkout e2491b1 -> c5a0b9b
#   [INFO] deploy.sh changed in this pull — re-running the new version
#   [INFO] Deploying /home/sage/nomad-app from origin/main as sage   <-- lost
#
# It did no harm only because the requested branch happened to be an ancestor of
# the commit already checked out. With any other branch the operator asks for
# one thing, gets `main`, and is told it succeeded.
#
# WHAT THIS SUITE DRIVES. The real script, with a fake `git` whose `pull`
# APPENDS A LINE TO deploy.sh — which is what a pull that updates the script
# does, and it is the only way to make the self-update branch fire. The
# assertion is on the script's own observable, the line it prints on each pass:
#   "Deploying <root> from origin/<BRANCH> as <owner>"
# A correct re-exec prints the requested branch twice. The defect prints the
# requested branch once and then `main`.
#
# Deps: bash 3.x, shasum, sed, grep. Exit 0 = all pass, 1 = any failure.
set -u

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REAL_DEPLOY="$TEST_DIR/../deploy.sh"

pass=0; fail=0
ok()  { echo "  ok   - $1"; pass=$((pass+1)); }
bad() { echo "  FAIL - $1"; [ -n "${2:-}" ] && echo "         $2"; fail=$((fail+1)); }

echo "deploy_reexec_argv"

[ -f "$REAL_DEPLOY" ] || { echo "  deploy.sh not found at $REAL_DEPLOY"; exit 1; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# ---- a sandbox that looks enough like a deployment to reach the re-exec ----
# $sandbox/scripts/deploy.sh is a COPY of the real script, so the fake pull can
# modify it without touching the repository.
build_sandbox() {
  local sandbox="$1"
  rm -rf "$sandbox"; mkdir -p "$sandbox/scripts" "$sandbox/bin"
  cp "$REAL_DEPLOY" "$sandbox/scripts/deploy.sh"
  chmod +x "$sandbox/scripts/deploy.sh"
  {
    echo "NOMAD_HOME_TIMEZONE=America/Edmonton"
    echo "NOMAD_USAGE_LOG_PATH=/appl/data/usage/usage.jsonl"
    echo "NOMAD_USAGE_LOG_MAX_BYTES=52428800"
    echo "FIRESTARR_EXECUTION_MODE=docker"
    echo "COMPOSE_PROJECT_NAME=sandbox-project"
    echo "NOMAD_FRONTEND_HOST_PORT=127.0.0.1:59999"
  } > "$sandbox/.env"

  # Fake git. `pull` mutates the deploy.sh copy, which is what makes the
  # self-update check fire; everything else answers plausibly and does nothing.
  cat > "$sandbox/bin/git" <<FAKEGIT
#!/usr/bin/env bash
case "\$1 \$2" in
  "rev-parse --short")  echo "aaaaaaa"; exit 0 ;;
esac
case "\$1" in
  pull)
    echo "# pulled change that rewrites this script" >> "$sandbox/scripts/deploy.sh"
    echo "Updating aaaaaaa..bbbbbbb"; exit 0 ;;
  fetch|config|log|status|checkout|tag) exit 0 ;;
  rev-parse) echo "aaaaaaa"; exit 0 ;;
esac
exit 0
FAKEGIT
  chmod +x "$sandbox/bin/git"

  # Fake docker: succeeds and records nothing of interest here. The chain probe
  # and any image work must not reach a real daemon.
  cat > "$sandbox/bin/docker" <<'FAKEDOCKER'
#!/usr/bin/env bash
case "$*" in
  *"compose pull"*|*"compose up"*|*"image inspect"*|*"inspect"*|*"tag"*) exit 0 ;;
esac
exit 0
FAKEDOCKER
  chmod +x "$sandbox/bin/docker"
}

# drive <branch> -> "<status>|<output>"
drive() {
  local branch="$1"
  local sandbox="$tmp/s"
  build_sandbox "$sandbox"
  local out status
  out="$(cd "$sandbox" && PATH="$sandbox/bin:$PATH" NOMAD_DEPLOY_REEXEC= \
         bash "$sandbox/scripts/deploy.sh" --branch "$branch" 2>&1)"
  status=$?
  printf '%s|%s' "$status" "$out"
}

BR="rehearse-only-branch"
r="$(drive "$BR")"
out="${r#*|}"

# ---- 0. the mechanism under test must have fired at all -------------------
# Without this, every assertion below could pass for the wrong reason: a run
# that never re-executed prints the requested branch once and nothing else,
# which satisfies "the branch appears" while testing nothing.
if printf '%s' "$out" | grep -q "re-running the new version"; then
  ok "the self-update re-exec actually fired (precondition)"
else
  bad "the self-update re-exec actually fired (precondition)" \
      "no re-exec in the output — the rest of this suite would pass vacuously"
  echo "$out" | tail -5 | sed 's/^/         | /'
  echo ""
  echo "  $pass passed, $((fail+1)) failed"
  exit 1
fi

# ---- 1. the requested branch survives the re-exec -------------------------
count_requested="$(printf '%s' "$out" | grep -c "from origin/${BR}" || true)"
if [ "$count_requested" -ge 2 ]; then
  ok "the requested branch is used on BOTH passes (appears ${count_requested}x)"
else
  bad "the requested branch is used on BOTH passes" \
      "'from origin/${BR}' appeared ${count_requested}x; the re-exec dropped it"
fi

# ---- 2. it must never silently fall back to the default branch ------------
if printf '%s' "$out" | grep -q "from origin/main"; then
  bad "the default branch is NEVER substituted after a re-exec" \
      "found 'from origin/main' although --branch ${BR} was requested"
else
  ok "the default branch is NEVER substituted after a re-exec"
fi

# ---- 3. the argv capture must exist and precede the parse loop ------------
# A structural check, because the two assertions above would also pass if
# someone made BRANCH an environment variable instead. The capture has to come
# BEFORE the `while [ $# -gt 0 ]` loop or there is nothing left to capture.
cap_line="$(grep -n 'ORIGINAL_ARGV=(' "$REAL_DEPLOY" | head -1 | cut -d: -f1)"
loop_line="$(grep -n 'while \[ \$# -gt 0 \]' "$REAL_DEPLOY" | head -1 | cut -d: -f1)"
if [ -n "$cap_line" ] && [ -n "$loop_line" ] && [ "$cap_line" -lt "$loop_line" ]; then
  ok "argv is captured (line $cap_line) BEFORE the parse loop (line $loop_line)"
else
  bad "argv is captured BEFORE the parse loop" \
      "capture=${cap_line:-missing} loop=${loop_line:-missing}"
fi

# ---- 4. the exec must use the capture, not the consumed "$@" -------------
if grep -qE 'exec "\$SCRIPT_PATH" "\$@"' "$REAL_DEPLOY"; then
  bad "the re-exec does not pass the already-consumed \$@" \
      'exec "$SCRIPT_PATH" "$@" is still present; $@ is empty inside main'
else
  ok "the re-exec does not pass the already-consumed \$@"
fi
# Matched loosely on purpose: the expansion must be guarded as
# ${ORIGINAL_ARGV[@]+"${ORIGINAL_ARGV[@]}"} because `set -euo pipefail` plus
# bash 3.2 treats "${arr[@]}" on an EMPTY array as an unbound variable, which
# would break every argument-less deploy. Pinning the exact spelling would fail
# a correct implementation.
if grep -qE 'exec "\$SCRIPT_PATH" .*ORIGINAL_ARGV' "$REAL_DEPLOY"; then
  ok "the re-exec passes the captured argv"
else
  bad "the re-exec passes the captured argv" "no exec using ORIGINAL_ARGV found"
fi

echo ""
echo "  $pass passed, $fail failed"
[ "$fail" -eq 0 ] || exit 1
