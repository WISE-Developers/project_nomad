#!/usr/bin/env bash
#
# Offline bundle builder (refs #318).
#
# Runs on a machine WITH a network. Produces a bundle for machines WITHOUT one.
#
# The practitioner this exists for is standing in an incident command post on a
# government laptop: no network, Docker blocked, standard user account, no IT
# department within reach. Today every path we offer them fails, each at a
# different point -- the installers fetch the release over HTTP, the default
# execution mode reaches for a Docker daemon, the Windows installer downloads
# osgeo4w-setup.exe and needs admin. So this is not packaging convenience. It
# is the difference between Nomad existing at the fire and not existing at the
# fire.
#
# #318 says "crude is acceptable". Crude is fine. Unreproducible is not, and
# the two are easy to confuse. Acceptance criterion #4 asks for a
# "build -> copy to USB -> install on N laptops" workflow: ONE build serves
# MANY machines. If this script resolved "latest" at download time, two runs a
# week apart would produce different bundles, the laptops in the field would
# disagree with each other, and nobody could answer "what is actually on that
# thumb drive?" after the fact.
#
# Hence: every input is named by an exact version and verified by hash before
# it is allowed into a bundle, and the record written alongside it says which.
#
# Scope note: this first slice acquires and verifies the inputs and writes the
# record. Assembling the portable tree, the launcher, and the target-ABI native
# modules follow. Shipping GDAL/PROJ and proving a real fire completes offline
# are #381, deliberately split out.
#
# Compatible with bash 3.x (macOS ships 3.2). No associative arrays, no mapfile.

set -eu

# ---------------------------------------------------------------------------
# Pins. Every one of these is an exact version on purpose.
#
# A moving tag is not a pin. #376 was filed because .env.example named a
# FireSTARR tag that had stopped existing; the same mistake here ships a bundle
# that cannot be rebuilt. Bump these deliberately, never automatically.
# ---------------------------------------------------------------------------

# Node 22 LTS ("Jod"), matching the node:22 base the Dockerfiles already use.
readonly NODE_VERSION="v22.23.2"

# CWFMF/firestarr-cpp publishes a native Windows binary on every release. That
# was the load-bearing unknown for this whole ticket: the Linux container is
# A path, not THE path.
readonly FIRESTARR_VERSION="v0.9.20"

# The fuel dataset index carries its own per-year sha256, so the pin here is
# the index SCHEMA we know how to read. If upstream changes shape, fail loudly
# rather than silently misinterpreting a field.
readonly DATASET_VERSION="nomad-fuel-datasets/v1"
readonly DATASET_INDEX_URL="https://fgmfiles.spyd.com/datasets/nomad/index.json"

# Native addons, pinned to what the backend actually resolves today. These ship
# as prebuilt binaries rather than being compiled, so the builder needs no
# toolchain and runs anywhere -- including a Mac building for Windows.
readonly BETTER_SQLITE3_VERSION="12.9.0"
readonly GDAL_ASYNC_VERSION="3.12.3"

# GitHub publishes a sha256 digest for every release asset, so FireSTARR's
# authoritative hash comes from the release API rather than from a list we
# maintain by hand.
#
# This plan originally assumed no upstream checksums existed and specified a
# git-tracked checksum file. Running the builder disproved that: the API
# returns digest "sha256:..." and it matched the download byte for byte. A
# hand-maintained list would have been a step someone eventually forgets.
#
# The file is kept as an OPTIONAL extra pin for anything upstream does not
# publish a digest for. It is not required, and is not the primary authority.
readonly CHECKSUM_FILE_NAME="offline-bundle.sha256"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR
readonly CHECKSUM_FILE="$SCRIPT_DIR/$CHECKSUM_FILE_NAME"

# ---------------------------------------------------------------------------
# Defaults. Every one of these is overridable; none of them is a silent
# substitute for missing configuration.
# ---------------------------------------------------------------------------
PLATFORM="windows-x64"
OUT_DIR="$SCRIPT_DIR/../dist-offline"
DATASET_YEARS=""
INCLUDE_DATASET=1
HOME_TIMEZONE=""

die() {
  echo "ERROR: $*" >&2
  exit 1
}

info() { echo "==> $*"; }

usage() {
  cat <<USAGE
Build an offline Nomad bundle.

  --platform <id>    windows-x64 (default) | linux-x64 | macos-arm64
  --years <list>     comma-separated fuel vintages, e.g. 2025 or 2024,2025
  --no-data          omit the fuel dataset entirely
  --timezone <zone>  REQUIRED. IANA zone for the target, e.g. America/Edmonton
  --out <dir>        output directory (default: dist-offline/)

Pinned inputs:
  Node        $NODE_VERSION
  FireSTARR   $FIRESTARR_VERSION
  Dataset     $DATASET_VERSION index schema

Each fuel year is roughly 3 GB. All four is roughly 11 GB, not the ~50 GB some
of our older documentation still claims.
USAGE
}

# ---------------------------------------------------------------------------
# sha256, portably. macOS has shasum; most Linux images have sha256sum.
# ---------------------------------------------------------------------------
sha256_of() {
  local file="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$file" | awk '{print $1}'
  else
    die "no sha256 tool found (looked for sha256sum and shasum)"
  fi
}

# Verify a file against an expected hash, or refuse to continue.
#
# There is no second chance to notice a truncated download once the bundle is
# on a thumb drive at an incident, so a mismatch is fatal here and never a
# warning.
verify_sha256() {
  local file="$1" expected="$2" label="$3"
  [ -n "$expected" ] || die "no expected sha256 for $label -- refusing to bundle an unverified input"
  local actual
  actual="$(sha256_of "$file")"
  if [ "$actual" != "$expected" ]; then
    die "sha256 mismatch for $label
       expected $expected
       actual   $actual"
  fi
  info "verified $label"
}

# Look up a recorded hash for an input we pin ourselves.
expected_sha256_for() {
  local key="$1"
  [ -f "$CHECKSUM_FILE" ] || return 0
  awk -v k="$key" '$2 == k { print $1; exit }' "$CHECKSUM_FILE"
}

# ---------------------------------------------------------------------------
# Download something large, surviving a dropped connection.
#
# A plain `curl -fsSL` failed part-way through a 2.8 GB fuel dataset and took
# the whole build with it -- and a build of all four vintages moves about
# 11 GB, so this is the common case rather than bad luck. The transfer resumes
# rather than restarting, retries a bounded number of times, and treats a
# stalled connection as a failure instead of hanging until someone notices.
#
# Resuming is only safe because every download is checksum-verified afterwards:
# a resume that stitches together the wrong bytes fails the hash, which is the
# outcome we want rather than a silent corruption on a field laptop.
fetch_large() {
  local url="$1" dest="$2" label="$3"
  local attempt=1
  while [ "$attempt" -le 4 ]; do
    if curl -fL --retry 3 --retry-delay 5 --retry-connrefused \
            --speed-limit 1024 --speed-time 60 \
            -C - -o "$dest" "$url" 2>/dev/null; then
      return 0
    fi
    info "download of $label interrupted (attempt $attempt) -- resuming"
    attempt=$((attempt + 1))
    sleep 5
  done
  die "could not download $label after 4 attempts from
       $url

       The partial file was kept at $dest, so a further run resumes rather
       than starting again. Delete it if you would rather start clean."
}

# ---------------------------------------------------------------------------
# Node major -> V8 module ABI.
#
# A prebuilt native addon is valid for exactly one ABI. Carrying the ABI as a
# constant beside NODE_VERSION would mean two numbers that must move together
# and look nothing alike -- and there is a live suggestion to move Nomad to
# Node 24, which is ABI 137, not 127. Someone making that entirely reasonable
# change would leave a stale constant behind, every prebuild would be wrong,
# and nothing would fail until a practitioner's laptop could not load its own
# database driver. So it is derived.
#
# Values verified against nodejs.org/dist/index.json, not recalled.
node_abi_for() {
  local version="$1"
  local major="${version#v}"
  major="${major%%.*}"

  case "$major" in
    18) echo 108 ;;
    19) echo 111 ;;
    20) echo 115 ;;
    21) echo 120 ;;
    22) echo 127 ;;
    23) echo 131 ;;
    24) echo 137 ;;
    25) echo 141 ;;
    26) echo 147 ;;
    *)  die "unknown Node major '$major' (from $version) -- no ABI mapping.

       Add it from nodejs.org/dist/index.json rather than guessing. A guessed
       ABI downloads real, correctly-checksummed addons that the bundled Node
       cannot load, and that failure surfaces on a field laptop rather than
       here." ;;
  esac
}

# ---------------------------------------------------------------------------
# The record written beside the bundle.
#
# A hash checked at build time and then discarded answers "was this download
# intact?" but not "what is on that USB stick?" -- and the second question is
# the one that gets asked in the field, months later, about a laptop nobody
# has in front of them. So versions AND hashes are written down.
# ---------------------------------------------------------------------------
write_manifest() {
  local dest="$1" node_sha="$2" firestarr_sha="$3" dataset_lines="$4"
  cat > "$dest" <<MANIFEST
{
  "schema": "nomad-offline-bundle/v1",
  "builtAt": "$(date -u '+%Y-%m-%dT%H:%M:%SZ')",
  "platform": "$PLATFORM",
  "nomadVersion": "$NOMAD_APP_VERSION",
  "inputs": {
    "node":      { "version": "$NODE_VERSION",      "sha256": "$node_sha" },
    "firestarr": { "version": "$FIRESTARR_VERSION", "sha256": "$firestarr_sha" },
    "datasetIndexSchema": "$DATASET_VERSION"
  },
  "dataset": [$dataset_lines]
}
MANIFEST
  info "wrote record: $dest"
}

# ---------------------------------------------------------------------------
# The .env that ships inside the bundle.
#
# Every path here is RELATIVE to the bundle root, and that is the whole point.
# Acceptance criterion #4 is "build -> copy to USB -> install on N laptops":
# one build, many machines, a different drive letter or mount point on each.
# An absolute path baked in by the build host works perfectly on the build host
# and nowhere else -- it passes every check we can run here and fails only in
# the field, which is the worst failure shape available to us.
#
# FIRESTARR_EXECUTION_MODE is the other thing that must be right. getExecutor.ts
# returns 'docker' whenever the value is absent or anything but 'binary', and
# Docker is the one thing guaranteed absent on a locked-down field laptop. Get
# this wrong and the first run at an incident reaches for a daemon that is not
# there, with no network to look up why.
#
# PROJ_DATA points at engine/ rather than engine/proj/ because that is where
# proj.db actually lands: the FireSTARR release archive carries it at its root,
# verified by listing the real v0.9.20 Windows asset.
write_env() {
  local dest="$1"
  local binary_rel="$2"
  local timezone="$3"
  local app_version="$4"

  cat > "$dest" <<ENVFILE
# Nomad offline bundle (refs #318). Generated -- edit the builder, not this.
#
# All paths are relative to the bundle root, so this file is identical on
# every laptop the bundle is copied to. Do not make any of them absolute.

# Docker is not present on the target. Without this, getExecutor.ts falls
# back to docker and the first run fails reaching for a daemon that is not
# there.
FIRESTARR_EXECUTION_MODE=binary
FIRESTARR_BINARY_PATH=$binary_rel

# proj.db ships at the root of the FireSTARR release archive, so PROJ_DATA is
# the directory we extracted that archive into.
PROJ_DATA=engine

# Fuel data. May be absent when the bundle was built with --no-data; the app
# should say so plainly rather than behaving as though a dataset is present.
FIRESTARR_DATASET_PATH=data

# SQLite and run output. Kept inside the bundle so the whole thing stays
# portable and deleting the folder is the uninstall.
NOMAD_DATA_PATH=db

# No network means no OAuth provider to redirect to, so sign-in would
# dead-end. Telemetry is left unconfigured for the same reason.
NOMAD_AUTH_MODE=none

# Required, and chosen at build time rather than guessed. The zone belongs to
# where this bundle is USED. Must be an IANA name: a fixed offset cannot
# observe DST.
NOMAD_HOME_TIMEZONE=$timezone

# Required, both of them, with no defaults. The usage log records who used
# Nomad and when, so it is a personnel record -- kept inside the bundle so it
# travels with it and is not written somewhere that gets wiped.
NOMAD_USAGE_LOG_PATH=db/usage/usage.jsonl
NOMAD_USAGE_LOG_MAX_BYTES=52428800

# Above 1024 so no elevation is needed to bind it.
PORT=4900
ENVFILE

  info "wrote bundle .env: $dest"
}

# ---------------------------------------------------------------------------
# Nomad itself: the built app and its production dependencies.
#
# Four things here go quietly wrong if left to defaults.
#
# Install scripts are suppressed. A normal install makes better-sqlite3 and
# gdal-async build or fetch binaries for THIS machine, silently replacing the
# verified target prebuilds fetched earlier -- and the build still succeeds.
#
# devDependencies are omitted. Not only for size: vitest currently carries a
# CRITICAL advisory and has no business on a field laptop.
#
# The frontend is built with `npm run build`, never `build:lib`. Both write to
# frontend/dist, and build:lib replaces the application with the embeddable
# component library. The launcher would then serve nothing.
#
# The install runs against a STAGED copy of the workspace manifests, not the
# repository. That keeps the committed lockfile as the source of truth -- so
# the bundle is reproducible -- without destroying the developer's own
# node_modules as a side effect of building a bundle.
assemble_app() {
  local bundle="$1" abi="$2" plat="$3" arch="$4"
  local repo="$SCRIPT_DIR/.."
  local stage="$WORK/npm-stage"

  info "building backend and frontend"
  ( cd "$repo" && npm run build --workspace @nomad/backend ) >/dev/null \
    || die "backend build failed -- the bundle would ship source, not an application"
  ( cd "$repo" && npm run build --workspace @nomad/frontend ) >/dev/null \
    || die "frontend build failed"

  [ -f "$repo/frontend/dist/index.html" ] \
    || die "frontend/dist has no index.html after the build.
       If the embeddable library build ran instead of the application build,
       dist now holds a component library and the bundle would serve nothing."

  info "installing production dependencies (no scripts, no devDependencies)"
  rm -rf "$stage"
  mkdir -p "$stage/backend" "$stage/frontend"
  cp "$repo/package.json" "$repo/package-lock.json" "$stage/"
  cp "$repo/backend/package.json" "$stage/backend/"
  cp "$repo/frontend/package.json" "$stage/frontend/"
  ( cd "$stage" && npm ci --omit=dev --omit=peer --ignore-scripts ) >/dev/null \
    || die "npm ci failed in the staging copy"

  rm -rf "$bundle/app"
  mkdir -p "$bundle/app"
  cp -R "$stage/node_modules" "$bundle/app/node_modules"
  # The backend resolves the frontend as ../../frontend/dist from its own
  # __dirname, so the bundle mirrors the repository layout exactly. Flattening
  # it (app/backend + app/frontend) makes the backend look outside app/ and it
  # silently serves no UI -- found by running the bundle, not by any test.
  mkdir -p "$bundle/app/backend" "$bundle/app/frontend"
  cp -R "$repo/backend/dist" "$bundle/app/backend/dist"
  cp -R "$repo/frontend/dist" "$bundle/app/frontend/dist"
  cp "$repo/backend/package.json" "$bundle/app/package.json"

  # Drop the verified target prebuilds into the paths each package resolves.
  # A correct binary in the wrong directory fails identically to a missing one.
  local bs_dir="$bundle/app/node_modules/better-sqlite3/build/Release"
  mkdir -p "$bs_dir"
  tar xzf "$WORK/natives/better-sqlite3-v${BETTER_SQLITE3_VERSION}-node-v${abi}-${plat}-${arch}.tar.gz" \
      -C "$WORK/natives" || die "could not unpack the better-sqlite3 prebuild"
  cp "$WORK/natives/build/Release/better_sqlite3.node" "$bs_dir/" \
    || die "better-sqlite3 prebuild did not contain build/Release/better_sqlite3.node"

  # node-pre-gyp resolves {node_abi}-{platform}-{arch}; composed, never literal.
  local gd_dir="$bundle/app/node_modules/gdal-async/lib/binding/node-v${abi}-${plat}-${arch}"
  mkdir -p "$gd_dir"
  tar xzf "$WORK/natives/gdal-async-node-v${abi}-${plat}-${arch}.tar.gz" \
      -C "$WORK/natives" || die "could not unpack the gdal-async prebuild"
  cp "$WORK/natives/node-v${abi}-${plat}-${arch}/gdal.node" "$gd_dir/" \
    || die "gdal-async prebuild did not contain gdal.node"

  # --omit=dev is not enough, and trusting it was a mistake worth recording.
  #
  # better-auth lists vitest as an OPTIONAL PEER dependency. npm resolves peers
  # automatically, so vitest installed into the production tree even though it
  # is nobody's runtime dependency -- and vitest currently carries a CRITICAL
  # advisory. The flag was present and correct; the outcome was still wrong.
  #
  # So the outcome is checked rather than the flag. A test-only package on a
  # field laptop is both dead weight and the first thing a scanner reports.
  # Removed deliberately, and safe to remove: better-auth lists vitest in
  # peerDependenciesMeta, which marks the peer OPTIONAL. It runs without it.
  # npm ci installs from the lockfile, where the peer is already recorded, so
  # neither --omit=dev nor --omit=peer excludes it -- both flags are applied
  # and correct, and the package arrives anyway.
  for unwanted in vitest @vitest eslint; do
    rm -rf "$bundle/app/node_modules/$unwanted"
  done

  local leaked=""
  for unwanted in vitest @vitest eslint; do
    [ -e "$bundle/app/node_modules/$unwanted" ] && leaked="$leaked $unwanted"
  done
  [ -z "$leaked" ] || die "test/lint packages reached the bundle:$leaked

       These are not runtime dependencies of anything Nomad needs. vitest in
       particular carries a CRITICAL advisory and arrives as an optional PEER
       dependency of better-auth, which --omit=dev does not exclude."

  # Copying is not proof. Check, fatally -- otherwise a missing addon surfaces
  # on the practitioner's laptop instead of here.
  [ -f "$bs_dir/better_sqlite3.node" ] \
    || die "better_sqlite3.node is not in place at $bs_dir"
  [ -f "$gd_dir/gdal.node" ] \
    || die "gdal.node is not in place at $gd_dir"

  info "app payload assembled (ABI $abi, $plat-$arch)"
}

# ---------------------------------------------------------------------------
# The launcher: the only part of the bundle a practitioner touches.
#
# It resolves every path against its OWN location. Someone double-clicks this
# from Explorer, or runs it from a USB root, and the working directory is
# whatever Windows felt like -- so nothing may be relative to the CWD.
#
# It runs the BUNDLED Node explicitly. This is the step that would otherwise
# undo all the ABI work: a government laptop may already have some other Node
# on PATH, and loading addons matched to ABI 127 under a different major fails
# with an error naming the addon rather than the Node. It reads as "the bundle
# is broken".
#
# It needs no administrator: no registry writes, no setx, no service, and a
# port above 1024.
write_launcher() {
  local bundle="$1" name="$2" platform="$3" timezone="$4" app_version="${5:-0.0.0}"

  if [ "$platform" = "windows-x64" ]; then
    cat > "$bundle/$name" <<'LAUNCHER'
@echo off
rem Nomad offline bundle launcher (refs #318).
rem
rem Every path is derived from this file's own location, so the bundle works
rem from any drive letter or folder. Nothing here needs administrator.
setlocal

set "NOMAD_HOME=%~dp0"
if "%NOMAD_HOME:~-1%"=="\" set "NOMAD_HOME=%NOMAD_HOME:~0,-1%"

rem The .env in this folder carries these as relative paths, for the record of
rem what the bundle is. They are made absolute here because the server is
rem started from an unpredictable working directory.
set "NODE_ENV=production"
set "FIRESTARR_EXECUTION_MODE=binary"
set "FIRESTARR_BINARY_PATH=%NOMAD_HOME%\engine\firestarr.exe"
set "PROJ_DATA=%NOMAD_HOME%\engine"
set "PROJ_LIB=%NOMAD_HOME%\engine"
set "FIRESTARR_DATASET_PATH=%NOMAD_HOME%\data"
set "NOMAD_DATA_PATH=%NOMAD_HOME%\db"
set "NOMAD_AUTH_MODE=none"
set "PORT=4900"
set "NOMAD_HOME_TIMEZONE=@@TZ@@"
set "NOMAD_USAGE_LOG_PATH=%NOMAD_HOME%\db\usage\usage.jsonl"
set "NOMAD_USAGE_LOG_MAX_BYTES=52428800"
set "NOMAD_VERSION=@@VER@@"

if not exist "%NOMAD_HOME%\runtime\node.exe" (
  echo.
  echo This bundle is missing its Node runtime ^(runtime\node.exe^).
  echo The copy is incomplete -- copy the whole Nomad folder again.
  echo.
  pause
  exit /b 1
)

if not exist "%NOMAD_HOME%\engine\proj.db" (
  echo.
  echo This bundle is missing engine\proj.db.
  echo FireSTARR would fail with an unreadable status code instead of a
  echo message, so it is being stopped here where the reason is visible.
  echo.
  pause
  exit /b 1
)

rem Open a browser shortly after, so the page is not requested before the
rem server is listening. The server itself stays in this window: closing the
rem window stops Nomad, which is the whole uninstall story.
start "" cmd /c "timeout /t 4 /nobreak >nul & start "" http://localhost:4900"

echo Starting Nomad. Close this window to stop it.
echo Opening http://localhost:4900
echo.
"%NOMAD_HOME%\runtime\node.exe" "%NOMAD_HOME%\app\backend\dist\index.js"

if errorlevel 1 (
  echo.
  echo Nomad stopped unexpectedly. The message above says why.
  pause
)
endlocal
LAUNCHER
  else
    cat > "$bundle/$name" <<'LAUNCHER'
#!/usr/bin/env bash
# Nomad offline bundle launcher (refs #318).
#
# Every path is derived from this file's own location, so the bundle runs from
# anywhere it was copied to. Nothing here needs root.
set -eu

NOMAD_HOME="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

export NODE_ENV=production
export FIRESTARR_EXECUTION_MODE=binary
export FIRESTARR_BINARY_PATH="$NOMAD_HOME/engine/firestarr"
export PROJ_DATA="$NOMAD_HOME/engine"
export PROJ_LIB="$NOMAD_HOME/engine"
export FIRESTARR_DATASET_PATH="$NOMAD_HOME/data"
export NOMAD_DATA_PATH="$NOMAD_HOME/db"
export NOMAD_AUTH_MODE=none
export PORT=4900
export NOMAD_HOME_TIMEZONE="@@TZ@@"
export NOMAD_USAGE_LOG_PATH="$NOMAD_HOME/db/usage/usage.jsonl"
export NOMAD_USAGE_LOG_MAX_BYTES=52428800
export NOMAD_VERSION="@@VER@@"

NODE_BIN="$NOMAD_HOME/runtime/bin/node"

if [ ! -x "$NODE_BIN" ]; then
  echo "This bundle is missing its Node runtime (runtime/bin/node)."
  echo "The copy is incomplete -- copy the whole Nomad folder again."
  exit 1
fi

if [ ! -f "$NOMAD_HOME/engine/proj.db" ]; then
  echo "This bundle is missing engine/proj.db."
  echo "FireSTARR would fail with an unreadable status instead of a message,"
  echo "so it is being stopped here where the reason is visible."
  exit 1
fi

( sleep 4
  if command -v xdg-open >/dev/null 2>&1; then xdg-open http://localhost:4900
  elif command -v open >/dev/null 2>&1; then open http://localhost:4900
  fi ) >/dev/null 2>&1 &

echo "Starting Nomad. Press Ctrl+C to stop it."
echo "Opening http://localhost:4900"
exec "$NODE_BIN" "$NOMAD_HOME/app/backend/dist/index.js"
LAUNCHER
    chmod +x "$bundle/$name"
  fi

  # The launcher bodies are quoted heredocs so that %VAR% and $VAR survive
  # verbatim; the one build-time value is substituted afterwards.
  sed -i.bak -e "s|@@TZ@@|$timezone|g" -e "s|@@VER@@|$app_version|g" "$bundle/$name" && rm -f "$bundle/$name.bak"

  mkdir -p "$bundle/db/usage"

  info "wrote launcher: $name (timezone $timezone)"
}

# ---------------------------------------------------------------------------
# Ask GitHub what an asset is supposed to be, rather than trusting what arrives.
# ---------------------------------------------------------------------------
github_asset_digest() {
  local repo="$1" tag="$2" asset="$3"
  command -v gh >/dev/null 2>&1 || die "gh is required to read published digests"
  gh api "repos/${repo}/releases/tags/${tag}" \
    --jq ".assets[] | select(.name==\"${asset}\") | .digest" 2>/dev/null | sed 's/^sha256://'
}

# ---------------------------------------------------------------------------
# Prebuilt native addons for the TARGET, not for this machine.
#
# better-sqlite3 and gdal-async are compiled addons. Installing them normally
# would build or download binaries for whatever machine runs the builder --
# which for Nomad is usually a Mac, producing a bundle that cannot start on
# the Windows laptop it was built for.
#
# Both projects publish prebuilds per ABI/platform/arch with digests, so we
# select the target's explicitly and verify them like every other input. That
# also means the builder needs no compiler toolchain at all.
#
# Staged rather than installed: they are dropped into app/node_modules once the
# JS payload exists, so that a normal `npm ci --ignore-scripts` can provide the
# JavaScript without ever building a native for the wrong platform.
fetch_natives() {
  local dest="$1" abi="$2" plat="$3" arch="$4"
  mkdir -p "$dest"

  local bs_asset="better-sqlite3-v${BETTER_SQLITE3_VERSION}-node-v${abi}-${plat}-${arch}.tar.gz"
  local bs_tag="v${BETTER_SQLITE3_VERSION}"
  local bs_sha
  bs_sha="$(github_asset_digest "WiseLibs/better-sqlite3" "$bs_tag" "$bs_asset")"
  [ -n "$bs_sha" ] || die "no prebuild published: $bs_asset

       better-sqlite3 ${BETTER_SQLITE3_VERSION} has no binary for Node ABI ${abi}
       on ${plat}-${arch}. Building it here would produce an addon for THIS
       machine, which is the failure this bundle exists to avoid."

  info "fetching $bs_asset"
  curl -fsSL -o "$dest/$bs_asset" \
    "https://github.com/WiseLibs/better-sqlite3/releases/download/${bs_tag}/${bs_asset}" \
    || die "could not download $bs_asset"
  verify_sha256 "$dest/$bs_asset" "$bs_sha" "better-sqlite3 ${BETTER_SQLITE3_VERSION} (ABI ${abi}, ${plat}-${arch})"

  local gd_asset="node-v${abi}-${plat}-${arch}.tar.gz"
  local gd_tag="v${GDAL_ASYNC_VERSION}"
  local gd_sha
  gd_sha="$(github_asset_digest "mmomtchev/node-gdal-async" "$gd_tag" "$gd_asset")"
  [ -n "$gd_sha" ] || die "no prebuild published: $gd_asset

       gdal-async ${GDAL_ASYNC_VERSION} has no binary for Node ABI ${abi} on
       ${plat}-${arch}. gdal-async bundles its own GDAL, so there is no host
       GDAL to fall back on -- this is fatal, not degradable."

  info "fetching gdal-async $gd_asset"
  curl -fsSL -o "$dest/gdal-async-$gd_asset" \
    "https://github.com/mmomtchev/node-gdal-async/releases/download/${gd_tag}/${gd_asset}" \
    || die "could not download gdal-async $gd_asset"
  verify_sha256 "$dest/gdal-async-$gd_asset" "$gd_sha" "gdal-async ${GDAL_ASYNC_VERSION} (ABI ${abi}, ${plat}-${arch})"
}

# ---------------------------------------------------------------------------
# Argument parsing. Unknown flags are fatal: a typo that silently builds the
# wrong bundle is worse than one that stops.
# ---------------------------------------------------------------------------
while [ $# -gt 0 ]; do
  case "$1" in
    --platform) PLATFORM="${2:-}"; [ -n "$PLATFORM" ] || die "--platform needs a value"; shift 2 ;;
    --years)    DATASET_YEARS="${2:-}"; [ -n "$DATASET_YEARS" ] || die "--years needs a value"; shift 2 ;;
    --no-data)  INCLUDE_DATASET=0; shift ;;
    --timezone) HOME_TIMEZONE="${2:-}"; [ -n "$HOME_TIMEZONE" ] || die "--timezone needs a value"; shift 2 ;;
    --out)      OUT_DIR="${2:-}"; [ -n "$OUT_DIR" ] || die "--out needs a value"; shift 2 ;;
    -h|--help)  usage; exit 0 ;;
    *)          die "unknown option: $1 (see --help)" ;;
  esac
done

case "$PLATFORM" in
  windows-x64) NODE_ARCHIVE="node-${NODE_VERSION}-win-x64.zip"
               FIRESTARR_ASSET="firestarr-windows-x64-cl-Release.zip"
               NATIVE_PLATFORM="win32"; NATIVE_ARCH="x64"
               LAUNCHER_NAME="Nomad.cmd" ;;
  linux-x64)   NODE_ARCHIVE="node-${NODE_VERSION}-linux-x64.tar.xz"
               FIRESTARR_ASSET="firestarr-ubuntu-x64-gcc-Release.tar.gz"
               NATIVE_PLATFORM="linux"; NATIVE_ARCH="x64"
               LAUNCHER_NAME="nomad.sh" ;;
  macos-arm64) NODE_ARCHIVE="node-${NODE_VERSION}-darwin-arm64.tar.gz"
               FIRESTARR_ASSET="firestarr-macos-arm64-clang-Release.tar.gz"
               NATIVE_PLATFORM="darwin"; NATIVE_ARCH="arm64"
               LAUNCHER_NAME="nomad.sh" ;;
  *)           die "unsupported --platform '$PLATFORM' (windows-x64 | linux-x64 | macos-arm64)" ;;
esac

# Derived, never carried as a constant. See node_abi_for().
NODE_ABI="$(node_abi_for "$NODE_VERSION")"

# The backend refuses to start without a version rather than reporting a
# placeholder, and the container normally bakes this in at image build time
# from frontend/package.json. A bundle is built the same way, from the same
# source -- and it answers "which Nomad is on that USB stick?", which is the
# question this whole ticket exists to make answerable.
NOMAD_APP_VERSION="$(node -p "require('$SCRIPT_DIR/../frontend/package.json').version" 2>/dev/null || true)"
[ -n "$NOMAD_APP_VERSION" ] || die "could not read the app version from frontend/package.json"

[ "$INCLUDE_DATASET" -eq 0 ] || [ -n "$DATASET_YEARS" ] || \
  die "specify --years (e.g. --years 2025) or pass --no-data.
       There is no default fuel vintage: guessing which year's fuels a
       practitioner needs is exactly the kind of silent assumption that
       produces a confidently wrong fire."

[ -n "$HOME_TIMEZONE" ] || die "--timezone is required (e.g. --timezone America/Edmonton).

       The backend refuses to start without NOMAD_HOME_TIMEZONE and has no
       default, deliberately. There is no safe guess to make here either: the
       zone belongs to where the bundle will be USED, which the machine
       building it cannot know. See #368 for the same mistake made once
       already, where an operator's browser zone was written into a model.
       It must be an IANA zone NAME -- a fixed offset like -06:00 cannot
       observe DST."

case "$HOME_TIMEZONE" in
  [+-][0-9]*|UTC[+-]*|*:*) die "--timezone '$HOME_TIMEZONE' looks like a fixed offset.
       It must be an IANA zone name such as America/Edmonton: a fixed offset
       cannot observe DST and would freeze the deployment on one offset." ;;
esac

mkdir -p "$OUT_DIR"
WORK="$OUT_DIR/inputs"
mkdir -p "$WORK"

info "platform   $PLATFORM ($NATIVE_PLATFORM-$NATIVE_ARCH)"
info "node       $NODE_VERSION (ABI $NODE_ABI)"
info "firestarr  $FIRESTARR_VERSION"

# ---------------------------------------------------------------------------
# Node runtime. Upstream publishes SHASUMS256.txt beside every release, so the
# authoritative hash comes from them rather than from us.
# ---------------------------------------------------------------------------
NODE_BASE="https://nodejs.org/dist/${NODE_VERSION}"
info "fetching $NODE_ARCHIVE"
curl -fsSL -o "$WORK/$NODE_ARCHIVE" "$NODE_BASE/$NODE_ARCHIVE" \
  || die "could not download $NODE_ARCHIVE from $NODE_BASE"
curl -fsSL -o "$WORK/SHASUMS256.txt" "$NODE_BASE/SHASUMS256.txt" \
  || die "could not download SHASUMS256.txt from $NODE_BASE"

NODE_EXPECTED="$(awk -v f="$NODE_ARCHIVE" '$2 == f { print $1; exit }' "$WORK/SHASUMS256.txt")"
verify_sha256 "$WORK/$NODE_ARCHIVE" "$NODE_EXPECTED" "node $NODE_VERSION ($PLATFORM)"
NODE_SHA="$NODE_EXPECTED"

# ---------------------------------------------------------------------------
# FireSTARR binary. The release API publishes the digest, so ask it what the
# asset should be rather than trusting whatever arrives down the wire.
# ---------------------------------------------------------------------------
FIRESTARR_KEY="firestarr/${FIRESTARR_VERSION}/${FIRESTARR_ASSET}"
FIRESTARR_EXPECTED="$(expected_sha256_for "$FIRESTARR_KEY")"

if [ -z "$FIRESTARR_EXPECTED" ]; then
  command -v gh >/dev/null 2>&1 \
    || die "gh is required to read the published digest for $FIRESTARR_ASSET,
       or record the hash yourself in $CHECKSUM_FILE_NAME as:
         <sha256>  $FIRESTARR_KEY"
  FIRESTARR_EXPECTED="$(gh api "repos/CWFMF/firestarr-cpp/releases/tags/${FIRESTARR_VERSION}" \
    --jq ".assets[] | select(.name==\"${FIRESTARR_ASSET}\") | .digest" 2>/dev/null | sed 's/^sha256://')"
fi

[ -n "$FIRESTARR_EXPECTED" ] || die "no published digest for $FIRESTARR_ASSET at $FIRESTARR_VERSION,
       and none recorded in $CHECKSUM_FILE_NAME.

       Refusing to bundle an input nobody has vouched for: a swapped or
       truncated upstream asset would otherwise reach a field laptop unnoticed,
       where there is no network to re-download it and no way to tell."

FIRESTARR_URL="https://github.com/CWFMF/firestarr-cpp/releases/download/${FIRESTARR_VERSION}/${FIRESTARR_ASSET}"
info "fetching $FIRESTARR_ASSET"
curl -fsSL -o "$WORK/$FIRESTARR_ASSET" "$FIRESTARR_URL" \
  || die "could not download $FIRESTARR_ASSET from $FIRESTARR_URL"

verify_sha256 "$WORK/$FIRESTARR_ASSET" "$FIRESTARR_EXPECTED" "firestarr $FIRESTARR_VERSION ($PLATFORM)"
FIRESTARR_SHA="$FIRESTARR_EXPECTED"

# ---------------------------------------------------------------------------
# Fuel dataset, optional and size-controlled per acceptance criterion #3.
# The index publishes a sha256 per vintage, so that is the authority.
# ---------------------------------------------------------------------------
DATASET_ENTRIES=""
if [ "$INCLUDE_DATASET" -eq 1 ]; then
  info "fetching dataset index"
  curl -fsSL -o "$WORK/dataset-index.json" "$DATASET_INDEX_URL" \
    || die "could not download the dataset index from $DATASET_INDEX_URL"

  node -e '
    const fs = require("fs");
    const idx = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    if (idx.schema !== process.argv[2]) {
      console.error(`dataset index schema is "${idx.schema}", this builder pins "${process.argv[2]}"`);
      process.exit(1);
    }
  ' "$WORK/dataset-index.json" "$DATASET_VERSION" \
    || die "dataset index schema does not match the pinned $DATASET_VERSION -- refusing to guess at its shape"

  OLD_IFS="$IFS"; IFS=","
  for year in $DATASET_YEARS; do
    IFS="$OLD_IFS"
    entry="$(node -e '
      const fs = require("fs");
      const idx = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      const d = idx.datasets.find(x => String(x.vintage) === process.argv[2]);
      if (!d) { process.exit(2); }
      console.log([d.file, d.sha256, d.bytes, idx.baseUrl].join("\t"));
    ' "$WORK/dataset-index.json" "$year")" \
      || die "fuel vintage $year is not in the dataset index"

    file="$(echo "$entry" | cut -f1)"
    sha="$(echo "$entry" | cut -f2)"
    bytes="$(echo "$entry" | cut -f3)"
    base="$(echo "$entry" | cut -f4)"

    info "fetching $file ($((bytes / 1000000)) MB)"
    fetch_large "${base}${file}" "$WORK/$file" "$file"
    verify_sha256 "$WORK/$file" "$sha" "fuel dataset $year"

    [ -z "$DATASET_ENTRIES" ] || DATASET_ENTRIES="$DATASET_ENTRIES,"
    DATASET_ENTRIES="$DATASET_ENTRIES
    { \"vintage\": $year, \"file\": \"$file\", \"sha256\": \"$sha\", \"bytes\": $bytes }"
    IFS=","
  done
  IFS="$OLD_IFS"
else
  info "dataset omitted (--no-data)"
fi

# ---------------------------------------------------------------------------
# Assemble the portable tree.
#
# Nothing here installs. The practitioner copies a folder and runs a script
# inside it: no registry writes, no services, no PATH edits, no ports below
# 1024, no WSL2. Deleting the folder is the uninstall.
# ---------------------------------------------------------------------------
BUNDLE="$OUT_DIR/Nomad"
rm -rf "$BUNDLE"
mkdir -p "$BUNDLE/runtime" "$BUNDLE/engine" "$BUNDLE/app" "$BUNDLE/data" "$BUNDLE/db"

extract_into() {
  local archive="$1" dest="$2" strip_top="$3"
  case "$archive" in
    *.zip)
      command -v unzip >/dev/null 2>&1 || die "unzip is required to extract $(basename "$archive")"
      unzip -q -o "$archive" -d "$dest" || die "could not extract $(basename "$archive")" ;;
    *.tar.gz|*.tgz|*.tar.xz)
      tar -xf "$archive" -C "$dest" || die "could not extract $(basename "$archive")" ;;
    *) die "do not know how to extract $(basename "$archive")" ;;
  esac

  # Node's archives wrap everything in a versioned top-level directory. Flatten
  # it so the launcher's path does not carry the version number -- otherwise
  # bumping NODE_VERSION silently breaks every relative path that points here.
  if [ "$strip_top" = "strip" ]; then
    local inner
    inner="$(find "$dest" -mindepth 1 -maxdepth 1 -type d | head -1)"
    if [ -n "$inner" ] && [ "$(find "$dest" -mindepth 1 -maxdepth 1 | wc -l | tr -d ' ')" = "1" ]; then
      (cd "$inner" && tar cf - .) | (cd "$dest" && tar xf -)
      rm -rf "$inner"
    fi
  fi
}

info "extracting node runtime"
extract_into "$WORK/$NODE_ARCHIVE" "$BUNDLE/runtime" strip

info "extracting firestarr engine"
extract_into "$WORK/$FIRESTARR_ASSET" "$BUNDLE/engine" keep

case "$PLATFORM" in
  windows-x64) BINARY_REL="engine/firestarr.exe" ;;
  *)           BINARY_REL="engine/firestarr" ;;
esac

[ -f "$BUNDLE/$BINARY_REL" ] \
  || die "expected $BINARY_REL after extracting $FIRESTARR_ASSET, but it is not there.
       The release archive layout has changed; the bundle would ship without an engine."

# proj.db is what firestarr resolves at runtime. install-nomad-san-metal.ps1
# documents that it fast-fails with Windows status 0xC0000409 when this is
# missing -- a loud failure at an incident that looks like a broken laptop.
[ -f "$BUNDLE/engine/proj.db" ] \
  || die "proj.db is not in $FIRESTARR_ASSET.
       PROJ_DATA would point at nothing and firestarr would fast-fail on the
       target with an opaque status code. See #381."

if [ "$INCLUDE_DATASET" -eq 1 ]; then
  for f in "$WORK"/FireSTARR_Fuel_*.zip; do
    [ -f "$f" ] || continue
    info "extracting $(basename "$f")"
    extract_into "$f" "$BUNDLE/data" keep
  done
fi

fetch_natives "$WORK/natives" "$NODE_ABI" "$NATIVE_PLATFORM" "$NATIVE_ARCH"
assemble_app "$BUNDLE" "$NODE_ABI" "$NATIVE_PLATFORM" "$NATIVE_ARCH"

write_launcher "$BUNDLE" "$LAUNCHER_NAME" "$PLATFORM" "$HOME_TIMEZONE" "$NOMAD_APP_VERSION"
write_env "$BUNDLE/.env" "$BINARY_REL" "$HOME_TIMEZONE" "$NOMAD_APP_VERSION"
write_manifest "$BUNDLE/manifest.json" "$NODE_SHA" "$FIRESTARR_SHA" "$DATASET_ENTRIES"

# ---------------------------------------------------------------------------
# Say plainly what is not here yet.
#
# The application payload and its native modules are the next slice. A tree
# that looks complete but cannot run is exactly the silent-failure shape this
# whole ticket exists to avoid, so it is marked rather than left to be
# discovered.
# ---------------------------------------------------------------------------
rm -f "$BUNDLE/BUNDLE_INCOMPLETE.txt"

if [ -f "$BUNDLE/$LAUNCHER_NAME" ]; then
  info "bundle tree: $BUNDLE"
else
  cat > "$BUNDLE/BUNDLE_INCOMPLETE.txt" <<NOTICE
This bundle is NOT ready to ship.

Present and verified:
  runtime/   Node $NODE_VERSION (ABI $NODE_ABI)
  engine/    firestarr $FIRESTARR_VERSION + proj.db
  app/       built backend and frontend, production dependencies,
             native addons for $NATIVE_PLATFORM-$NATIVE_ARCH
  .env       relative paths, binary execution mode
  manifest.json

Missing:
  $LAUNCHER_NAME   the launcher that sets the environment, starts the server
                   and opens a browser

Without it there is nothing for the practitioner to double-click, so the
bundle cannot yet be handed to anyone.

See #318.
NOTICE
  info "bundle tree: $BUNDLE"
  info "NOT yet shippable -- no launcher; see BUNDLE_INCOMPLETE.txt"
fi
