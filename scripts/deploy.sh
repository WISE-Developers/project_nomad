#!/usr/bin/env bash
#
# Deploy Project Nomad to a server from git.
#
#   ./scripts/deploy.sh              # pull main, rebuild, recreate, verify
#   ./scripts/deploy.sh --dry-run    # show what would happen
#   ./scripts/deploy.sh --branch dev
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

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=true; shift ;;
    --branch)  BRANCH="${2:?--branch needs a value}"; shift 2 ;;
    --service) SERVICE="${2:?--service needs a value}"; shift 2 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'; BLUE='\033[0;34m'; NC='\033[0m'
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

main() {
    refuse_root || exit 1

    local root owner
    root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
    owner="$(id -un)"
    cd "$root"

    print_info "Deploying $root from origin/$BRANCH as $owner"
    [ "$DRY_RUN" = true ] && print_info "DRY RUN — nothing will change"

    repair_ownership "$root" "$owner"

    # Keep a dated copy of the operator's config before anything moves.
    if [ -f .env ] && [ "$DRY_RUN" != true ]; then
        cp .env ".env.bak-$(date +%Y%m%d-%H%M%S)-pre-deploy"
        print_success "Backed up .env"
    fi

    local before after
    before="$(git rev-parse --short HEAD)"

    if [ "$DRY_RUN" = true ]; then
        print_info "[dry-run] would: git pull --ff-only origin $BRANCH"
        git fetch -q origin "$BRANCH"
        print_info "would move $before -> $(git rev-parse --short "origin/$BRANCH")"
        return 0
    fi

    git pull --ff-only origin "$BRANCH"
    after="$(git rev-parse --short HEAD)"
    print_success "Checkout $before -> $after"

    # Tag the image we are replacing so rollback is one command.
    local running version
    running="$(docker inspect "$SERVICE" --format '{{.Image}}' 2>/dev/null || true)"
    version="$(grep -m1 '"version"' frontend/package.json | sed 's/.*: *"\([^"]*\)".*/\1/')"
    if [ -n "$running" ]; then
        docker tag "$running" "$(docker inspect "$SERVICE" --format '{{.Config.Image}}'):rollback-$version" 2>/dev/null \
          && print_success "Previous image tagged rollback-$version"
    fi

    print_info "Building $SERVICE (current container keeps serving)"
    docker compose build "$SERVICE"

    print_info "Recreating $SERVICE only"
    docker compose up -d "$SERVICE"

    sleep 10
    local reported
    reported="$(curl -fsS "localhost:${NOMAD_FRONTEND_HOST_PORT:-3001}/api/v1/info" 2>/dev/null | grep -oE '"version":"[^"]+"' || true)"
    if [ -n "$reported" ]; then
        print_success "Deployed: $reported"
    else
        print_warning "Could not read /api/v1/info — check 'docker logs $SERVICE'"
    fi
}

main "$@"
