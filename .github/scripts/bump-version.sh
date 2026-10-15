#!/bin/bash
# bump-version.sh <bump-type>
# Reads frontend/package.json, applies semver bump, writes back, echoes new version.
# bump-type: patch | minor | major
set -euo pipefail

BUMP_TYPE="${1:-}"

if [[ "$BUMP_TYPE" != "patch" && "$BUMP_TYPE" != "minor" && "$BUMP_TYPE" != "major" ]]; then
    echo "ERROR: bump-version.sh requires argument: patch | minor | major" >&2
    exit 1
fi

PACKAGE_FILE="frontend/package.json"

if [[ ! -f "$PACKAGE_FILE" ]]; then
    echo "ERROR: $PACKAGE_FILE not found" >&2
    exit 1
fi

CURRENT=$(node -p "require('./${PACKAGE_FILE}').version")

IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"

case "$BUMP_TYPE" in
    major)
        MAJOR=$((MAJOR + 1))
        MINOR=0
        PATCH=0
        ;;
    minor)
        MINOR=$((MINOR + 1))
        PATCH=0
        ;;
    patch)
        PATCH=$((PATCH + 1))
        ;;
esac

NEW_VERSION="${MAJOR}.${MINOR}.${PATCH}"

# Write the new version to ALL THREE package.json files (#442).
#
# frontend/package.json remains the SOURCE — it is read above, it is the real
# product version, and it is what becomes /app/VERSION in the image. The other
# two are kept in step rather than consulted.
#
# They drifted to 0.5.0 and stayed there for most of a year because nothing
# reads their version programmatically. But two things depend on it being
# right anyway:
#
#   - `npm sbom` names its document after the ROOT package, so the release
#     bill of materials called itself project_nomad@0.5.0 on a v0.28.x
#     release (#398 stamps over it; this removes the cause).
#   - scripts/build-offline-bundle.sh copies backend/package.json into the
#     bundle as app/package.json, so the artifact handed to an agency carried
#     a manifest claiming 0.5.0.
#
# A missing sibling is skipped rather than created: writing a package.json
# that is not there would be a silent repo change nobody asked for.
for TARGET in "package.json" "backend/package.json" "$PACKAGE_FILE"; do
    [[ -f "$TARGET" ]] || continue
    node -e "
      const fs = require('fs');
      const pkg = JSON.parse(fs.readFileSync('${TARGET}', 'utf8'));
      pkg.version = '${NEW_VERSION}';
      fs.writeFileSync('${TARGET}', JSON.stringify(pkg, null, 2) + '\n');
    "
done


# The ROOT LOCKFILE moves with the root package.json, or the pair lies (#442).
#
# #442 bumped the three package.json files and left package-lock.json at 0.5.0.
# Before it, root and lock agreed because NEITHER moved; afterwards they
# disagreed on every release. `npm ci` tolerates it — measured, exit 0, deps
# untouched — which is why CI stayed green and nothing announced the drift.
#
# It still has to be fixed, because build-offline-bundle.sh stages
# package.json AND package-lock.json together into the agency bundle: the
# artifact handed to an agency carries two machine-readable manifests naming
# two different versions of the same package, and a machine-readable
# contradiction gets believed.
#
# Written with node rather than `npm install --package-lock-only`, deliberately:
# only the two version fields change, no registry is contacted, and the
# dependency tree cannot be resolved out from under a release. npm records the
# root version in BOTH `.version` and `.packages[""].version`.
#
# Absent lockfile is skipped, same rule as a missing sibling above.
LOCK_FILE="package-lock.json"
if [[ -f "$LOCK_FILE" ]]; then
    node -e "
      const fs = require('fs');
      const lock = JSON.parse(fs.readFileSync('${LOCK_FILE}', 'utf8'));
      lock.version = '${NEW_VERSION}';
      if (lock.packages && lock.packages['']) {
        lock.packages[''].version = '${NEW_VERSION}';
      }
      fs.writeFileSync('${LOCK_FILE}', JSON.stringify(lock, null, 2) + '\n');
    "
fi

echo "$NEW_VERSION"
