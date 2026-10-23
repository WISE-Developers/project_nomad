#!/usr/bin/env bash
#
# The image SBOM comes from BuildKit, not from a post-hoc syft scan (#460).
#
# WHY THIS REPLACES THE SYFT PATH
#
# #441 produced the image bill by `docker save`ing the image to a tar and
# running `anchore/syft` over it in a container. That worked in test and has
# never produced a document on the CIFFC demo box (#464): `mktemp -t` lands in
# /tmp, which is a 1.9 GB loop mount there, and the image is 2.42 GB. The export
# cannot fit, the script warns, and exits 0 — by design, because a failed SBOM
# must not fail a deploy.
#
# BuildKit generates an SPDX attestation itself with `--sbom=true`, which needs
# no export and no syft pull. Verified on that same host 2026-10-21: SPDX-2.3,
# and it does cover the OS layer (`pkg:deb` entries for gcc-14, libzstd, shadow,
# systemd, util-linux).
#
# THE TWO RULES THIS ENCODES, and the second is a REVERSAL
#
#   1. A FAILED SBOM MUST STILL NOT FAIL A DEPLOY. Unchanged from #441 and still
#      right: losing the description is a warning, losing the deploy is an
#      outage. deploy.sh keeps swallowing the exit status.
#   2. BUT IT MUST LEAVE A DURABLE RECORD WHEN IT CANNOT RUN. #441 warned to
#      stdout, which is silent the moment the deploy finishes — that is exactly
#      how #464 went unnoticed for two months, on a script whose own comments
#      said a silently skipped step was the failure to avoid. A warning nobody
#      re-reads is not loud. So: a status file in the output directory, always,
#      and a non-zero exit so a caller that cares can tell.
#
# The two negative assertions below are the regression guards for #464: no
# `docker save`, no syft pull. Those are what made the old path fail invisibly
# on a box with a small /tmp, and a test that only checked the happy path would
# have passed on the broken version.
#
# Deps: bash 3.x (macOS default), python3. No docker, no network: stubbed.
# Exit 0 = all pass, 1 = any failure.
set -u

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$TEST_DIR/.." && pwd)"
GEN="$REPO/generate-image-sbom.sh"

pass=0; fail=0
ok()  { echo "  ok   - $1"; pass=$((pass+1)); }
bad() { echo "  FAIL - $1"; fail=$((fail+1)); }

if [ ! -f "$GEN" ]; then
  echo "  FAIL - scripts/generate-image-sbom.sh does not exist"
  echo ""
  echo "passed: 0   failed: 1"
  exit 1
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
BIN="$WORK/bin"
mkdir -p "$BIN"

# A stubbed `docker`. STUB_MODE controls what it pretends:
#   ok        — buildx can attest; a REAL OCI tar with an SPDX attestation on stdout
#   noattest  — the daemon cannot carry attestations (classic image store)
#
# THE STUB EMITS AN ACTUAL OCI LAYOUT TAR, not bare JSON. The first version of
# this file wrote the predicate straight to the dest path, which would have let
# the test pass against an implementation that could not parse what BuildKit
# really produces. A stub simpler than the thing it stands in for tests the
# stub.
#
# Every call is appended to $CALLS so the negative assertions can inspect what
# the script actually reached for, not what it claims to do.
cat > "$BIN/docker" <<'STUB'
#!/usr/bin/env bash
echo "docker $*" >> "$CALLS"
case "$1" in
  buildx)
    case "${2:-}" in
      version) echo "github.com/docker/buildx v0.38.0"; exit 0 ;;
    esac
    if [ "${STUB_MODE:-ok}" = "noattest" ]; then
      echo "ERROR: attestations are not supported by the current builder" >&2
      exit 1
    fi
    # Where was the OCI output asked for? A FILE, since dest=- demonstrably
    # omits the attestation blob (measured on the demo box 2026-10-21).
    dest=""
    for a in "$@"; do
      case "$a" in *dest=*) dest="${a#*dest=}" ;; esac
    done
    if [ -z "$dest" ] || [ "$dest" = "-" ]; then
      echo "STUB: refusing dest=- — buildx omits the attestation when streaming" >&2
      exit 1
    fi
    python3 - "$dest" <<'PYOCI'
import hashlib, io, json, os, sys, tarfile

dest = sys.argv[1] if len(sys.argv) > 1 else "-"

def blob(obj):
    raw = json.dumps(obj).encode()
    return hashlib.sha256(raw).hexdigest(), raw

# A believable SPDX in-toto attestation predicate, with an OS package in it.
att_digest, att_raw = blob({
    "_type": "https://in-toto.io/Statement/v0.1",
    "predicateType": "https://spdx.dev/Document",
    "predicate": {
        "spdxVersion": "SPDX-2.3",
        "name": "sbom",
        # DELIBERATELY FAT. The real attestation for the Nomad image is 20.89 MB
        # (1334 packages) and an 8 MiB size filter silently skipped it while
        # this stub's few-hundred-byte version sailed through. A stub smaller
        # than reality tested the stub, again. Padding to >8 MiB makes any
        # future size heuristic fail here instead of in production.
        "packages": [
            {"name": "libc6", "versionInfo": "2.36",
             "externalRefs": [{"referenceType": "purl",
                               "referenceLocator": "pkg:deb/debian/libc6@2.36"}]},
            {"name": "systemd", "versionInfo": "252",
             "externalRefs": [{"referenceType": "purl",
                               "referenceLocator": "pkg:deb/debian/systemd@252"}]},
        ] + [
            {"name": "filler-%d" % i, "versionInfo": "1.0",
             "description": "x" * 400}
            for i in range(22000)
        ],
    },
})
cfg_digest, cfg_raw = blob({"architecture": "amd64", "os": "linux"})

att_manifest = {
    "schemaVersion": 2,
    "mediaType": "application/vnd.oci.image.manifest.v1+json",
    "config": {"mediaType": "application/vnd.oci.image.config.v1+json",
               "digest": "sha256:" + cfg_digest, "size": len(cfg_raw)},
    "layers": [{"mediaType": "application/vnd.in-toto+json",
                "digest": "sha256:" + att_digest, "size": len(att_raw),
                "annotations": {"in-toto.io/predicate-type": "https://spdx.dev/Document"}}],
}
am_digest, am_raw = blob(att_manifest)

img_manifest = {
    "schemaVersion": 2,
    "mediaType": "application/vnd.oci.image.manifest.v1+json",
    "config": {"mediaType": "application/vnd.oci.image.config.v1+json",
               "digest": "sha256:" + cfg_digest, "size": len(cfg_raw)},
    "layers": [],
}
im_digest, im_raw = blob(img_manifest)

index = {
    "schemaVersion": 2,
    "mediaType": "application/vnd.oci.image.index.v1+json",
    "manifests": [
        {"mediaType": "application/vnd.oci.image.manifest.v1+json",
         "digest": "sha256:" + im_digest, "size": len(im_raw),
         "platform": {"architecture": "amd64", "os": "linux"}},
        {"mediaType": "application/vnd.oci.image.manifest.v1+json",
         "digest": "sha256:" + am_digest, "size": len(am_raw),
         "platform": {"architecture": "unknown", "os": "unknown"},
         "annotations": {"vnd.docker.reference.type": "attestation-manifest"}},
    ],
}

out = open(dest, "wb")
tf = tarfile.open(fileobj=out, mode="w|")

def add(name, raw):
    ti = tarfile.TarInfo(name)
    ti.size = len(raw)
    tf.addfile(ti, io.BytesIO(raw))

# A fat layer FIRST, so a parser that buffers everything is caught by its own
# memory use and one that resolves index.json last still works. Real BuildKit
# puts blobs before index.json too.
add("oci-layout", json.dumps({"imageLayoutVersion": "1.0.0"}).encode())
add("blobs/sha256/" + cfg_digest, cfg_raw)
add("blobs/sha256/" + ("f" * 64), b"X" * (3 * 1024 * 1024))
add("blobs/sha256/" + att_digest, att_raw)
add("blobs/sha256/" + am_digest, am_raw)
add("blobs/sha256/" + im_digest, im_raw)
add("index.json", json.dumps(index).encode())
tf.close()
out.close()
PYOCI
    exit 0 ;;
  info)
    if [ "${STUB_MODE:-ok}" = "noattest" ]; then echo "overlay2"; else echo "io.containerd.snapshotter.v1"; fi
    exit 0 ;;
  image)
    # `docker image inspect <img> --format {{.Size}}` for the space precheck.
    echo "${STUB_IMAGE_BYTES:-1048576}"
    exit 0 ;;
  save)
    echo "STUB SAW docker save — the whole point of #460 is not to do this" >&2
    exit 1 ;;
  run)
    echo "STUB SAW docker run — syft should not be pulled any more" >&2
    exit 1 ;;
  *) exit 0 ;;
esac
STUB
chmod +x "$BIN/docker"

CALLS="$WORK/calls"
: > "$CALLS"

run_gen() { # run_gen <image> <version> <outdir>
  : > "$CALLS"
  ( cd "$WORK" && PATH="$BIN:$PATH" CALLS="$CALLS" \
      STUB_MODE="${STUB_MODE:-ok}" STUB_IMAGE_BYTES="${STUB_IMAGE_BYTES:-1048576}" \
      bash "$GEN" "$1" "$2" "$3" 2>&1 )
}

# ---------------------------------------------------------------------------
# 1. Arguments. Refusing beats inventing a label.
# ---------------------------------------------------------------------------
if ( cd "$WORK" && PATH="$BIN:$PATH" CALLS="$CALLS" bash "$GEN" >/dev/null 2>&1 ); then
  bad "ran with no arguments"
else
  ok "refuses to run without an image and a version"
fi

# ---------------------------------------------------------------------------
# 2. The control: it produces a document when the daemon can attest.
# ---------------------------------------------------------------------------
OUT="$WORK/sbom"
out="$(STUB_MODE=ok run_gen nomad-app-nomad:latest 1.2.3 "$OUT")"; rc=$?
[ "$rc" = "0" ] && ok "exits 0 when the daemon can attest" || bad "exited $rc: $out"

file="$(ls "$OUT"/*.json 2>/dev/null | head -1)"
if [ -n "$file" ]; then ok "writes a document ($(basename "$file"))"; else bad "no document written"; fi

case "$(basename "${file:-}")" in
  *1.2.3*) ok "names the file for the version it describes" ;;
  *) bad "filename does not carry the version: $(basename "${file:-none}")" ;;
esac

if [ -n "$file" ] && python3 -c "
import json,sys
d=json.load(open(sys.argv[1]))
sys.exit(0 if d.get('spdxVersion','').startswith('SPDX-2') and d.get('packages') else 1)
" "$file" 2>/dev/null; then
  ok "the document is parseable SPDX with packages in it"
else
  bad "document is not parseable SPDX with packages"
fi

if [ -n "$file" ] && python3 -c "
import json,sys
d=json.load(open(sys.argv[1]))
debs=[p for p in d.get('packages',[]) if any('pkg:deb' in (r.get('referenceLocator') or '') for r in (p.get('externalRefs') or []))]
sys.exit(0 if debs else 1)
" "$file" 2>/dev/null; then
  ok "the document carries OS (pkg:deb) packages, which is the point of #441/#460"
else
  bad "no pkg:deb entries — the OS layer is what this document exists to describe"
fi

# ---------------------------------------------------------------------------
# 3. THE #464 REGRESSION GUARDS. These are the reason this file exists.
# ---------------------------------------------------------------------------
if grep -q 'docker save' "$CALLS"; then
  bad "called 'docker save' — that is the 2.42GB export that silently failed on a 1.9G /tmp (#464)"
else
  ok "never calls 'docker save' (no multi-gigabyte export)"
fi

if grep -qE 'docker run .*syft' "$CALLS"; then
  bad "still pulls syft — BuildKit generates the attestation itself"
else
  ok "never pulls syft (no network dependency mid-deploy)"
fi

# Comments are allowed to NAME the old bug; code is not allowed to repeat it.
# The first version of this check grepped the whole file and failed on the
# implementation's own explanatory comment — a guard that cannot tell code from
# prose fails on an accurate description of the thing it is guarding against.
if grep -v '^[[:space:]]*#' "$GEN" | grep -q 'mktemp -t'; then
  bad "code still allocates scratch with 'mktemp -t', which lands in /tmp — the #464 cause"
else
  ok "no 'mktemp -t' in code (comments may still name the old bug)"
fi

# The OCI export is the biggest thing this script touches. It must not be left
# behind on a production box, and it must never be allocated in /tmp.
if [ -z "$(find "$OUT" -name 'oci.tar' 2>/dev/null)" ]; then
  ok "removes the OCI export after reading it"
else
  bad "left the OCI export on disk"
fi

if grep -v '^[[:space:]]*#' "$GEN" | grep -q 'df -Pk'; then
  ok "checks free space before exporting (the #464 failure mode, stated up front)"
else
  bad "no free-space precheck — #464 was a halfway failure for want of one"
fi

# A box without room must refuse BEFORE the export, and say so durably.
OUT3="$WORK/sbom3"
out="$(STUB_MODE=ok STUB_IMAGE_BYTES=999999999999 run_gen nomad-app-nomad:latest 9.9.9 "$OUT3" 2>&1)"; rc=$?
if [ "$rc" != "0" ] && ls "$OUT3"/*STATUS* >/dev/null 2>&1 && grep -qi 'free' "$OUT3"/*STATUS*; then
  ok "refuses up front when free space is short, and records why"
else
  bad "did not refuse-and-record on insufficient space (rc=$rc)"
fi

# ---------------------------------------------------------------------------
# 4. THE REVERSAL. When it cannot run, it must say so DURABLY, not just warn.
# ---------------------------------------------------------------------------
OUT2="$WORK/sbom2"
out="$(STUB_MODE=noattest run_gen nomad-app-nomad:latest 1.2.3 "$OUT2")"; rc=$?

if [ "$rc" != "0" ]; then
  ok "exits non-zero when it cannot produce an attestation"
else
  bad "exited 0 after failing — the caller cannot tell (this is the #464 shape)"
fi

status="$(ls "$OUT2"/*STATUS* "$OUT2"/*status* 2>/dev/null | head -1)"
if [ -n "$status" ]; then
  ok "leaves a durable status file after a failure ($(basename "$status"))"
else
  bad "left no status file — an empty sbom/ is indistinguishable from a skipped one (#464)"
fi

if [ -n "$status" ] && grep -qi 'attest' "$status" 2>/dev/null; then
  ok "the status file names the reason"
else
  bad "the status file does not say why it could not run"
fi

# An empty output directory must never be the only evidence.
if [ -n "$(ls -A "$OUT2" 2>/dev/null)" ]; then
  ok "the output directory is not left empty on failure"
else
  bad "output directory left empty on failure — exactly what #464 looked like on disk"
fi

# ---------------------------------------------------------------------------
# 5. A FILENAME MUST NEVER CARRY UN-SANITISED CALLER INPUT (#469).
#
# deploy.sh passed the version as the JSON fragment `"version":"0.36.0"` and
# this script put it straight into a filename, so the CIFFC demo now holds
# `nomad-image-"version":"0.36.0".spdx.json`. The caller's bug is #469's first
# half; THIS is the second half, and it is the reason the defect surfaced as
# mangled artefacts rather than being caught at the boundary.
#
# The point is not to tolerate a bad caller. It is that a script which names
# files from an argument owns the safety of that name regardless of who calls
# it, and there is no version string for which a quote, colon, slash or newline
# in the filename is the right outcome.
echo ""
echo "hostile version strings cannot produce hostile filenames (#469)"

OUT4="$WORK/sbom4"
out="$(STUB_MODE=ok run_gen nomad-app-nomad:latest '"version":"0.36.0"' "$OUT4" 2>&1)"; rc=$?

produced="$(ls "$OUT4" 2>/dev/null | tr '\n' ' ')"
if [ -z "$produced" ]; then
  bad "nothing was written at all for a hostile version (rc=$rc)"
else
  ok "still produced output for a hostile version ($produced)"
fi

# Whether it sanitises or refuses, what it must NOT do is create these names.
hostile=0
for n in $(ls "$OUT4" 2>/dev/null); do
  case "$n" in
    *'"'*|*:*|*'/'*|*' '*) hostile=$((hostile+1)) ;;
  esac
done
if [ "$hostile" -eq 0 ]; then
  ok "no filename contains a quote, colon, slash or space"
else
  bad "$hostile filename(s) carry shell-hostile characters — the #469 defect"
fi

# And the version recorded INSIDE the status file must be the clean one too,
# because that line is the document's own provenance.
if ls "$OUT4"/*STATUS* >/dev/null 2>&1 && ! grep -q '"version"' "$OUT4"/*STATUS* 2>/dev/null; then
  ok "the status file records a clean version, not the raw fragment"
else
  bad "the status file carries the raw JSON fragment as the version"
fi

# A clean version must still pass through untouched — sanitising must not
# mangle the normal case.
OUT5="$WORK/sbom5"
STUB_MODE=ok run_gen nomad-app-nomad:latest 0.36.0 "$OUT5" >/dev/null 2>&1
if [ -f "$OUT5/nomad-image-0.36.0.spdx.json" ]; then
  ok "a clean version is used verbatim (nomad-image-0.36.0.spdx.json)"
else
  bad "a clean version was altered: $(ls "$OUT5" 2>/dev/null | tr '\n' ' ')"
fi

echo ""
echo "passed: $pass   failed: $fail"
[ "$fail" = "0" ] || exit 1
