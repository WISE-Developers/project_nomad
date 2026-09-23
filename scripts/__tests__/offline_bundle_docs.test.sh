#!/usr/bin/env bash
#
# Offline bundle: the documented workflow (refs #318).
#
# Acceptance criterion #4 asks for a documented
# "build -> copy to USB -> install on N laptops" workflow. That is not a
# paperwork item, and reading it as one is what this suite guards against.
#
# The person who runs the builder and the person who carries the thumb drive
# to an incident are usually not the same person, and the second one has no
# network to look anything up with. Whatever they need has to be in their
# hand. "N laptops" also carries a real constraint: one build serves many
# machines, which is why the .env and the launcher are path-relative, and the
# document has to say so or someone will helpfully "fix" it into absolute
# paths.
#
# Three facts in particular must be written down, because getting any of them
# wrong wastes a trip to a fire:
#
#   - the dataset is about 3 GB per fuel year, not the ~50 GB some of our
#     older documentation still claims. A wrong figure sends someone hunting
#     for a disk they do not need, or reassures them when they are short.
#   - FAT32 cannot hold a file over 4 GB, which several of these bundles
#     exceed. The drive has to be exFAT or NTFS, and that is discovered at the
#     worst possible moment otherwise.
#   - --timezone is required at build time and belongs to where the bundle
#     will be USED, not where it was built.
#
# Deps: bash 3.x compatible (macOS ships 3.2). Exit 0 = all pass.

set -u

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$TEST_DIR/../.." && pwd)"
DOC="$REPO/Documentation/Nomad/offline-bundle.md"

pass=0
fail=0

ok()  { pass=$((pass + 1)); echo "    ok   $1"; }
bad() { fail=$((fail + 1)); echo "  FAIL   $1"; [ $# -gt 1 ] && echo "         $2"; }

if [ ! -f "$DOC" ]; then
  bad "Documentation/Nomad/offline-bundle.md exists" \
      "acceptance criterion #4 asks for a documented build -> USB -> install workflow"
  echo
  echo "offline_bundle_docs: $pass passed, $fail failed"
  exit 1
fi
ok "Documentation/Nomad/offline-bundle.md exists"

has() { grep -qiE "$1" "$DOC"; }

# ---------------------------------------------------------------------------
# The three stages the criterion names, by name.
# ---------------------------------------------------------------------------
has 'build-offline-bundle\.sh' \
  && ok "names the builder script" \
  || bad "names the builder script" "the reader cannot run what is not named"

has 'usb|thumb drive|removable' \
  && ok "covers copying to removable media" \
  || bad "covers copying to removable media"

has 'Nomad\.cmd|nomad\.sh' \
  && ok "tells the practitioner what to run on the target" \
  || bad "tells the practitioner what to run on the target" \
         "the launcher is the only thing they touch"

# ---------------------------------------------------------------------------
# One build, many laptops.
# ---------------------------------------------------------------------------
has 'n laptops|multiple laptops|many laptops|each laptop|every laptop' \
  && ok "states that one build serves many machines" \
  || bad "states that one build serves many machines" \
         "otherwise someone rebuilds per laptop, or edits paths per laptop"

# ---------------------------------------------------------------------------
# The three facts that cost a wasted trip if wrong.
# ---------------------------------------------------------------------------
has '3 ?GB|3GB|per fuel year|per year' \
  && ok "gives the real dataset size" \
  || bad "gives the real dataset size" "our older docs still claim ~50 GB, which is wrong"

# The point is that nobody reads "50 GB" here as the dataset size. Naming the
# stale figure in order to CORRECT it serves that purpose rather than breaking
# it -- someone who read the old number needs to find the retraction. So the
# check fails only on an uncorrected mention.
stale="$(grep -inE '50 ?GB' "$DOC" | grep -viE 'wrong|stale|incorrect|outdated|not the|no longer' || true)"
if [ -n "$stale" ]; then
  bad "never states ~50 GB as the dataset size" \
      "measured: one fuel year is about 3 GB, all four about 11 GB -- $(echo "$stale" | head -1)"
else
  ok "never states ~50 GB as the dataset size"
fi

has 'fat32|exfat|ntfs' \
  && ok "warns about the FAT32 4 GB file limit" \
  || bad "warns about the FAT32 4 GB file limit" \
         "bundles exceed 4 GB; a FAT32 stick fails at the worst moment"

has '\-\-timezone' \
  && ok "documents --timezone as required" \
  || bad "documents --timezone as required" \
         "the build fails without it, and the zone belongs to where the bundle is USED"

has '\-\-years|\-\-no-data' \
  && ok "documents the dataset flags" \
  || bad "documents the dataset flags"

# ---------------------------------------------------------------------------
# Honesty about what has not been proven.
#
# The Windows bundle has never been executed on Windows -- only built and
# inspected. Anyone relying on this document deserves to know that before
# they carry it to a fire, not after.
# ---------------------------------------------------------------------------
has 'never been (run|tested|executed) on windows|not been (run|tested|executed) on windows|unverified on windows|untested until someone runs it' \
  && ok "states plainly that the Windows bundle is unproven on Windows" \
  || bad "states plainly that the Windows bundle is unproven on Windows" \
         "it has been built and inspected, never executed; saying so is the difference between a caveat and a surprise"

echo
echo "offline_bundle_docs: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
