#!/usr/bin/env bash
#
# Bill of materials for the DEPLOYED IMAGE, from BuildKit (#441, reworked by #460).
#
#   ./scripts/generate-image-sbom.sh <image-ref> <version> [output-dir]
#
# #398 produces the build-time bill: every npm package in the lockfile, attached
# to the GitHub Release, and it says plainly that it is not an inventory of the
# shipped container. This is the other half — the Debian base, the Node runtime,
# the apt packages, and the node_modules actually installed into the image.
#
# WHY THIS NO LONGER USES syft, AND WHY THAT MATTERS (#464)
#
# The first implementation ran `docker save` into a temp tar and scanned it with
# `anchore/syft` in a container. It passed its tests and NEVER PRODUCED A
# DOCUMENT ON THE CIFFC DEMO BOX. Its temp allocator resolved to /tmp, which is a
# 1.9 GB loop mount there; the image is 2.42 GB. The export could not fit, the
# script warned, and exited 0 — by design. `/opt/nomad-app/sbom/` sat empty for
# two months and an empty directory looks exactly like a feature nobody checked.
#
# BuildKit emits an SPDX attestation itself, given `--sbom=true`. That removes
# both failure sources at once: no multi-gigabyte export, and no network pull
# mid-deploy. Verified on that same host 2026-10-21 — SPDX-2.3, and it does
# describe the OS layer (`pkg:deb` entries for gcc-14, libzstd, shadow, systemd,
# util-linux).
#
# HOW AN ALREADY-BUILT IMAGE GETS ATTESTED. Attestations are produced at build
# time, so they cannot be fetched from an existing tag. This builds a one-line
# wrapper image `FROM <image>` with `--sbom=true`; BuildKit scans the resulting
# filesystem, which is the image's filesystem. No layers are rebuilt.
#
# NOTHING LARGE IS EVER WRITTEN TO DISK. The OCI output is streamed to stdout
# and parsed in flight, keeping only members small enough to be metadata. That
# is the actual fix for #464 — not a better temp directory, but no temp file at
# all.
#
# TWO RULES, and the second is a deliberate REVERSAL of the original
#
#   1. A FAILED SBOM MUST NOT FAIL A DEPLOY. Unchanged, and still right: losing
#      the description is a warning, losing the deploy is an outage. deploy.sh
#      keeps swallowing this script's exit status.
#   2. BUT IT MUST LEAVE A DURABLE RECORD EITHER WAY. The original warned to
#      stdout, which is silent the moment a deploy finishes. A status file is
#      written on every path, success or failure, so the state is readable after
#      the fact — and the exit status is honest, so a caller that cares can tell.
set -u

IMAGE="${1:-}"
VERSION="${2:-}"
OUT_DIR="${3:-sbom}"

say_warn() { echo "[WARN] $*" >&2; }
say_ok()   { echo "[OK] $*"; }

if [ -z "$IMAGE" ] || [ -z "$VERSION" ]; then
    echo "Usage: generate-image-sbom.sh <image-ref> <version> [output-dir]" >&2
    echo "Refusing to guess: a document that misnames what it describes is worse than none." >&2
    exit 1
fi

mkdir -p "$OUT_DIR" 2>/dev/null || {
    say_warn "Could not create $OUT_DIR — image SBOM skipped"
    exit 1
}

OUT_FILE="$OUT_DIR/nomad-image-${VERSION}.spdx.json"
STATUS_FILE="$OUT_DIR/SBOM-STATUS-${VERSION}.txt"

# The build context and the error log live beside the output, never in /tmp.
# That is the #464 lesson stated as code: this directory is chosen by the
# caller and is on the same volume as the thing it is describing.
CTX="$OUT_DIR/.sbom-build.$$"
ERR="$CTX/buildx.err"
mkdir -p "$CTX" 2>/dev/null || {
    say_warn "Could not create a build context under $OUT_DIR — image SBOM skipped"
    exit 1
}
trap 'rm -rf "$CTX"' EXIT

write_status() { # write_status <state> <detail>
    {
        echo "state:   $1"
        echo "image:   $IMAGE"
        echo "version: $VERSION"
        echo "when:    $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
        echo "detail:  $2"
    } > "$STATUS_FILE" 2>/dev/null || true
}

printf 'FROM %s\n' "$IMAGE" > "$CTX/Dockerfile"

# --sbom=true asks BuildKit for the attestation; type=oci,dest=- streams the
# result so nothing is staged on disk. The extractor keeps only small members,
# so a multi-gigabyte image costs bounded memory rather than bounded disk.
docker buildx build \
    --sbom=true \
    -f "$CTX/Dockerfile" \
    --output type=oci,dest=- \
    "$CTX" 2>"$ERR" | python3 -c '
import json, sys, tarfile

# Layers are large and never metadata. 8 MiB is comfortably above any manifest,
# config or attestation and far below any real layer.
LIMIT = 8 * 1024 * 1024
small = {}

try:
    tf = tarfile.open(fileobj=sys.stdin.buffer, mode="r|*")
    for m in tf:
        if not m.isfile() or m.size > LIMIT:
            continue
        f = tf.extractfile(m)
        if f is not None:
            small[m.name] = f.read()
except Exception as e:
    print("could not read the OCI stream: %s" % e, file=sys.stderr)
    sys.exit(2)

# Prefer the declared attestation, but fall back to scanning the small blobs:
# the index is authoritative and the scan is the safety net for a layout whose
# annotations differ. Either way the predicate is identified by its own
# predicateType, never by position.
def predicate_from(raw):
    try:
        d = json.loads(raw)
    except Exception:
        return None
    if isinstance(d, dict) and "spdx" in str(d.get("predicateType", "")).lower():
        p = d.get("predicate")
        if isinstance(p, dict) and p.get("packages") is not None:
            return p
    return None

found = None
for name, raw in small.items():
    if not name.startswith("blobs/"):
        continue
    found = predicate_from(raw)
    if found:
        break

if not found:
    print("no SPDX attestation in the OCI output", file=sys.stderr)
    sys.exit(3)

json.dump(found, sys.stdout, indent=2)
' > "$OUT_FILE" 2>"$CTX/extract.err"

# PIPESTATUS, not $?, or a buildx failure is masked by a happy extractor. bash
# 3.x has it, which matters because macOS ships 3.x and these tests run there.
#
# COPY THE WHOLE ARRAY IN ONE STATEMENT. Reading PIPESTATUS[0] into a variable
# is itself a command, which resets PIPESTATUS — so the second read saw a
# one-element array and died under `set -u`. Caught by the test rather than in
# production, which is the only reason it is a footnote instead of an incident.
RCS=("${PIPESTATUS[@]}")
BUILD_RC="${RCS[0]:-1}"
EXTRACT_RC="${RCS[1]:-1}"

if [ "$BUILD_RC" != "0" ]; then
    rm -f "$OUT_FILE"
    DETAIL="$(head -c 400 "$ERR" 2>/dev/null | tr '\n' ' ')"
    [ -n "$DETAIL" ] || DETAIL="docker buildx build exited $BUILD_RC with no message"
    write_status "FAILED" "$DETAIL"
    say_warn "BuildKit could not attest $IMAGE — image SBOM skipped. The deploy is unaffected."
    say_warn "Recorded in $STATUS_FILE: $DETAIL"
    exit 1
fi

if [ "$EXTRACT_RC" != "0" ]; then
    rm -f "$OUT_FILE"
    DETAIL="$(head -c 400 "$CTX/extract.err" 2>/dev/null | tr '\n' ' ')"
    [ -n "$DETAIL" ] || DETAIL="could not extract an attestation (exit $EXTRACT_RC)"
    write_status "FAILED" "$DETAIL"
    say_warn "No SBOM attestation came back for $IMAGE — image SBOM skipped. The deploy is unaffected."
    say_warn "Recorded in $STATUS_FILE: $DETAIL"
    exit 1
fi

# A tool that exits 0 having written nothing usable is the failure that looks
# like success. Check before claiming a document exists.
if [ ! -s "$OUT_FILE" ]; then
    rm -f "$OUT_FILE"
    write_status "FAILED" "the attestation extracted to an empty document"
    say_warn "The SBOM extracted empty — image SBOM skipped."
    exit 1
fi

COUNT="$(python3 -c "
import json,sys
try:
    d=json.load(open(sys.argv[1]))
except Exception:
    print('?'); sys.exit(0)
print(len(d.get('packages',[])))
" "$OUT_FILE" 2>/dev/null || echo '?')"

OS_COUNT="$(python3 -c "
import json,sys
try:
    d=json.load(open(sys.argv[1]))
except Exception:
    print('?'); sys.exit(0)
print(sum(1 for p in d.get('packages',[])
          if any('pkg:deb' in (r.get('referenceLocator') or '')
                 for r in (p.get('externalRefs') or []))))
" "$OUT_FILE" 2>/dev/null || echo '?')"

write_status "OK" "$OUT_FILE ($COUNT packages, $OS_COUNT of them OS/deb)"
say_ok "Image SBOM: $OUT_FILE ($COUNT packages, $OS_COUNT from the OS layer)"
