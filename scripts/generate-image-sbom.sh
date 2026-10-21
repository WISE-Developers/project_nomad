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
# IT DOES NEED TRANSIENT DISK, AND I TRIED HARD TO AVOID THAT. The first version
# streamed `type=oci,dest=-` and parsed the tar in flight, so nothing was staged
# at all. MEASURED ON THE DEMO BOX 2026-10-21: that does not work. With
# `dest=-` the attestation blob is simply absent from the stream — buildx cannot
# seek back to add it — while the identical build with `dest=<file>` writes it.
# Same command, same image, one produced an SBOM and one produced nothing.
#
# So the export is written to a file, and the #464 lesson is applied where it
# actually bites: the file goes in the CALLER'S output directory, never /tmp,
# and free space is checked against the image size BEFORE starting, so a box
# that cannot hold it says so instead of failing halfway. The export is also far
# smaller than the old `docker save` path — 512 MB against 2.42 GB for the same
# image, because the OCI layers stay compressed.
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

# SPACE FIRST, because the whole point of #464 is that this step failed halfway
# and said so only in passing. The image's own size is a conservative bound: the
# OCI export compresses to roughly a fifth of it, so requiring the full size
# means we never start an export that cannot finish.
IMG_BYTES="$(docker image inspect "$IMAGE" --format '{{.Size}}' 2>/dev/null || echo 0)"
AVAIL_KB="$(df -Pk "$OUT_DIR" 2>/dev/null | awk 'NR==2{print $4}')"
if [ -n "${AVAIL_KB:-}" ] && [ "${IMG_BYTES:-0}" -gt 0 ]; then
    NEED_KB=$(( IMG_BYTES / 1024 ))
    if [ "$AVAIL_KB" -lt "$NEED_KB" ]; then
        write_status "FAILED" "only ${AVAIL_KB}KB free under $OUT_DIR, need ${NEED_KB}KB for the OCI export of $IMAGE"
        say_warn "Not enough free space under $OUT_DIR to export $IMAGE — image SBOM skipped. The deploy is unaffected."
        say_warn "Recorded in $STATUS_FILE"
        exit 1
    fi
fi

# --sbom=true asks BuildKit for the attestation. dest must be a FILE: with
# dest=- the attestation never appears in the stream (measured, see the header).
OCI_TAR="$CTX/oci.tar"
docker buildx build \
    --sbom=true \
    -f "$CTX/Dockerfile" \
    --output "type=oci,dest=$OCI_TAR" \
    "$CTX" >/dev/null 2>"$ERR"
BUILD_RC=$?

if [ "$BUILD_RC" != "0" ]; then
    DETAIL="$(head -c 400 "$ERR" 2>/dev/null | tr '\n' ' ')"
    [ -n "$DETAIL" ] || DETAIL="docker buildx build exited $BUILD_RC with no message"
    write_status "FAILED" "$DETAIL"
    say_warn "BuildKit could not attest $IMAGE — image SBOM skipped. The deploy is unaffected."
    say_warn "Recorded in $STATUS_FILE: $DETAIL"
    exit 1
fi

python3 -c '
import json, sys, tarfile

# DO NOT FILTER BLOBS BY SIZE. The first version skipped anything over 8 MiB on
# the reasoning that "layers are large and metadata is small". MEASURED FALSE on
# the demo box: the SPDX attestation for the Nomad image is 20.89 MB — 1334
# packages — and was the fifth-largest blob in the export, sitting just above
# that cutoff. The script reported "no SPDX attestation in the OCI output" while
# the attestation was right there, and the test passed because the
# stub attestation was a few hundred bytes.
#
# A size heuristic cannot separate a document from a layer, because an SBOM
# grows with the thing it describes. The CONTENT can: a gzipped layer starts
# with 0x1f 0x8b, JSON starts with "{". So peek one byte and only read the
# member if it could possibly be a document. Layers are skipped without being
# loaded, which is the property the size limit was reaching for.
candidates = {}

try:
    tf = tarfile.open(sys.argv[1], mode="r")
    for m in tf:
        if not m.isfile():
            continue
        f = tf.extractfile(m)
        if f is None:
            continue
        head = f.read(1)
        if head != b"{":
            continue
        candidates[m.name] = head + f.read()
except Exception as e:
    print("could not read the OCI export: %s" % e, file=sys.stderr)
    sys.exit(2)

# The blobs are scanned rather than resolved through the index, deliberately.
# MEASURED on the demo box: the attestation blob is present in `blobs/` while
# `index.json` does not list an `attestation-manifest` entry for it at all. A
# parser that walked the index would correctly conclude there was no
# attestation and be wrong. The predicate is identified by its own
# predicateType, never by position or by the index agreeing it exists.
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
for name, raw in candidates.items():
    if not name.startswith("blobs/"):
        continue
    found = predicate_from(raw)
    if found:
        break

if not found:
    print("no SPDX attestation in the OCI output", file=sys.stderr)
    sys.exit(3)

json.dump(found, sys.stdout, indent=2)
' "$OCI_TAR" > "$OUT_FILE" 2>"$CTX/extract.err"
EXTRACT_RC=$?

# Drop the export the moment it has been read. It is the largest thing this
# script touches and it is worthless once parsed; leaving it on a production
# box mid-deploy is its own hazard.
rm -f "$OCI_TAR"

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
