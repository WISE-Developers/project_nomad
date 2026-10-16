#!/usr/bin/env bash
#
# should-release.sh "<head commit message>"
#
#   exit 0  -> cut a stable release for this push
#   exit 1  -> this push IS the stable release bot's own version bump; skip it
#
# WHY THIS EXISTS (#444)
#
# stable-release.yml has to avoid triggering itself: it commits a version bump
# to main, and that push would start it again. It did that by refusing any head
# commit containing `[release-bot]`.
#
# But that marker is written by BOTH release bots:
#
#   chore: release v0.29.0 [release-bot]   the stable bot's own bump   -> skip
#   chore: dev v0.28.12 [release-bot]      dev's bump                  -> RELEASE
#
# A dev -> main merge pushes DEV's history, and dev's tip is usually a bot bump,
# so the guard matched commits that were not its own and the release was
# skipped for a push carrying a whole sprint. Silently — no failed check, no red
# X, the PR just looks merged. PR #443 shipped nothing this way on 2026-10-15,
# and whether it happened at all depended on the merge STRATEGY: a rebase put
# dev's bot commit at main's tip, a merge commit would not have.
#
# WHY NOT GUARD ON THE COMMIT AUTHOR, which #444 offered as the durable fix:
# measured against real history, BOTH bots commit as `github-actions[bot]`, so
# an author guard skips the rebased dev bump exactly the same way. It does not
# fix the bug it was offered for.
#
# So the gate identifies the stable bot's own commit SPECIFICALLY: the subject
# it writes, `chore: release ...`, together with the marker. A dev bump carries
# the marker and a different prefix, and releases.
#
# THE TWO FAILURE DIRECTIONS ARE NOT EQUAL, and this script is deliberately
# asymmetric about them:
#
#   - Refusing a release that was due is SILENT. Nothing goes red; the work sits
#     on main looking shipped. That is #444, and it cost a sprint.
#   - Cutting a release that was not due is LOUD and recoverable — except in one
#     case, the bot's own bump, where it loops forever.
#
# So anything this script cannot positively identify as the stable bot's own
# bump releases. An empty or unreadable message releases. The single case that
# must never be got wrong is covered by a test that reads the commit message out
# of stable-release.yml itself, so renaming that commit fails a test here rather
# than looping in production.
set -euo pipefail

MESSAGE="${1-}"

# Only the first line matters: `github.event.head_commit.message` carries the
# whole body, and a merge commit's body routinely quotes other subjects.
SUBJECT="${MESSAGE%%$'\n'*}"

# TWO MARKERS, because the bot has used both. Found by testing against real
# history rather than against the marker in today's workflow: v0.19.0 and
# v0.20.0 were committed as `chore: release vX.Y.Z [skip ci]`. Those never
# looped, because `[skip ci]` makes GitHub skip the run outright — but a gate
# pinned to whichever marker is current is a gate that is right by accident.
case "$SUBJECT" in
    "chore: release "*)
        case "$SUBJECT" in
            *"[release-bot]"*|*"[skip ci]"*)
                echo "skip: this is the stable release bot's own bump — ${SUBJECT}"
                exit 1
                ;;
        esac
        ;;
esac

echo "release: ${SUBJECT:-<no commit subject>}"
exit 0
