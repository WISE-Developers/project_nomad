#!/usr/bin/env bash
#
# The deployed IMAGE gets its own bill of materials (#441).
#
# #398 added a build-time SBOM: every npm package in the lockfile, attached to
# the GitHub Release. It states plainly that it is not an inventory of the
# shipped container, because it is not — the image installs backend production
# dependencies only, and neither the Debian base nor the Node runtime appears
# in it at all. For a product delivered to agencies AS AN IMAGE, that is most
# of the supply chain undescribed.
#
# Franco chose to generate it during deploy. That is the only place the real
# image exists: `scripts/deploy.sh` builds it on the server, CI never does, so
# anything produced in CI would describe an image nobody runs.
#
# (The offline bundle is not affected — checked: it ships Node, native modules
# and FireSTARR binaries for a bare-metal install, not a container.)
#
# THE RULES THIS ENCODES, both learned from deploy.sh itself:
#
#   1. A FAILED SBOM MUST NEVER FAIL A DEPLOY. It is a description of the
#      thing, not the thing. Losing the description is a warning; losing the
#      deploy is an outage.
#   2. IT MUST SAY SO WHEN IT CANNOT RUN, loudly. A silently skipped step
#      leaves the next person believing an artifact exists that does not —
#      the same failure deploy.sh's self-update check has a warning for.
#
# Deps: bash 3.x (macOS default), python3. No docker, no network: the tool is
# stubbed. Exit 0 = all pass, 1 = any failure.
set -u

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$TEST_DIR/.." && pwd)"
GEN="$REPO/generate-image-sbom.sh"
DEPLOY="$REPO/deploy.sh"

pass=0; fail=0
ok()  { echo "  ok   - $1"; pass=$((pass+1)); }
bad() { echo "  FAIL - $1"; fail=$((fail+1)); }

if [ ! -f "$GEN" ]; then
  echo "  FAIL - scripts/generate-image-sbom.sh does not exist"
  echo ""
  echo "passed: 0   failed: 1"
  exit 1
fi
[ -x "$GEN" ] || bad "generate-image-sbom.sh is not executable"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
BIN="$WORK/bin"
mkdir -p "$BIN"

# A stubbed `docker`. STUB_MODE controls what it pretends:
#   ok        — save works, syft runs and emits a document
#   nosyft    — the syft image cannot be pulled (no network, or absent)
#   nosave    — `docker save` fails (image gone)
make_docker_stub() {
  cat > "$BIN/docker" <<'STUB'
#!/usr/bin/env bash
case "$1" in
  save)
    [ "${STUB_MODE:-ok}" = "nosave" ] && { echo "no such image" >&2; exit 1; }
    # -o <path> is the last argument pair
    out=""
    while [ $# -gt 0 ]; do [ "$1" = "-o" ] && out="$2"; shift; done
    printf 'fake-image-tar' > "$out"
    exit 0 ;;
  run)
    [ "${STUB_MODE:-ok}" = "nosyft" ] && { echo "Error response from daemon: pull access denied" >&2; exit 125; }
    printf '{"spdxVersion":"SPDX-2.3","name":"stub","packages":[{"name":"libc6","versionInfo":"2.36"},{"name":"nodejs","versionInfo":"22.12.0"}]}'
    exit 0 ;;
  *) echo "unexpected docker call: $*" >&2; exit 127 ;;
esac
STUB
  chmod +x "$BIN/docker"
}
make_docker_stub

run_gen() { # run_gen <image> <version> <outdir>
  ( cd "$WORK" && PATH="$BIN:$PATH" bash "$GEN" "$1" "$2" "$3" 2>&1 )
}

# ---------------------------------------------------------------------------
# 1. Arguments. Refusing beats inventing a label, same as the npm SBOM.
# ---------------------------------------------------------------------------
if ( cd "$WORK" && PATH="$BIN:$PATH" bash "$GEN" >/dev/null 2>&1 ); then
  bad "ran with no arguments"
else
  ok "refuses to run without an image and a version"
fi

# ---------------------------------------------------------------------------
# 2. The control: it produces a document, named for the version.
# ---------------------------------------------------------------------------
OUT="$WORK/sbom"
out="$(STUB_MODE=ok run_gen nomad-app-nomad:latest 1.2.3 "$OUT")"
rc=$?

if [ "$rc" = "0" ]; then ok "succeeds when the tool is available"; else bad "exited $rc: $out"; fi

file="$(ls "$OUT"/*.json 2>/dev/null | head -1)"
if [ -n "$file" ]; then
  ok "writes a document ($(basename "$file"))"
else
  bad "no document written"
fi

case "$(basename "${file:-}")" in
  *1.2.3*) ok "names the file for the version it describes" ;;
  *)       bad "filename does not carry the version: $(basename "${file:-none}")" ;;
esac

if [ -n "$file" ] && python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$file" 2>/dev/null; then
  ok "the document is valid JSON"
else
  bad "the document is not valid JSON"
fi

# It must describe the OS layer — that is the entire reason this exists.
if [ -n "$file" ] && grep -q "libc6" "$file"; then
  ok "contains OS packages, which the npm SBOM cannot see"
else
  bad "no OS packages in the document — it describes nothing new"
fi

# ---------------------------------------------------------------------------
# 3. IT MUST NOT TAKE THE DEPLOY DOWN. Both failure modes exit 0, loudly.
# ---------------------------------------------------------------------------
out="$(STUB_MODE=nosyft run_gen nomad-app-nomad:latest 1.2.4 "$OUT")"; rc=$?
if [ "$rc" = "0" ]; then
  ok "exits 0 when the SBOM tool is unavailable — a description is not the deploy"
else
  bad "exited $rc when the tool was missing; this would abort a deploy"
fi
case "$out" in
  *[Ww]arn*|*[Cc]ould\ not*|*[Uu]navailable*) ok "says SO when it cannot produce one" ;;
  *) bad "silently skipped: '$out'" ;;
esac

out="$(STUB_MODE=nosave run_gen nomad-app-nomad:latest 1.2.5 "$OUT")"; rc=$?
if [ "$rc" = "0" ]; then
  ok "exits 0 when the image cannot be exported"
else
  bad "exited $rc when docker save failed; this would abort a deploy"
fi

# ---------------------------------------------------------------------------
# 4. It must not leave the exported image tar behind. These are hundreds of
#    megabytes, on a server where a full disk is its own outage.
# ---------------------------------------------------------------------------
leftovers="$(find "$WORK" -name '*.tar' 2>/dev/null | head -3)"
if [ -z "$leftovers" ]; then
  ok "cleans up the exported image tar"
else
  bad "left an image tar behind: $leftovers"
fi

# ---------------------------------------------------------------------------
# 5. deploy.sh must actually call it, AFTER the new container is up — an image
#    described but never deployed, or a step that delays serving, are both wrong.
# ---------------------------------------------------------------------------
if grep -q "generate-image-sbom.sh" "$DEPLOY"; then
  ok "deploy.sh invokes the generator"
else
  bad "deploy.sh never calls it — the fix is unwired"
fi

up_line="$(grep -n 'docker compose up -d' "$DEPLOY" | head -1 | cut -d: -f1)"
sbom_line="$(grep -n 'generate-image-sbom.sh' "$DEPLOY" | head -1 | cut -d: -f1)"
if [ -n "$up_line" ] && [ -n "$sbom_line" ] && [ "$sbom_line" -gt "$up_line" ]; then
  ok "runs it after the container is recreated, not before"
else
  bad "SBOM step is not after 'docker compose up -d' (up=$up_line sbom=$sbom_line)"
fi

echo ""
echo "passed: $pass   failed: $fail"
[ "$fail" -eq 0 ]
