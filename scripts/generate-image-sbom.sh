#!/usr/bin/env bash
#
# Bill of materials for the DEPLOYED IMAGE (#441).
#
#   ./scripts/generate-image-sbom.sh <image-ref> <version> [output-dir]
#
# #398 produces the build-time bill: every npm package in the lockfile,
# attached to the GitHub Release, and it says plainly that it is not an
# inventory of the shipped container. This is the other half — the Debian
# base, the Node runtime, the apt packages, and the node_modules that were
# actually installed into the image.
#
# WHY IT RUNS AT DEPLOY AND NOT IN CI. The application image is built on the
# server by deploy.sh; CI never builds one. An SBOM produced in CI would
# therefore describe an image nobody runs, which is worse than none — it would
# be precise about the wrong artifact.
#
# TWO RULES, both taken from deploy.sh's own hard-won behaviour:
#
#   1. A FAILED SBOM MUST NEVER FAIL A DEPLOY. It is a description of the
#      thing, not the thing. This script exits 0 on every failure path.
#   2. IT MUST SAY SO WHEN IT CANNOT RUN. A silently skipped step leaves
#      someone believing an artifact exists when it does not — the same reason
#      deploy.sh warns when it cannot hash itself.
#
# ON THE TOOL. syft is run as a CONTAINER rather than installed on the host, so
# nothing is added to a production machine permanently. It reads an exported
# image tar rather than the docker socket: mounting the socket into a container
# hands it control of the daemon, which is not a trade worth making to describe
# an image.
#
# The pull needs network. When there is none the deploy proceeds and says the
# SBOM was skipped — which is the correct order of priorities for a box that is
# mid-deploy.
set -u

IMAGE="${1:-}"
VERSION="${2:-}"
OUT_DIR="${3:-sbom}"
# PINNED, not :latest. This runs on a production host during a deploy; an
# unpinned scanner means the tool can change under us between two deploys and
# the first warning would be a changed document or a broken invocation. v1.54.1
# is the release current when this was written (2026-10-06), checked rather
# than assumed. Override with NOMAD_SYFT_IMAGE to move it deliberately.
SYFT_IMAGE="${NOMAD_SYFT_IMAGE:-anchore/syft:v1.54.1}"

say_warn() { echo "[WARN] $*" >&2; }
say_ok()   { echo "[OK] $*"; }

if [ -z "$IMAGE" ] || [ -z "$VERSION" ]; then
    echo "Usage: generate-image-sbom.sh <image-ref> <version> [output-dir]" >&2
    # The ONE case that exits non-zero: called wrongly by a developer, which is
    # a bug to fix rather than a condition to tolerate. deploy.sh always passes
    # both.
    exit 1
fi

mkdir -p "$OUT_DIR" 2>/dev/null || {
    say_warn "Could not create $OUT_DIR — image SBOM skipped"
    exit 0
}

TAR="$(mktemp -t nomad-image-XXXXXX)" || {
    say_warn "Could not create a temp file — image SBOM skipped"
    exit 0
}
# The export is hundreds of megabytes. Remove it on every exit path, including
# the failures below: a full disk on a server mid-deploy is its own outage.
trap 'rm -f "$TAR"' EXIT

if ! docker save "$IMAGE" -o "$TAR" 2>/dev/null; then
    say_warn "Could not export $IMAGE with docker save — image SBOM skipped. The deploy is unaffected."
    exit 0
fi

OUT_FILE="$OUT_DIR/nomad-image-${VERSION}.spdx.json"

# --quiet so syft's progress output does not land in the document. The mount is
# read-only: syft needs to read the tar and nothing else.
# `--from docker-archive` is the current way to name the source type; the older
# `docker-archive:/path` prefix is deprecated. Checked against syft's own docs
# rather than guessed, because the stub in the test accepts any invocation and
# therefore cannot catch a wrong one.
#
# -o spdx-json emits SPDX 2.3, matching the npm bill from #398, so the two
# documents are the same dialect.
#
# -q keeps progress output off stdout, which is the document.
if ! docker run --rm -v "$TAR:/image.tar:ro" "$SYFT_IMAGE" \
        scan /image.tar --from docker-archive -o spdx-json -q > "$OUT_FILE" 2>/dev/null; then
    rm -f "$OUT_FILE"
    say_warn "Could not run $SYFT_IMAGE (no network, or the image is unavailable) — image SBOM skipped. The deploy is unaffected."
    exit 0
fi

# A tool that exits 0 having written nothing usable is the failure that looks
# like success. Check before claiming one exists.
if [ ! -s "$OUT_FILE" ]; then
    rm -f "$OUT_FILE"
    say_warn "The SBOM tool produced an empty document — image SBOM skipped."
    exit 0
fi

COUNT="$(python3 -c "
import json,sys
try:
    d=json.load(open(sys.argv[1]))
except Exception:
    print('?'); sys.exit(0)
print(len(d.get('packages',[])))
" "$OUT_FILE" 2>/dev/null || echo '?')"

say_ok "Image SBOM: $OUT_FILE ($COUNT packages, including the OS layer)"
