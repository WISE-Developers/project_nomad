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

write_manifest "$OUT_DIR/manifest.json" "$NODE_SHA" "$FIRESTARR_SHA" "$DATASET_ENTRIES"

info "inputs acquired and verified in $WORK"
