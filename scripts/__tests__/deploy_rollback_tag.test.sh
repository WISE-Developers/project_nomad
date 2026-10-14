#!/usr/bin/env bash
#
# A rollback tag must name the version the image CONTAINS (#437).
#
# deploy.sh tagged the outgoing image with the version it was deploying TO,
# read out of the frontend/package.json it had just pulled. Measured on the
# CIFFC demo across three generations, every rollback-X held X-1:
#
#   rollback-0.28.0 -> 0.26.0
#   rollback-0.26.0 -> 0.25.0
#   rollback-0.25.0 -> 0.24.0
#
# The rollback PATH worked; the names lied. That matters because the tag is read
# in an outage, by whoever is on hand, under time pressure, and two readings are
# available that disagree:
#
#   "rollback-0.28.0 is what I roll back TO when 0.28.0 is bad"  - what it meant
#   "rollback-0.28.0 IS 0.28.0"                                  - what it said
#
# Anyone verifying "am I running the version this tag names?" got a wrong
# answer, and the discrepancy was visible only by running the image and reading
# /app/VERSION.
#
# WHY THIS TEST EXECUTES RATHER THAN GREPS. Its siblings here assert deploy.sh's
# source text, which is the right call for behaviour that only a production host
# can exercise. This bug is different: it is a WRONG VALUE, not a missing
# mechanism, and a grep for "reads /app/VERSION" would pass on a line that read
# it and then ignored it. So the function is extracted and run against a stubbed
# docker, and the assertions are about the string it returns.
#
# Deps: bash 3.x (macOS default), sed. Exit 0 = all pass, 1 = any failure.
set -u

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY="$TEST_DIR/../deploy.sh"
[ -f "$DEPLOY" ] || { echo "deploy.sh not found at $DEPLOY"; exit 1; }

pass=0; fail=0
ok()  { echo "  ok   - $1"; pass=$((pass+1)); }
bad() { echo "  FAIL - $1"; fail=$((fail+1)); }

# ---------------------------------------------------------------------------
# Extract the function under test.
#
# deploy.sh ends in `main "$@"`, so it cannot be sourced — sourcing it would
# deploy. Lifting the one function out keeps this honest: it runs the real code
# from the real file, and fails loudly if the function is renamed away.
# ---------------------------------------------------------------------------
FN_SRC="$(sed -n '/^outgoing_image_version() {/,/^}/p' "$DEPLOY")"
if [ -z "$FN_SRC" ]; then
  echo "  FAIL - deploy.sh has no outgoing_image_version() to test"
  echo ""
  echo "passed: 0   failed: 1"
  exit 1
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# A stub docker whose behaviour each case controls through STUB_VERSION /
# STUB_FAIL. The real one is never called: no daemon, no images, nothing
# touched on this machine.
make_harness() {
  cat > "$WORK/harness.sh" <<HARNESS
set -u
docker() {
  # Only the read we care about is emulated; anything else is a test bug.
  case "\$*" in
    *"--entrypoint cat"*"/app/VERSION"*|*"cat"*"/app/VERSION"*)
      if [ "\${STUB_FAIL:-0}" = "1" ]; then
        echo "Error response from daemon: no such image" >&2
        return 1
      fi
      printf '%s\n' "\${STUB_VERSION:-}"
      return 0
      ;;
    *)
      echo "unexpected docker call: \$*" >&2
      return 127
      ;;
  esac
}
print_warning() { echo "[WARN] \$*"; }
print_info()    { echo "[INFO] \$*"; }
print_success() { echo "[OK] \$*"; }
$FN_SRC
HARNESS
}
make_harness

run_fn() { # run_fn <image-ref>
  bash -c 'source "$1"; outgoing_image_version "$2"' _ "$WORK/harness.sh" "$1" 2>/dev/null
}
run_fn_status() {
  bash -c 'source "$1"; outgoing_image_version "$2" >/dev/null 2>&1' _ "$WORK/harness.sh" "$1"
  echo $?
}

# ---------------------------------------------------------------------------
# 1. THE CONTROL, and the bug itself.
#
# The outgoing image holds 0.26.0 while the deploy is going TO 0.28.0. The
# function must say 0.26.0. The old code would have produced 0.28.0 here, which
# is the whole defect in one assertion.
# ---------------------------------------------------------------------------
got="$(STUB_VERSION=0.26.0 run_fn nomad-app-nomad:latest)"
if [ "$got" = "0.26.0" ]; then
  ok "reports the version the image CONTAINS (0.26.0)"
else
  bad "expected 0.26.0 from the image, got '$got'"
fi

if [ "$got" != "0.28.0" ]; then
  ok "does not report the version being deployed TO"
else
  bad "returned the INCOMING version — this is #437 exactly"
fi

# ---------------------------------------------------------------------------
# 2. Whitespace. `cat` of a file written by `echo` carries a newline, and a tag
#    with a trailing newline is not a valid docker reference.
# ---------------------------------------------------------------------------
got="$(STUB_VERSION='  0.27.3  ' run_fn nomad-app-nomad:latest)"
case "$got" in
  *[[:space:]]*) bad "version not trimmed — '$got' would be an invalid docker tag" ;;
  "0.27.3")      ok "trims whitespace so the tag is a valid docker reference" ;;
  *)             bad "expected 0.27.3, got '$got'" ;;
esac

# ---------------------------------------------------------------------------
# 3. FAILURE MUST FAIL, NOT GUESS.
#
# If the outgoing image has no /app/VERSION — an image older than that file, or
# a docker hiccup — the function must report failure. Returning the incoming
# version "to have something" would rebuild the exact bug being fixed, and the
# wrong name would look authoritative.
# ---------------------------------------------------------------------------
status="$(STUB_FAIL=1 run_fn_status nomad-app-nomad:latest)"
if [ "$status" != "0" ]; then
  ok "fails when the image's version cannot be read"
else
  bad "returned success on an unreadable image — the caller cannot tell"
fi

got="$(STUB_FAIL=1 run_fn nomad-app-nomad:latest)"
if [ -z "$got" ]; then
  ok "emits nothing on failure, so no caller can mistake output for a version"
else
  bad "emitted '$got' on failure — a caller would tag with that"
fi

# An image that predates /app/VERSION answers with an empty file rather than an
# error. Empty is not a version either.
status="$(STUB_VERSION='' run_fn_status nomad-app-nomad:latest)"
if [ "$status" != "0" ]; then
  ok "treats an empty /app/VERSION as a failure, not as a blank version"
else
  bad "accepted an empty version — the tag would end in a bare 'rollback-'"
fi

# ---------------------------------------------------------------------------
# 4. Source-level: the tag must no longer be built from the pulled package.json.
#    Executing the function proves it returns the right string; this proves the
#    CALLER uses it. A correct function nothing calls is not a fix.
# ---------------------------------------------------------------------------
tag_line="$(grep -n 'rollback-' "$DEPLOY" | grep -v '^[0-9]*:#' | head -5)"
if echo "$tag_line" | grep -q 'rollback-\$version'; then
  bad "still tags with \$version (the INCOMING version read from frontend/package.json)"
else
  ok "no longer tags with the incoming \$version"
fi

if grep -q 'outgoing_image_version' "$DEPLOY"; then
  ok "the tagging path calls outgoing_image_version"
else
  bad "outgoing_image_version is never called — the fix is unwired"
fi

# ---------------------------------------------------------------------------
# 5. A failed read must not silently skip the rollback tag either. Losing the
#    safety net quietly is its own outage story.
# ---------------------------------------------------------------------------
if grep -qiE 'rollback.*(could not|cannot|unknown)|(could not|cannot).*rollback' "$DEPLOY"; then
  ok "says something when it cannot name the outgoing version"
else
  bad "no warning path — an unreadable version would drop the rollback tag in silence"
fi

echo ""
echo "passed: $pass   failed: $fail"
[ "$fail" -eq 0 ]
