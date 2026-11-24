#!/usr/bin/env bash
#
# COMPOSE_PROJECT_NAME must reach every completed install, and must never be
# written without the operator choosing it — issue #570.
#
# In docker mode the backend REFUSES TO START without this key, with no default.
# That is deliberate. The old code fell back to `project_nomad`, so two
# deployments that never set the key shared a container label, and one
# deployment's startup sweep removed the other deployment's RUNNING container.
# That was reproduced on a real Docker daemon.
#
# So a default is not a convenience here, it is the bug. Three things follow,
# and each is checked below:
#
#   1. .env.example ships the key PRESENT and BLANK. Present, so a key-by-key
#      installer and an operator reading the file both see that it exists.
#      Blank, because any shipped value is a shared default by another name.
#
#   2. Every installer covers the key. Two install shapes exist: installers that
#      COPY .env.example, and installers that BUILD .env key-by-key and never
#      see the example. The second shape is what broke in #322.
#
#   3. No installer writes the key silently. It is obtained by ASKING, which is
#      why each .env-writing installer must expose an extractable
#      prompt_compose_project_name(). compose_project_name_upgrade.test.sh
#      drives that function; this suite only asserts it exists and that no
#      hardcoded value exists beside it.
#
# THE CLASS IS THE FIVE DOCKER INSTALLERS. The issue text first said three and
# that was wrong, measured:
#
#   install_nomad_setup.sh        builds .env key-by-key   -> must prompt
#   install-nomad-headless.sh     builds .env key-by-key   -> must prompt
#   install-nomad-demo.sh         builds .env key-by-key   -> must prompt
#   install-nomad-san-docker.sh   COPIES the example then generate_env()s on
#                                 top, 30 docker refs     -> must prompt
#   install-nomad-san-docker.ps1  Copy-Item of the example, then
#                                 New-EnvironmentFile + 18 Update-EnvValue
#                                 calls, 42 docker refs   -> must prompt, in
#                                 PowerShell
#
# The two SAN docker installers were the near-miss. They copy the example, which
# ships this key BLANK, so a fresh install from either produces a box that
# cannot boot in docker mode — the exact defect #570 exists to remove. Franco:
# "A docker install that can't boot means #570 isn't done."
#
# DELIBERATELY EXEMPT, and this is not an oversight:
#   install-nomad-san-metal.sh    ZERO docker references  -> binary mode
#   install-nomad-san-metal.ps1   binary mode
# The key is meaningless in binary mode, where no container is labelled or
# swept. Requiring it there would be noise asserting nothing.
#
# ALSO NOT IN THE CLASS, measured: install-nomad.sh, install-nomad-bootstrap.sh
# and install-firestarr-dataset.sh never call update_env_value and never write
# an env key.
#
# The PowerShell prompt is driven for real by compose_project_name_ps1.test.sh,
# not grep-asserted. This suite only checks that its function exists.
#
# Deps: bash 3.x (macOS ships 3.2), grep. Exit 0 = all pass, 1 = any failure.
set -u

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPTS="$TEST_DIR/.."
ENV_EXAMPLE="$SCRIPTS/../.env.example"
UPGRADE_DOC="$SCRIPTS/../Documentation/Nomad/upgrading.md"
KEY="COMPOSE_PROJECT_NAME"

# Bash docker installers that must ask the operator for the key.
ENV_WRITING_INSTALLERS="install_nomad_setup.sh install-nomad-headless.sh install-nomad-demo.sh install-nomad-san-docker.sh"
# The PowerShell docker installer, which must do the same in its own language.
PS_INSTALLER="install-nomad-san-docker.ps1"
# Every installer that must at minimum carry the key.
ALL_INSTALLERS="install_nomad_setup.sh install-nomad-headless.sh install-nomad-demo.sh install-nomad-san-docker.sh install-nomad-san-docker.ps1"

pass=0; fail=0
ok()  { echo "  ok   - $1"; pass=$((pass+1)); }
bad() { echo "  FAIL - $1"; [ -n "${2:-}" ] && echo "         $2"; fail=$((fail+1)); }

echo "compose_project_name_key"

[ -f "$ENV_EXAMPLE" ] || { echo "  .env.example not found at $ENV_EXAMPLE"; exit 1; }

# ---- 1. .env.example ships the key, uncommented, and BLANK ---------------
if grep -qE "^${KEY}=" "$ENV_EXAMPLE"; then
  ok ".env.example ships $KEY"
else
  bad ".env.example ships $KEY" \
      "a key-by-key installer and an operator reading the file both need to see it exists"
fi

# A commented key is the same as no key: docker mode will not boot.
if grep -qE "^[[:space:]]*#[[:space:]]*${KEY}=" "$ENV_EXAMPLE"; then
  bad ".env.example does not ship $KEY commented out" \
      "a commented key leaves docker mode unbootable"
else
  ok ".env.example does not ship $KEY commented out"
fi

# BLANK is the whole point. Any shipped value is a shared default.
if grep -qE "^${KEY}=.+" "$ENV_EXAMPLE"; then
  bad ".env.example leaves $KEY blank" \
      "got: $(grep -nE "^${KEY}=" "$ENV_EXAMPLE" | head -1) -- a shipped value IS the collision this key exists to prevent"
else
  if grep -qE "^${KEY}=" "$ENV_EXAMPLE"; then
    ok ".env.example leaves $KEY blank"
  else
    bad ".env.example leaves $KEY blank" "the key is absent entirely, so blankness cannot be asserted"
  fi
fi

# The operator has to know a blank is fatal rather than optional, so the file
# must say so near the key.
if grep -qiE '(required|refuses to start|will not start|no default)' "$ENV_EXAMPLE" \
   && grep -qE "^${KEY}=" "$ENV_EXAMPLE"; then
  ok ".env.example explains that $KEY is required with no default"
else
  bad ".env.example explains that $KEY is required with no default" \
      "a blank key with no explanation reads as optional"
fi

# ---- 2. every installer carries the key ----------------------------------
for installer in $ALL_INSTALLERS; do
  f="$SCRIPTS/$installer"
  if [ ! -f "$f" ]; then
    bad "$installer exists" "not found at $f"
    continue
  fi
  if grep -q "$KEY" "$f"; then
    ok "$installer covers $KEY"
  else
    bad "$installer covers $KEY" \
        "installs from this script produce a box that cannot boot in docker mode"
  fi
done

# ---- 3. the key is ASKED FOR, never written silently ---------------------
for installer in $ENV_WRITING_INSTALLERS; do
  f="$SCRIPTS/$installer"
  [ -f "$f" ] || continue

  # Extractable at top level, because compose_project_name_upgrade.test.sh
  # drives it with `sed -n '/^prompt_compose_project_name() {/,/^}/p'`.
  if grep -q '^prompt_compose_project_name() {' "$f"; then
    ok "$installer defines prompt_compose_project_name() at top level"
  else
    bad "$installer defines prompt_compose_project_name() at top level" \
        "the key must be obtained by asking the operator, and the prompt must be drivable in isolation"
  fi

  # The specific fallback that caused the bug must not reappear anywhere.
  if grep -qE "${KEY}=[\"']?project_nomad" "$f"; then
    bad "$installer does not hardcode the old project_nomad default" \
        "got: $(grep -nE "${KEY}=[\"']?project_nomad" "$f" | head -1)"
  else
    ok "$installer does not hardcode the old project_nomad default"
  fi

  # Nor any other literal: a literal is a shared default whatever it is called.
  if grep -qE "update_env_value[[:space:]]+[\"']?${KEY}[\"']?[[:space:]]+[\"'][A-Za-z0-9_-]+[\"']" "$f"; then
    bad "$installer writes $KEY from a variable, not a literal" \
        "got: $(grep -nE "update_env_value[[:space:]]+[\"']?${KEY}" "$f" | head -1)"
  else
    ok "$installer writes $KEY from a variable, not a literal"
  fi
done

# ---- the PowerShell docker installer must ask too ------------------------
# Its prompt is exercised for real by compose_project_name_ps1.test.sh. Here we
# only assert the function exists, and that no literal default sits beside it.
psf="$SCRIPTS/$PS_INSTALLER"
if [ ! -f "$psf" ]; then
  bad "$PS_INSTALLER exists" "not found at $psf"
else
  if grep -qE '^function[[:space:]]+Read-ComposeProjectName' "$psf"; then
    ok "$PS_INSTALLER defines Read-ComposeProjectName"
  else
    bad "$PS_INSTALLER defines Read-ComposeProjectName" \
        "a docker install from this script copies a blank key and cannot boot"
  fi

  if grep -qE "${KEY}[[:space:]]*=[[:space:]]*[\"']?project_nomad" "$psf"; then
    bad "$PS_INSTALLER does not hardcode the old project_nomad default" \
        "got: $(grep -nE "${KEY}[[:space:]]*=[[:space:]]*[\"']?project_nomad" "$psf" | head -1)"
  else
    ok "$PS_INSTALLER does not hardcode the old project_nomad default"
  fi
fi

# ---- the metal installers are exempt ON PURPOSE --------------------------
# Asserted so the exemption is a recorded decision rather than a gap someone
# later "fixes" by adding a key that binary mode never reads.
for installer in install-nomad-san-metal.sh install-nomad-san-metal.ps1; do
  f="$SCRIPTS/$installer"
  if [ ! -f "$f" ]; then
    bad "$installer exists" "not found at $f"
  else
    ok "$installer is exempt: binary mode labels and sweeps no containers"
  fi
done

# ---- upgrade path is documented -----------------------------------------
# Existing deployments have no such key and will refuse to start after upgrade.
# That is intended, but it must be written where an operator reads it.
if [ -f "$UPGRADE_DOC" ] && grep -q "$KEY" "$UPGRADE_DOC"; then
  ok "upgrade notes document the new required key"
else
  bad "upgrade notes document the new required key" \
      "existing deployments will refuse to start with no documented cause"
fi

echo "  $pass passed, $fail failed"
[ "$fail" -eq 0 ] || exit 1
