#!/usr/bin/env bash
#
# Generate the release SBOM (#398).
#
#   .github/scripts/generate-sbom.sh <release-version> [output-path]
#
# Produces an SPDX 2.3 document describing every npm dependency of the
# application, derived from package-lock.json at the commit it runs on.
#
# WHY `npm sbom` RATHER THAN THE DEPENDENCY-GRAPH API OR AN ACTION
#
# npm 10 ships `npm sbom`, so there is no third-party action to trust and no
# network call. More importantly it reads the LOCKFILE, which means the document
# describes the exact tree of the tagged commit. GitHub's dependency-graph
# export describes whatever GitHub last indexed for the repository, which is
# usually the default branch and updates asynchronously — an SBOM attached to
# v1.2.3 that actually describes something else is the kind of true-looking
# artifact that is worse than none, because it is machine-readable and will be
# believed.
#
# WHY THE VERSION IS AN ARGUMENT AND NOT READ FROM package.json
#
# `npm sbom` names the document after the ROOT package, and this repo's root
# package.json has sat at 0.5.0 for a long time: .github/scripts/bump-version.sh
# bumps ONLY frontend/package.json, which is the product version (it becomes
# /app/VERSION in the image). Left alone, the document would call itself
# `project_nomad@0.5.0` on a v0.28.x release.
#
# Naming the FILE correctly does not fix that — consumers read the document's
# own `name` field, not the filename it arrived in. So the release version is
# passed in explicitly and stamped into the document, and this script REFUSES to
# run without one rather than guessing from a file it knows to be stale.
#
# (The root/backend package.json drift is a separate question and is not papered
# over here; this script only ensures the SBOM does not inherit it.)
set -euo pipefail

VERSION="${1:-}"
OUT="${2:-sbom.spdx.json}"

if [ -z "$VERSION" ]; then
    echo "Usage: generate-sbom.sh <release-version> [output-path]" >&2
    echo "Refusing to guess a version: the root package.json is not the product version." >&2
    exit 1
fi

if [ ! -f package-lock.json ]; then
    echo "No package-lock.json in $(pwd) — run this from the repository root." >&2
    exit 1
fi

RAW="$(mktemp)"
trap 'rm -f "$RAW"' EXIT

# --package-lock-only: the release workflow installs only frontend's
# node_modules, so a generator needing a full install would fail in CI while
# passing on every developer machine. That exact shape cost us a red `All
# tests` once already (#387).
#
# --workspaces: backend and frontend are where the dependencies actually live;
# the root package has two.
npm sbom \
    --sbom-format spdx \
    --sbom-type application \
    --package-lock-only \
    --workspaces \
    --include-workspace-root \
    > "$RAW"

# Stamp the release version over the root package's. Done with node rather than
# sed so a malformed document fails here, loudly, instead of being attached to a
# release in a state no tool can read.
node -e '
const fs = require("fs");
// `node -e` has no script path in argv, so the user arguments start at [1] —
// not [2] as they would for a file. Getting this wrong made the script try to
// open the version string as a file.
const [, raw, version, out] = process.argv;
const doc = JSON.parse(fs.readFileSync(raw, "utf8"));

const rootName = (doc.name || "").split("@")[0] || "project_nomad";
const staleVersion = (doc.name || "").split("@")[1] || "";
doc.name = `${rootName}@${version}`;

// The root package entry carries the version too: `name` is where most tools
// look, but not the only place, and a document disagreeing with itself is its
// own kind of wrong.
let stamped = 0;
let oldId = null;
for (const pkg of doc.packages || []) {
  if (pkg.SPDXID === "SPDXRef-Package" || pkg.name === rootName) {
    if (pkg.versionInfo === staleVersion) oldId = pkg.SPDXID;
    pkg.versionInfo = version;
    stamped++;
  }
}
if (stamped === 0) {
  console.error("Could not find the root package entry to stamp — SPDX shape changed.");
  process.exit(1);
}

// npm builds the root SPDXID out of the name AND version, so it reads
// `SPDXRef-Package-project_nomad-0.5.0` and `documentDescribes` points at it.
// SPDX ids are meant to be opaque, but leaving a stale version visible inside
// the identifier of a document whose whole purpose is to say what it describes
// is the loose end this script exists to prevent. Renaming it means following
// every reference — the id appears in documentDescribes and on both sides of
// relationships — so it is done by walking the structure rather than by a blind
// string replace over the file, which would also hit any package legitimately
// containing that text.
if (oldId) {
  const newId = oldId.replace(new RegExp(`-${staleVersion.replace(/\./g, "\\.")}$`), `-${version}`);
  if (newId !== oldId) {
    for (const pkg of doc.packages || []) {
      if (pkg.SPDXID === oldId) pkg.SPDXID = newId;
    }
    doc.documentDescribes = (doc.documentDescribes || []).map((id) => (id === oldId ? newId : id));
    for (const rel of doc.relationships || []) {
      if (rel.spdxElementId === oldId) rel.spdxElementId = newId;
      if (rel.relatedSpdxElement === oldId) rel.relatedSpdxElement = newId;
    }
  }

  // npm also builds documentNamespace from the root name and version
  // (".../nomad-0.5.0-<uuid>"). Its only requirement is uniqueness, so the uuid
  // carries that on its own and the version there is free to be correct.
  if (typeof doc.documentNamespace === "string" && staleVersion) {
    doc.documentNamespace = doc.documentNamespace.replace(`-${staleVersion}-`, `-${version}-`);
  }
}

// WHAT THIS DOCUMENT IS, said in the document (#398, #441).
//
// This is the BUILD-TIME bill: every npm package in the lockfile, development
// tooling included. It is deliberately NOT an inventory of the shipped
// container, and the difference is large enough to mislead someone scanning it.
//
// The image installs only `npm ci --workspace=@nomad/backend --omit=dev
// --omit=peer --omit=optional` (backend/Dockerfile), the frontend ships as
// compiled assets rather than node_modules, and neither the Debian base nor the
// Node runtime appears here at all.
//
// Filtering this document to match the image was considered and rejected:
// replicating that flag set would mean keeping two command lines in sync
// forever, in a repo that has already been bitten by getting it wrong (#389 —
// --omit=dev alone leaves devOptional entries behind). And the full tree earns
// its place: a poisoned build tool never appears in the artifact but can poison
// it, which an image-only SBOM would hide precisely.
const scope =
  "BUILD-TIME SCOPE. Lists every npm package in package-lock.json at the tagged " +
  "commit, INCLUDING development dependencies. This is not an inventory of the " +
  "shipped container image: the image installs backend production dependencies " +
  "only (--omit=dev --omit=peer --omit=optional), the frontend ships as compiled " +
  "assets rather than node_modules, and operating-system packages and the Node " +
  "runtime are not described here. Use it to answer what went INTO the build " +
  "(including build-chain exposure); it cannot answer what is present in a " +
  "running deployment.";

doc.comment = scope;
doc.creationInfo = doc.creationInfo || {};
doc.creationInfo.comment = scope;

fs.writeFileSync(out, JSON.stringify(doc, null, 2));
' "$RAW" "$VERSION" "$OUT"

echo "SBOM written to $OUT ($(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).packages.length)' "$OUT") packages, SPDX 2.3, version $VERSION)"
