#!/usr/bin/env bash
#
# The PowerShell docker installer's COMPOSE_PROJECT_NAME prompt — issue #570.
#
# install-nomad-san-docker.ps1 is the fifth docker installer. It copies
# .env.example and then fills it in with New-EnvironmentFile and 18
# Update-EnvValue calls. The example ships this key BLANK, so a docker install
# from this script produces a box that cannot boot. Franco: "A docker install
# that can't boot means #570 isn't done."
#
# THIS SUITE DRIVES THE REAL FUNCTION. It does not grep for it. Franco asked for
# that explicitly: "don't settle for grep". A grep assertion would pass on a
# function that is defined and broken, which is the same shape as a guard that
# has never fired.
#
# WHAT WAS MEASURED ABOUT RUNNING THIS ON macOS, since it is reasonable to
# assume PowerShell is a problem here and it is not:
#
#   - pwsh 7.7.0 installs from Homebrew and runs. Platform reports Unix/macOS.
#   - install-nomad-san-docker.ps1 PARSES CLEAN under it. Every command the AST
#     reports as unresolvable is one of the script's OWN functions, resolved
#     when the file is loaded. There is no Windows-only cmdlet in it.
#   - So the whole contract is drivable here. No part falls back to grep.
#
# ONE REAL LANGUAGE DIFFERENCE, and it shapes the implementation rather than
# this test. `Read-Host` returns an empty string for an empty line AND for EOF,
# so it CANNOT express "Enter accepts the default, EOF does not". Measured both
# ways on pwsh 7.7.0. `[Console]::In.ReadLine()` can: it returns "" for an empty
# line and $null at EOF. Bash's `read` already distinguishes them by exit
# status. So the PowerShell prompt must read the line itself, not via Read-Host.
#
# The contract, matching the bash suite case for case:
#
#   Read-ComposeProjectName -EnvFile <path>
#     - asks `docker compose ls` what this stack currently runs under
#     - OFFERS the detected name as the prompt default
#     - returns the chosen name
#     - returns nothing when no name was chosen
#     - NEVER adopts a value the operator did not see and accept
#
# Deps: bash 3.x, pwsh 7+. Exit 0 = all pass, 1 = any failure.
set -u

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPTS="$TEST_DIR/.."
INSTALLER="$SCRIPTS/install-nomad-san-docker.ps1"
FN="Read-ComposeProjectName"

pass=0; fail=0
ok()  { echo "    ok   - $1"; pass=$((pass+1)); }
bad() { echo "    FAIL - $1"; [ -n "${2:-}" ] && echo "           $2"; fail=$((fail+1)); }

echo "compose_project_name_ps1"

# A missing tool must FAIL, not skip. A skipped suite is a silent pass, and this
# is the only thing standing between a PowerShell docker install and a dead box.
if ! command -v pwsh >/dev/null 2>&1; then
  echo "  FAIL - pwsh is required to drive $FN and was not found"
  echo "         install it with: brew install powershell   (CI runners ship it)"
  exit 1
fi

[ -f "$INSTALLER" ] || { echo "  installer not found at $INSTALLER"; exit 1; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# ---- fake docker, same shape as the bash suite ---------------------------
mkdir -p "$tmp/bin"
cat > "$tmp/bin/docker" <<'FAKE'
#!/usr/bin/env bash
if [ "${1:-}" = "compose" ] && [ "${2:-}" = "ls" ]; then
  if [ -n "${FAKE_COMPOSE_LS:-}" ] && [ -f "$FAKE_COMPOSE_LS" ]; then
    cat "$FAKE_COMPOSE_LS"
    exit 0
  fi
  echo "Cannot connect to the Docker daemon." >&2
  exit 1
fi
exit 0
FAKE
chmod +x "$tmp/bin/docker"

cat > "$tmp/one.txt" <<'OUT'
NAME                STATUS              CONFIG FILES
nomad_demo          running(3)          /opt/nomad/docker-compose.yaml
OUT

cat > "$tmp/two.txt" <<'OUT'
NAME                STATUS              CONFIG FILES
nomad_demo          running(3)          /opt/nomad/docker-compose.yaml
other_stack         running(2)          /srv/other/docker-compose.yaml
OUT

# ---- harness: extract the function by AST and invoke it ------------------
# Extracting rather than dot-sourcing, so the installer's top-level code never
# runs. Stubs stand in for its own output helpers.
cat > "$tmp/harness.ps1" <<'PWSH'
$ErrorActionPreference = 'Stop'
$installer = $env:NOMAD_TEST_INSTALLER
$fnName    = $env:NOMAD_TEST_FN
$envFile   = $env:NOMAD_TEST_ENVFILE

$errors = $null; $tokens = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile(
  (Resolve-Path $installer), [ref]$tokens, [ref]$errors)
if ($errors -and $errors.Count -gt 0) { Write-Output "PARSEFAIL|"; exit 0 }

$fn = $ast.FindAll({
  param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $fnName
}, $true) | Select-Object -First 1

if (-not $fn) { Write-Output "NOFN|"; exit 0 }

function Write-NomadHeader  { }
function Write-NomadStep    { }
function Write-NomadWarn    { }
function Write-NomadFail    { }
function Write-NomadSuccess { }
function Write-NomadInfo    { }

Invoke-Expression $fn.Extent.Text

$value = $null
try   { $value = & $fnName -EnvFile $envFile }
catch { Write-Output "THREW|$($_.Exception.Message)"; exit 0 }

if ($null -eq $value -or "$value" -eq "") { Write-Output "1|" }
else { Write-Output "0|$value" }
PWSH

# drive <compose-ls file or ""> <stdin>   ->  "<status>|<value>"
drive() {
  local lsfile="$1" input="$2"
  : > "$tmp/.env"
  printf '%s' "$input" | \
    FAKE_COMPOSE_LS="$lsfile" \
    NOMAD_TEST_INSTALLER="$INSTALLER" \
    NOMAD_TEST_FN="$FN" \
    NOMAD_TEST_ENVFILE="$tmp/.env" \
    PATH="$tmp/bin:$PATH" \
    pwsh -NoProfile -File "$tmp/harness.ps1" 2>/dev/null | tail -1
}

r="$(drive "$tmp/one.txt" $'\n')"
case "${r%%|*}" in
  NOFN)
    bad "$FN is defined in the installer" "the AST has no function by that name"
    bad "an empty reply accepts the offered name" "same"
    bad "an explicit reply overrides the offered name" "same"
    bad "declining returns nothing" "same"
    bad "an unreachable daemon still asks rather than guessing" "same"
    bad "two candidate projects are not auto-adopted" "same"
    echo "  $pass passed, $fail failed"
    exit 1
    ;;
  PARSEFAIL)
    bad "the installer parses" "pwsh reported parse errors, so nothing can be driven"
    echo "  $pass passed, $fail failed"
    exit 1
    ;;
esac
ok "$FN is defined and callable"

# ---- a) one running project: detected name offered, Enter takes it -------
if [ "${r#*|}" = "nomad_demo" ]; then
  ok "an empty reply accepts the offered name"
else
  bad "an empty reply accepts the offered name" "expected nomad_demo, got '${r#*|}' (status ${r%%|*})"
fi

# ---- b) detection comes from the daemon, not the folder name -------------
if grep -qE 'docker[[:space:]]+compose[[:space:]]+ls|compose.*\bls\b' "$INSTALLER"; then
  ok "detects the current name from docker compose ls"
else
  bad "detects the current name from docker compose ls" \
      "the folder name is a guess; the running project is a fact"
fi

# ---- c) explicit reply wins ----------------------------------------------
r="$(drive "$tmp/one.txt" $'my_own_name\n')"
if [ "${r#*|}" = "my_own_name" ]; then
  ok "an explicit reply overrides the offered name"
else
  bad "an explicit reply overrides the offered name" "expected my_own_name, got '${r#*|}'"
fi

# ---- d) EOF is not consent ----------------------------------------------
# Read-Host cannot tell this from an empty line; [Console]::In.ReadLine() can.
r="$(drive "$tmp/one.txt" '')"
if [ "${r%%|*}" != "0" ] && [ -z "${r#*|}" ]; then
  ok "declining returns nothing"
else
  bad "declining returns nothing" \
      "EOF must not be read as acceptance; got status ${r%%|*} value '${r#*|}'"
fi

# ---- e) unreachable daemon: ask, do not guess, do not throw -------------
r="$(drive "" $'typed_by_hand\n')"
if [ "${r%%|*}" = "THREW" ]; then
  bad "an unreachable daemon still asks rather than guessing" "the function threw: ${r#*|}"
elif [ "${r#*|}" = "typed_by_hand" ]; then
  ok "an unreachable daemon still asks rather than guessing"
else
  bad "an unreachable daemon still asks rather than guessing" "got '${r#*|}'"
fi

# ---- f) two candidates: no auto-adopt -----------------------------------
r="$(drive "$tmp/two.txt" '')"
if [ "${r%%|*}" != "0" ] && [ -z "${r#*|}" ]; then
  ok "two candidate projects are not auto-adopted"
else
  bad "two candidate projects are not auto-adopted" \
      "with several projects there is no safe default; got status ${r%%|*} value '${r#*|}'"
fi

echo "  $pass passed, $fail failed"
[ "$fail" -eq 0 ] || exit 1
