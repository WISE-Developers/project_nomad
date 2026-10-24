#!/usr/bin/env bash
#
# Deploy Project Nomad to a server from git.
#
#   ./scripts/deploy.sh              # pull main, pull the image, recreate, verify
#   ./scripts/deploy.sh --dry-run    # show what would happen
#   ./scripts/deploy.sh --branch dev
#   ./scripts/deploy.sh --build-local  # build the image here (offline installs)
#
# WHY THIS EXISTS
#
# The CIFFC demo broke mid-deploy on 2026-08-20. 507 files under /opt/nomad-app,
# including .git internals, were owned by root while the repo and the app run as
# `nomad`. git updated what it could, hit "Permission denied", and left the
# working tree half-applied with HEAD unmoved — package.json said 0.17.0 while
# HEAD was still 0.13.0. Nothing automated does the deploying; someone had run
# `sudo git pull` by hand, and root-owned files were left behind for the next
# person to trip over.
#
# So this refuses to run as root, and repairs ownership drift before touching
# git rather than discovering it half way through a checkout.
set -euo pipefail

BRANCH="main"
DRY_RUN=false
SERVICE="nomad"

# #465. The image is built by CI and pulled here. An offline or air-gapped
# install genuinely needs a local build, so that stays available — but as a
# mode the operator ASKS for, never as something this script falls back to.
# A fallback would leave every deploy working while the published image went
# silently unused, which is the failure this change exists to remove.
BUILD_LOCAL=false
APP_IMAGE_REPO="ghcr.io/wise-developers/project_nomad/nomad"

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=true; shift ;;
    --build-local) BUILD_LOCAL=true; shift ;;
    --branch)  BRANCH="${2:?--branch needs a value}"; shift 2 ;;
    --service) SERVICE="${2:?--service needs a value}"; shift 2 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'; BLUE='\033[0;34m'; NC='\033[0m'
# Absolute path to this script, resolved once. Used to re-exec the pulled
# version of ourselves — see the re-exec block in main().
SCRIPT_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"

print_error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; }
print_warning() { echo -e "${YELLOW}[WARN]${NC} $*"; }
print_info()    { echo -e "${BLUE}[INFO]${NC} $*"; }
print_success() { echo -e "${GREEN}[OK]${NC} $*"; }

refuse_root() {
    # Deploying as root is what created the mess this script exists to prevent:
    # every file git writes ends up root-owned, and the next deploy — run as the
    # service user — cannot update them.
    #
    # Takes the uid as an argument so it can be tested; EUID is readonly in bash.
    local uid="${1:-${EUID:-$(id -u)}}"
    if [ "$uid" -eq 0 ]; then
        print_error "Do not deploy as root."
        print_error "Run this as the user that owns the checkout and runs the app."
        print_error "Deploying as root leaves root-owned files behind and breaks the NEXT deploy."
        return 1
    fi
    return 0
}

owner_drift_count() {
    # How many paths under $1 are NOT owned by $2. Cheap to run, and the answer
    # is the whole diagnosis when a checkout starts failing with EACCES.
    local dir="$1" owner="$2"
    [ -d "$dir" ] || { echo 0; return 0; }
    find "$dir" -path "$dir/node_modules" -prune -o ! -user "$owner" -print 2>/dev/null | wc -l | tr -d ' '
}

probe_docker_chain() {
    # Is Docker's DOCKER iptables chain present?
    #
    # CSF deletes it (along with DOCKER-USER and DOCKER-INTERNAL) every time it
    # restores its saved ruleset. Docker creates those chains at DAEMON startup,
    # so CSF's restore never brings them back.
    #
    # Nothing appears to break. A container published on 127.0.0.1 is served by
    # docker-proxy in userspace and never traverses the chain, so the CIFFC demo
    # kept serving for a full day with the chains gone. The fault surfaces only
    # when a container is STARTED -- which is what a deploy does, immediately
    # after tearing down the one that was working.
    #
    # $1 overrides the probe command (the tests inject one). Returns:
    #   0  chain present
    #   1  iptables answered and the chain is NOT there
    #   2  cannot be determined
    #
    # The third state is deliberate. A host with no iptables, or no sudo rights
    # to read it, must not have its deploys blocked -- a guard that fails closed
    # everywhere is worse than no guard. Only a definite absence aborts.
    local probe="${1:-}"

    if [ -n "$probe" ]; then
        command -v "${probe%% *}" >/dev/null 2>&1 || return 2
        $probe >/dev/null 2>&1 && return 0
        return 1
    fi

    local ipt
    for ipt in iptables-nft iptables; do
        command -v "$ipt" >/dev/null 2>&1 || continue
        sudo -n "$ipt" -t filter -L DOCKER -n >/dev/null 2>&1 && return 0
        # Distinguish "no such chain" from "cannot read iptables at all": if the
        # NAT table is readable, the tool and our rights are fine and the chain
        # really is gone.
        sudo -n "$ipt" -t filter -L -n >/dev/null 2>&1 && return 1
    done
    return 2
}

docker_chain_verdict() {
    # Turn a probe result into proceed (0) or abort (1). Refs #392.
    case "$1" in
        0)
            print_success "Docker iptables chain present"
            return 0
            ;;
        1)
            print_error "Docker's DOCKER iptables chain is missing. A deploy would"
            print_error "stop the running container and then FAIL to start its"
            print_error "replacement, taking the site down."
            print_error ""
            print_error "Rollback is not a way out: the previous image cannot start"
            print_error "either, for the same reason."
            print_error ""
            print_error "This host is almost certainly running CSF, which deletes"
            print_error "Docker's chains whenever it restores its ruleset. Fix:"
            print_error "  sudo systemctl restart docker"
            print_error "and to stop it recurring, see"
            print_error "  Documentation/Nomad/deploying-behind-csf.md"
            return 1
            ;;
        *)
            print_warning "Could not determine whether Docker's iptables chain exists."
            print_warning "Proceeding. If the new container fails to start, see"
            print_warning "Documentation/Nomad/deploying-behind-csf.md"
            return 0
            ;;
    esac
}

repair_ownership() {
    local dir="$1" owner="$2" drift
    drift="$(owner_drift_count "$dir" "$owner")"

    if [ "$drift" -eq 0 ]; then
        print_success "Ownership is clean ($owner owns everything under $dir)"
        return 0
    fi

    print_warning "$drift path(s) under $dir are not owned by $owner."
    print_warning "That is what half-applies a git pull. Repairing before we touch git."

    if [ "$DRY_RUN" = true ]; then
        print_info "[dry-run] would: sudo chown -R $owner:$owner $dir"
        return 0
    fi

    sudo chown -R "$owner":"$owner" "$dir"
    print_success "Ownership repaired ($drift path(s))"
}

# The host port the app is actually published on, read from .env.
#
# THIS IS WHERE THE HEALTH CHECK KEPT FAILING. deploy.sh never sources .env, so
# NOMAD_FRONTEND_HOST_PORT was UNSET in the script and
# "${NOMAD_FRONTEND_HOST_PORT:-3001}" fell back to 3001 — a port nothing listens
# on when the app is published on 53000, as it is on the CIFFC demo. Every
# deploy curled a closed port and warned, on an app that was serving correctly.
#
# Two earlier explanations were wrong: a slow boot (the backend comes up in
# under four seconds) and the bind spec being mis-interpolated (true in shape,
# but the value never reached the function because it was not in scope).
#
# Reads the single key rather than sourcing the whole file: .env is operator
# config, and sourcing it would execute whatever is in it.
#
# Prints the value and returns 0, or prints nothing and returns 1 when .env does
# not define it. The caller must then SAY the check could not run — defaulting
# to a guessed port is the defect this replaces.
outgoing_image_version() {
    # The version an image CONTAINS, read from /app/VERSION inside it (#437).
    #
    # --entrypoint cat runs no part of the application: the container starts,
    # cats one file and exits. That is deliberate on a production host — the
    # outgoing image is a known-good build, but starting it for real alongside
    # its replacement is not something a deploy should do.
    #
    # Returns non-zero and prints NOTHING when the version cannot be read, so a
    # caller cannot mistake an error for a version. An image predating
    # /app/VERSION answers with an empty file rather than an error, which is
    # equally not a version and is treated the same way.
    local image="$1" raw
    raw="$(docker run --rm --entrypoint cat "$image" /app/VERSION 2>/dev/null || true)"
    raw="$(printf '%s' "$raw" | tr -d '\r\n' | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
    [ -n "$raw" ] || return 1
    printf '%s\n' "$raw"
}

frontend_host_port() {
    local env_file="${1:-.env}"
    [ -f "$env_file" ] || return 1
    local line
    line="$(grep -m1 '^[[:space:]]*NOMAD_FRONTEND_HOST_PORT=' "$env_file" 2>/dev/null)" || return 1
    [ -n "$line" ] || return 1
    local value="${line#*=}"
    # Strip surrounding quotes and trailing whitespace/CR, which .env files pick
    # up from editors and from being written on other platforms.
    value="${value%\"}"; value="${value#\"}"
    value="${value%\'}"; value="${value#\'}"
    value="$(printf '%s' "$value" | tr -d '\r' | sed 's/[[:space:]]*$//')"
    [ -n "$value" ] || return 1
    printf '%s' "$value"
}

# Wait for the backend to answer, rather than asking once and giving up.
#
# This used to be `sleep 10` plus a single curl. Every healthy deploy of the
# CIFFC demo ended on "Could not read /api/v1/info" because the backend was
# still running migrations and answered about twenty seconds in. A warning that
# fires on every successful deploy trains whoever is deploying to ignore it,
# and makes a real failure indistinguishable from a slow boot.
#
# Bounded on purpose: it must still FAIL for a backend that never comes up,
# otherwise the check is decorative. Prints the matched version and returns 0,
# or prints nothing and returns 1.
await_version() {
    local spec="${1:-3001}" budget="${2:-90}"
    local waited=0 reported=""

    # NOMAD_FRONTEND_HOST_PORT is a compose BIND SPEC, not a port. On the CIFFC
    # demo it is "127.0.0.1:53000", and interpolating that straight into a URL
    # produced "localhost:127.0.0.1:53000/api/v1/info" -- unresolvable, so every
    # healthy deploy warned. The backend is up in under four seconds; it was
    # never slow, the address was wrong. Take the port after the last colon,
    # which handles "53000", "127.0.0.1:53000" and an IPv6 host alike.
    local port="${spec##*:}"
    while [ "$waited" -lt "$budget" ]; do
        # sed, not `grep -o`: grep prints the WHOLE match and has no capture
        # group, so this returned the JSON fragment `"version":"0.36.0"` rather
        # than `0.36.0`. Invisible for as long as it only reached the log line
        # below -- then #460 passed it to a step that named FILES with it, and
        # the v0.36.0 deploy wrote `nomad-image-"version":"0.36.0".spdx.json`
        # (#469). That step is gone (#465); the lesson is not, and the same
        # capture-group pattern reads the version for the image pull below.
        reported="$(curl -fsS "localhost:${port}/api/v1/info" 2>/dev/null | sed -n 's/.*"version":"\([^"]*\)".*/\1/p' || true)"
        if [ -n "$reported" ]; then
            printf '%s' "$reported"
            return 0
        fi
        sleep 3
        waited=$((waited + 3))
    done
    return 1
}

main() {
    refuse_root || exit 1

    local root owner
    root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
    owner="$(id -un)"
    cd "$root"

    print_info "Deploying $root from origin/$BRANCH as $owner"
    [ "$DRY_RUN" = true ] && print_info "DRY RUN — nothing will change"

    # Before anything is torn down. A deploy that stops the running container
    # and then cannot start its replacement is strictly worse than a deploy
    # that refuses to begin. Refs #392.
    local chain_state=0
    probe_docker_chain || chain_state=$?
    docker_chain_verdict "$chain_state" || exit 1

    repair_ownership "$root" "$owner"

    # Keep a dated copy of the operator's config before anything moves.
    if [ -f .env ] && [ "$DRY_RUN" != true ]; then
        cp .env ".env.bak-$(date +%Y%m%d-%H%M%S)-pre-deploy"
        print_success "Backed up .env"
    fi

    local before after
    before="$(git rev-parse --short HEAD)"
    # Hash of this script BEFORE the pull, so we can tell whether the pull
    # changed the thing currently executing.
    local script_sha_before
    script_sha_before="$(shasum "$SCRIPT_PATH" 2>/dev/null | awk '{print $1}')"

    if [ "$DRY_RUN" = true ]; then
        print_info "[dry-run] would: git pull --ff-only origin $BRANCH"
        git fetch -q origin "$BRANCH"
        print_info "would move $before -> $(git rev-parse --short "origin/$BRANCH")"
        return 0
    fi

    git pull --ff-only origin "$BRANCH"
    after="$(git rev-parse --short HEAD)"
    print_success "Checkout $before -> $after"

    # Run the version of this script we just pulled, not the one already in
    # memory.
    #
    # A shell reads a script as it executes it, so everything below this line
    # still comes from the copy that was on disk when the deploy STARTED. Any
    # change to deploy.sh would otherwise take effect on the next deploy rather
    # than the one delivering it — and worse, a deploy could run half of one
    # version and half of another.
    #
    # The v0.23.0 deploy is the reason this exists: it shipped a fix to the
    # health check and still printed the old failure, because the running shell
    # was the v0.22.0 copy. It looked exactly like a fix that had not worked.
    #
    # Only when the script actually changed, so an ordinary deploy does not
    # repeat its git and docker work. Guarded and EXPORTED so the re-executed
    # copy knows not to do it again — an unguarded re-exec is a fork bomb
    # against a production host. Arguments pass through, or --dry-run would
    # quietly become a real deploy.
    local script_sha_after
    script_sha_after="$(shasum "$SCRIPT_PATH" 2>/dev/null | awk '{print $1}')"
    if [ -z "$script_sha_before" ] || [ -z "$script_sha_after" ]; then
        # Say so rather than skipping quietly. A self-update check that cannot
        # run is worth one line of output; silently disabling it would leave the
        # next person debugging the same "my fix did nothing" confusion with no
        # hint that the mechanism was never active.
        print_warning "Could not hash deploy.sh — self-update check skipped; a change to this script applies next deploy"
    elif [ "${NOMAD_DEPLOY_REEXEC:-}" != "1" ] \
       && [ "$script_sha_before" != "$script_sha_after" ]; then
        print_info "deploy.sh changed in this pull — re-running the new version"
        export NOMAD_DEPLOY_REEXEC=1
        exec "$SCRIPT_PATH" "$@"
    fi

    # Tag the image we are replacing so rollback is one command.
    #
    # The tag names the version the OUTGOING image contains, read out of the
    # image itself — not the version being deployed to. See #437: this used the
    # incoming version from the freshly pulled frontend/package.json, so every
    # rollback-X on the demo held X-1. The rollback path worked; the name lied,
    # and it is read in an outage by whoever is on hand.
    local running outgoing rollback_tag
    running="$(docker inspect "$SERVICE" --format '{{.Image}}' 2>/dev/null || true)"
    if [ -n "$running" ]; then
        if outgoing="$(outgoing_image_version "$running")"; then
            rollback_tag="$(docker inspect "$SERVICE" --format '{{.Config.Image}}'):rollback-$outgoing"
            docker tag "$running" "$rollback_tag" 2>/dev/null \
              && print_success "Previous image tagged rollback-$outgoing (the version it contains)"
        else
            # Loud, and still tagged. Guessing the name would rebuild #437; but
            # dropping the tag in silence costs the rollback itself, which is
            # worse. The image id makes the name unique and obviously not a
            # version, so nobody reads it as one.
            rollback_tag="$(docker inspect "$SERVICE" --format '{{.Config.Image}}'):rollback-unknown-$(printf '%s' "${running#sha256:}" | cut -c1-12)"
            print_warning "Could not read /app/VERSION from the outgoing image — tagging $rollback_tag rather than guessing a version"
            docker tag "$running" "$rollback_tag" 2>/dev/null \
              && print_success "Previous image tagged ${rollback_tag##*:}"
        fi
    fi

    # #465. CI builds and publishes the image on release; this pulls the one
    # that matches the checkout, so the artefact that serves production is the
    # artefact CI tested. The version comes out of the tree we have just pulled,
    # not from a variable someone set once.
    if [ "$BUILD_LOCAL" = true ]; then
        print_info "Building $SERVICE locally (--build-local; current container keeps serving)"
        docker compose build "$SERVICE"
    else
        local app_version app_image
        # sed, not node: node runs in the container, not necessarily on the
        # host, and this script's only other version read uses exactly this
        # pattern. A capture group, not `grep -o` — that is #469, where the
        # whole match came back as `"version":"0.36.0"` and went on to name
        # files.
        app_version="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' package.json | head -1)"
        if [ -z "$app_version" ]; then
            # Loud. A floating tag here would deploy whatever :latest happens to
            # be, which is the "declared value is not a running value" trap: the
            # deploy would report success having shipped something nobody named.
            print_error "Could not read the version from package.json — refusing to deploy an unpinned image"
            print_info  "Use --build-local for an offline install."
            exit 1
        fi
        app_image="${NOMAD_APP_IMAGE:-${APP_IMAGE_REPO}:${app_version}}"

        # compose interpolates NOMAD_APP_IMAGE into the service's `image:` key,
        # so the pull and the recreate name the same thing and no tagging
        # sleight of hand is needed in between.
        export NOMAD_APP_IMAGE="$app_image"

        print_info "Pulling $app_image (current container keeps serving)"
        if ! docker compose pull "$SERVICE"; then
            # NO FALLBACK TO A BUILD. See the flag comment at the top: a build
            # reached from a failed pull leaves the deploy green and the
            # published image silently unused.
            print_error "Could not pull $app_image"
            print_info  "Check the release published an image, or deploy with --build-local for an offline install."
            exit 1
        fi
    fi

    print_info "Recreating $SERVICE only"
    docker compose up -d "$SERVICE"

    local reported host_port
    if ! host_port="$(frontend_host_port)"; then
        # Loud, not a guess. A default port is what made this check report
        # failure on every healthy deploy for as long as it has existed.
        print_warning "NOMAD_FRONTEND_HOST_PORT is not set in .env — cannot verify the deployed version"
    elif reported="$(await_version "$host_port" 90)"; then
        print_success "Deployed: $reported"
    else
        print_warning "No answer from /api/v1/info on port ${host_port##*:} after 90s — check 'docker logs $SERVICE'"
    fi

    # NO BILL OF MATERIALS IS PRODUCED HERE, and that is deliberate (#465).
    #
    # #441 put one at deploy time for a sound reason: CI had no image to
    # describe, so a document produced there would have described something
    # nobody ran. CI now publishes the image, so that reason is gone.
    #
    # The document serves its purpose BEFORE the thing is deployed, not after.
    # It is read when deciding whether to ship, and when answering "does the
    # version we run contain $CVE" — both away from the box, often by someone
    # who has deployed nothing. Producing it during a deploy put it in the one
    # place least useful to either question, and wrote ~28MB to a production
    # host per deployed version to duplicate something already published.
    #
    # Where it lives instead, beside the source it was built from:
    #   - the image's SPDX attestation in the registry:
    #       docker buildx imagetools inspect \
    #         ghcr.io/wise-developers/project_nomad/nomad:<version> \
    #         --format '{{ json .SBOM }}'
    #   - the npm bill attached to the GitHub Release (#398).
    #
    # This removed a class of defect rather than a step: #464 (the document had
    # never been produced, silently, for two months), #469 (the version arrived
    # as a JSON fragment and named the files), and the `|| true` that existed
    # only so a failing SBOM could not break a deploy. None can recur in a
    # deploy that produces no document.
}

main "$@"
