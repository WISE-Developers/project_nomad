#!/usr/bin/env bash
#
# The UPGRADE path for COMPOSE_PROJECT_NAME — issue #570.
#
# A fresh install can ask for a name with nothing at stake. An upgrade cannot:
# the stack is ALREADY RUNNING under a compose project name, usually its install
# folder name, because that is what Docker Compose derives when nothing is set.
#
# Adopting the WRONG name on upgrade is worse than leaving the key unset. The
# startup sweep would then look for `nomad-run-*` containers under a name this
# deployment never used — and could match another deployment that did. That is
# the same harm as the old shared `project_nomad` default, arrived at from the
# other direction.
#
# So the contract this suite enforces is:
#
#   prompt_compose_project_name <env_file>
#     - asks `docker compose ls` what this stack currently runs under
#     - OFFERS the detected name as the prompt default
#     - echoes the chosen name on stdout and returns 0
#     - echoes NOTHING and returns non-zero when no name was chosen
#     - NEVER writes a value the operator did not see and accept
#
# Pressing Enter accepting a shown default IS the operator choosing it. Writing
# a detected value without showing it is not, however confident the detection.
#
# THE CLASS IS THE FOUR BASH DOCKER INSTALLERS. install_nomad_setup.sh,
# install-nomad-headless.sh and install-nomad-demo.sh build .env key-by-key.
# install-nomad-san-docker.sh instead copies the example and then fills it in
# through its own generate_env(), which is why it was the near-miss: it has no
# update_env_value by that name, the example ships this key blank, and so a
# docker install from it cannot boot. A fix
# applied to one sibling is not applied to the others, so all four are driven.
#
# install-nomad-san-docker.ps1 is the fifth docker installer and is driven for
# real by compose_project_name_ps1.test.sh, in PowerShell, with these same
# cases — not grep-asserted.
#
# The metal installers are exempt: binary mode labels and sweeps no containers.
#
# The fake-`docker`-on-PATH shape is the one
# backend/src/infrastructure/docker/__tests__/DockerExecutor.cancel.test.ts
# already uses in this repo, so a real daemon is never touched.
#
# Deps: bash 3.x (macOS ships 3.2), sed, grep. Exit 0 = all pass, 1 = any failure.
set -u

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPTS="$TEST_DIR/.."
INSTALLERS="install_nomad_setup.sh install-nomad-headless.sh install-nomad-demo.sh install-nomad-san-docker.sh"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

pass=0; fail=0
ok()  { echo "    ok   - $1"; pass=$((pass+1)); }
bad() { echo "    FAIL - $1"; [ -n "${2:-}" ] && echo "           $2"; fail=$((fail+1)); }

echo "compose_project_name_upgrade"

# ---- fake docker ---------------------------------------------------------
# $tmp/bin/docker answers `compose ls` from a file, so each case can choose
# what the daemon appears to say. Absent file = daemon unreachable.
mkdir -p "$tmp/bin"
cat > "$tmp/bin/docker" <<'FAKE'
#!/usr/bin/env bash
if [ "${1:-}" = "compose" ] && [ "${2:-}" = "ls" ]; then
  if [ -f "$FAKE_COMPOSE_LS" ]; then
    cat "$FAKE_COMPOSE_LS"
    exit 0
  fi
  echo "Cannot connect to the Docker daemon." >&2
  exit 1
fi
exit 0
FAKE
chmod +x "$tmp/bin/docker"

ONE_PROJECT="$tmp/one.txt"
cat > "$ONE_PROJECT" <<'OUT'
NAME                STATUS              CONFIG FILES
nomad_demo          running(3)          /opt/nomad/docker-compose.yaml
OUT

TWO_PROJECTS="$tmp/two.txt"
cat > "$TWO_PROJECTS" <<'OUT'
NAME                STATUS              CONFIG FILES
nomad_demo          running(3)          /opt/nomad/docker-compose.yaml
other_stack         running(2)          /srv/other/docker-compose.yaml
OUT

# Drive the extracted function.
#   $1 installer   $2 fake `docker compose ls` file ("" = daemon unreachable)
#   $3 stdin to feed
# Prints:  <exit status>|<stdout of the function>
drive() {
  local installer="$1" lsfile="$2" input="$3"
  local f="$SCRIPTS/$installer"
  local d="$tmp/run"; rm -rf "$d"; mkdir -p "$d"

  sed -n '/^prompt_compose_project_name() {/,/^}/p' "$f" > "$d/fn.sh"
  if [ ! -s "$d/fn.sh" ]; then
    echo "NOFN|"
    return
  fi

  : > "$d/.env"
  {
    echo 'set -u'
    # Stubs for the logging helpers the installers use. The two families differ:
    # install-nomad-headless.sh uses print_info/print_warning, install-nomad-demo.sh
    # uses info/warn. Stubbing only one family has silently broken a suite before.
    echo 'print_info() { :; }; print_warning() { :; }; print_error() { :; }; print_dry_run() { :; }'
    echo 'info() { :; }; warn() { :; }; error() { :; }; dry() { :; }'
    cat "$d/fn.sh"
    echo 'prompt_compose_project_name "$1"'
  } > "$d/harness.sh"

  local out status
  out="$(FAKE_COMPOSE_LS="$lsfile" PATH="$tmp/bin:$PATH" \
         printf '%s' "$input" | FAKE_COMPOSE_LS="$lsfile" PATH="$tmp/bin:$PATH" \
         bash "$d/harness.sh" "$d/.env" 2>/dev/null)"
  status=$?
  echo "${status}|${out}"
}

for installer in $INSTALLERS; do
  echo "  $installer"
  f="$SCRIPTS/$installer"
  if [ ! -f "$f" ]; then
    bad "$installer exists" "not found at $f"
    continue
  fi

  # ---- a) one running project: the detected name is OFFERED, Enter takes it
  r="$(drive "$installer" "$ONE_PROJECT" $'\n')"
  if [ "${r%%|*}" = "NOFN" ]; then
    bad "offers the name the stack already runs under" \
        "prompt_compose_project_name() not found -- cannot be driven"
    bad "an empty reply accepts the offered name" "same"
    bad "an explicit reply overrides the offered name" "same"
    bad "declining writes nothing" "same"
    bad "an unreachable daemon still asks rather than guessing" "same"
    bad "two candidate projects are not auto-adopted" "same"
    continue
  fi
  if [ "${r#*|}" = "nomad_demo" ]; then
    ok "an empty reply accepts the offered name"
  else
    bad "an empty reply accepts the offered name" "expected nomad_demo, got: '${r#*|}' (status ${r%%|*})"
  fi

  # ---- b) the detection must come from `docker compose ls`, not the folder
  if grep -qE 'docker[[:space:]]+compose[[:space:]]+ls' "$f"; then
    ok "detects the current name from docker compose ls"
  else
    bad "detects the current name from docker compose ls" \
        "the folder name is a guess; the running project is a fact"
  fi

  # ---- c) an explicit reply wins over the offered default
  r="$(drive "$installer" "$ONE_PROJECT" $'my_own_name\n')"
  if [ "${r#*|}" = "my_own_name" ]; then
    ok "an explicit reply overrides the offered name"
  else
    bad "an explicit reply overrides the offered name" "expected my_own_name, got: '${r#*|}'"
  fi

  # ---- d) no reply at all (EOF, as in a non-interactive run) writes NOTHING
  # This is the silent-write case. EOF is not consent.
  r="$(drive "$installer" "$ONE_PROJECT" '')"
  if [ "${r%%|*}" != "0" ] && [ -z "${r#*|}" ]; then
    ok "declining writes nothing"
  else
    bad "declining writes nothing" \
        "EOF must not be read as acceptance; got status ${r%%|*} and value '${r#*|}'"
  fi

  # ---- e) daemon unreachable: ask, do not crash and do not guess
  r="$(drive "$installer" "" $'typed_by_hand\n')"
  if [ "${r#*|}" = "typed_by_hand" ]; then
    ok "an unreachable daemon still asks rather than guessing"
  else
    bad "an unreachable daemon still asks rather than guessing" \
        "the key is still required, so the installer must fall back to asking; got: '${r#*|}'"
  fi

  # ---- f) two candidates: do not silently pick one
  r="$(drive "$installer" "$TWO_PROJECTS" '')"
  if [ "${r%%|*}" != "0" ] && [ -z "${r#*|}" ]; then
    ok "two candidate projects are not auto-adopted"
  else
    bad "two candidate projects are not auto-adopted" \
        "with several projects on the daemon there is no safe default; got status ${r%%|*} value '${r#*|}'"
  fi
done

echo "  $pass passed, $fail failed"
[ "$fail" -eq 0 ] || exit 1
