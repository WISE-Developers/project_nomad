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
  local binary_rel="${2:-engine/firestarr.exe}"

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

# Above 1024 so no elevation is needed to bind it.
PORT=4900
ENVFILE

  info "wrote bundle .env: $dest"
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
    --out)      OUT_DIR="${2:-}"; [ -n "$OUT_DIR" ] || die "--out needs a value"; shift 2 ;;
    -h|--help)  usage; exit 0 ;;
    *)          die "unknown option: $1 (see --help)" ;;
  esac
done

case "$PLATFORM" in
  windows-x64) NODE_ARCHIVE="node-${NODE_VERSION}-win-x64.zip"
               FIRESTARR_ASSET="firestarr-windows-x64-cl-Release.zip" ;;
  linux-x64)   NODE_ARCHIVE="node-${NODE_VERSION}-linux-x64.tar.xz"
               FIRESTARR_ASSET="firestarr-ubuntu-x64-gcc-Release.tar.gz" ;;
  macos-arm64) NODE_ARCHIVE="node-${NODE_VERSION}-darwin-arm64.tar.gz"
               FIRESTARR_ASSET="firestarr-macos-arm64-clang-Release.tar.gz" ;;
  *)           die "unsupported --platform '$PLATFORM' (windows-x64 | linux-x64 | macos-arm64)" ;;
esac

[ "$INCLUDE_DATASET" -eq 0 ] || [ -n "$DATASET_YEARS" ] || \
  die "specify --years (e.g. --years 2025) or pass --no-data.
       There is no default fuel vintage: guessing which year's fuels a
       practitioner needs is exactly the kind of silent assumption that
       produces a confidently wrong fire."

mkdir -p "$OUT_DIR"
WORK="$OUT_DIR/inputs"
mkdir -p "$WORK"

info "platform   $PLATFORM"
info "node       $NODE_VERSION"
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
    curl -fsSL -o "$WORK/$file" "${base}${file}" || die "could not download $file"
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

write_env "$BUNDLE/.env" "$BINARY_REL"
write_manifest "$BUNDLE/manifest.json" "$NODE_SHA" "$FIRESTARR_SHA" "$DATASET_ENTRIES"

# ---------------------------------------------------------------------------
# Say plainly what is not here yet.
#
# The application payload and its native modules are the next slice. A tree
# that looks complete but cannot run is exactly the silent-failure shape this
# whole ticket exists to avoid, so it is marked rather than left to be
# discovered.
# ---------------------------------------------------------------------------
cat > "$BUNDLE/BUNDLE_INCOMPLETE.txt" <<'NOTICE'
This bundle is NOT ready to ship.

Present and verified:
  runtime/   Node
  engine/    firestarr + proj.db
  .env       relative paths, binary execution mode
  manifest.json

Not yet assembled:
  app/       backend build, frontend build, production node_modules
             WITH native modules (better-sqlite3, gdal-async) compiled for the
             TARGET Node ABI and architecture -- not the build host's.
  launcher   Nomad.cmd / nomad.sh

A wrong native ABI fails on a practitioner's laptop, not on our bench, which
is why it is not being improvised here.

Delete this file when the above are done. See #318.
NOTICE

info "bundle tree: $BUNDLE"
info "NOT yet shippable -- see BUNDLE_INCOMPLETE.txt"
