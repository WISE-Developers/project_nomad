#!/usr/bin/env bash
#
# Offline bundle: the launcher (refs #318).
#
# This is the only part of the bundle a practitioner ever interacts with
# directly. Everything else can be correct and the bundle is still useless if
# there is nothing to double-click.
#
# Four properties matter, and each of them fails silently if left to defaults.
#
# 1. It must run the BUNDLED Node, never `node` from PATH.
#
#    This is the one that undoes all the ABI work. A government laptop may well
#    have some other Node installed -- an old one, from some other tool. If the
#    launcher resolves `node` from PATH it may load a different major, and the
#    native addons we so carefully matched to ABI 127 will refuse to load. The
#    error names the addon, not the Node, so it reads as "the bundle is broken".
#
# 2. It must resolve paths against its OWN directory, not the working directory.
#
#    A practitioner double-clicks from Explorer, or runs it from C:\, or from a
#    USB root. The working directory is whatever Windows felt like. Every path
#    must be derived from where the launcher itself lives.
#
# 3. It must contain no absolute path from the build host.
#
#    Same reason the .env must not: one build, many laptops, different drive
#    letters. See offline_bundle_env.test.sh.
#
# 4. It must need no administrator.
#
#    #318 grades no-admin as "ideally ... where feasible", so it is soft -- but
#    every one of these is avoidable, and needing admin means needing IT, which
#    is the exact bottleneck this ticket routes around.
#
# Deps: bash 3.x compatible (macOS ships 3.2). Exit 0 = all pass.

set -u

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILDER="$TEST_DIR/../build-offline-bundle.sh"

pass=0
fail=0

ok()  { pass=$((pass + 1)); echo "    ok   $1"; }
bad() { fail=$((fail + 1)); echo "  FAIL   $1"; [ $# -gt 1 ] && echo "         $2"; }

[ -f "$BUILDER" ] || { echo "builder not found at $BUILDER"; exit 1; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

sed -n '/^write_launcher() {/,/^}/p' "$BUILDER" > "$tmp/fn.sh"

if [ ! -s "$tmp/fn.sh" ]; then
  bad "builder defines write_launcher()" \
      "there is nothing for the practitioner to run; the bundle cannot be handed to anyone"
  echo
  echo "offline_bundle_launcher: $pass passed, $fail failed"
  exit 1
fi
ok "builder defines write_launcher()"

cat > "$tmp/harness.sh" <<HARNESS
info() { :; }
die()  { echo "die: \$*" >&2; exit 1; }
source "$tmp/fn.sh"
HARNESS

# ---------------------------------------------------------------------------
# Generate both launchers and inspect what was actually written, rather than
# grepping the builder. What ships is the file, not the function.
# ---------------------------------------------------------------------------
mkdir -p "$tmp/win" "$tmp/nix"
bash -c "source '$tmp/harness.sh'; write_launcher '$tmp/win' 'Nomad.cmd' 'windows-x64' 'America/Edmonton'" 2>"$tmp/err.win"
bash -c "source '$tmp/harness.sh'; write_launcher '$tmp/nix' 'nomad.sh'  'linux-x64' 'America/Edmonton'"   2>"$tmp/err.nix"

WIN="$tmp/win/Nomad.cmd"
NIX="$tmp/nix/nomad.sh"

[ -s "$WIN" ] && ok "writes Nomad.cmd for windows-x64" \
              || bad "writes Nomad.cmd for windows-x64" "$(head -1 "$tmp/err.win" 2>/dev/null)"
[ -s "$NIX" ] && ok "writes nomad.sh for linux-x64" \
              || bad "writes nomad.sh for linux-x64" "$(head -1 "$tmp/err.nix" 2>/dev/null)"

[ -s "$WIN" ] || { echo; echo "offline_bundle_launcher: $pass passed, $fail failed"; exit 1; }

# ---------------------------------------------------------------------------
# 1. The bundled Node, not PATH.
# ---------------------------------------------------------------------------
if grep -qE 'runtime[\\/]node' "$WIN"; then
  ok "Nomad.cmd runs the bundled runtime/node"
else
  bad "Nomad.cmd runs the bundled runtime/node" \
      "a node resolved from PATH may be a different major, and the ABI-matched addons will not load"
fi

# A bare `node` invocation is the bug: it takes whatever PATH offers.
if grep -qE '^[[:space:]]*(start[[:space:]]+)?"?node"?[[:space:]]' "$WIN"; then
  bad "Nomad.cmd never invokes a bare 'node'" \
      "that resolves from PATH and defeats the bundled runtime"
else
  ok "Nomad.cmd never invokes a bare 'node'"
fi

# ---------------------------------------------------------------------------
# 2. Its own directory, not the working directory.
# ---------------------------------------------------------------------------
if grep -qE '%~dp0' "$WIN"; then
  ok "Nomad.cmd resolves paths from its own location (%~dp0)"
else
  bad "Nomad.cmd resolves paths from its own location (%~dp0)" \
      "double-clicking from Explorer gives an unrelated working directory"
fi

if grep -qE 'BASH_SOURCE|dirname' "$NIX"; then
  ok "nomad.sh resolves paths from its own location"
else
  bad "nomad.sh resolves paths from its own location"
fi

# ---------------------------------------------------------------------------
# 3. No build-host paths.
# ---------------------------------------------------------------------------
repo_root="$(cd "$TEST_DIR/../.." && pwd)"
leak=0
for f in "$WIN" "$NIX"; do
  [ -f "$f" ] || continue
  grep -qF "$repo_root" "$f" && leak=1
  grep -qE '/Users/|/home/[a-z]|C:\\Users\\' "$f" && leak=1
done
[ "$leak" -eq 0 ] && ok "no build-host paths in either launcher" \
                  || bad "no build-host paths in either launcher" \
                         "works on the machine that built it and nowhere else"

# ---------------------------------------------------------------------------
# 4. No administrator required.
# ---------------------------------------------------------------------------
admin="$(grep -niE 'reg add|setx |net session|runas|Start-Process .*-Verb RunAs|sc create' "$WIN" "$NIX" 2>/dev/null || true)"
if [ -z "$admin" ]; then
  ok "neither launcher needs administrator"
else
  bad "neither launcher needs administrator" \
      "needing admin means needing IT, which is the bottleneck this ticket routes around: $(echo "$admin" | head -1)"
fi

# ---------------------------------------------------------------------------
# It must actually start the backend and show the practitioner something.
# ---------------------------------------------------------------------------
# app/backend/dist, not app/backend: the backend resolves the frontend as
# ../../frontend/dist relative to its own __dirname, so the bundle has to
# mirror the repository layout. Flattening it served no UI at all, and only
# running the bundle revealed it.
if grep -qE 'app[\\/]backend[\\/]dist[\\/]index\.js' "$WIN"; then
  ok "Nomad.cmd starts app/backend/dist/index.js"
else
  bad "Nomad.cmd starts app/backend/dist/index.js" "nothing launches the server, or the layout does not mirror the repo"
fi

if grep -qiE 'start "" http|explorer |xdg-open|open http' "$WIN" "$NIX" 2>/dev/null; then
  ok "a launcher opens a browser for the practitioner"
else
  bad "a launcher opens a browser for the practitioner" \
      "a server with no window is indistinguishable from nothing happening"
fi

# The backend throws at startup without these. A launcher that omits them
# produces a bundle that cannot boot, which is what happened.
for var in NOMAD_HOME_TIMEZONE NOMAD_USAGE_LOG_PATH NOMAD_USAGE_LOG_MAX_BYTES; do
  if grep -q "$var" "$WIN" && grep -q "$var" "$NIX"; then
    ok "both launchers set $var"
  else
    bad "both launchers set $var" "EnvironmentService throws on startup without it"
  fi
done

if grep -q '@@TZ@@' "$WIN" "$NIX" 2>/dev/null; then
  bad "the timezone placeholder was substituted" "@@TZ@@ still present; the launcher would set a literal placeholder"
else
  ok "the timezone placeholder was substituted"
fi

echo
echo "offline_bundle_launcher: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
