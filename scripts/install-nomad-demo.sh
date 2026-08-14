#!/bin/bash
#
# Project Nomad — Demo Installer (SAN + Docker, headless)
#
# Replicates the main installer's SAN + Docker + all-defaults flow
# (install_nomad_setup.sh main()/install_all_docker()), with these changes:
#   - Non-interactive (no prompts)
#   - Pins Nomad to a specific release tag (positional arg)
#   - Dataset install is idempotent (skipped if .dataset_source marker is current)
#   - Does NOT start the stack (installer installs, does not instantiate)
#
# Usage:
#   ./install.sh --demo v0.10.0 [--dry-run]
#   ./scripts/install-nomad-demo.sh v0.10.0 [--dry-run]
#
# Values not set by this installer (OAuth creds, splash config, BETTER_AUTH_*,
# etc.) are preserved as a side effect of `update_env_value` only touching
# keys the main installer explicitly writes — same behaviour as main.
#

set -e

# ---- Parse args --------------------------------------------------------
NOMAD_VERSION=""
DRY_RUN=false
while [[ $# -gt 0 ]]; do
    case "$1" in
        --dry-run) DRY_RUN=true; shift ;;
        -h|--help)
            cat <<USAGE
Usage: $0 <nomad-version-tag> [--dry-run]

  <nomad-version-tag>   Required. Git tag to pin Nomad to (e.g., v0.10.0).
  --dry-run             Show what would be done without making changes.
USAGE
            exit 0 ;;
        -*) echo "Unknown option: $1" >&2; exit 2 ;;
        *)
            if [ -z "$NOMAD_VERSION" ]; then NOMAD_VERSION="$1"; else
                echo "Unexpected argument: $1" >&2; exit 2
            fi
            shift ;;
    esac
done
[ -n "$NOMAD_VERSION" ] || { echo "Usage: $0 <nomad-version-tag> [--dry-run]" >&2; exit 2; }

# ---- Paths -------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$PROJECT_DIR/.env"
ENV_EXAMPLE="$PROJECT_DIR/.env.example"

# ---- Same FireSTARR image defaults as the main installer ---------------
# Docker default is pinned by digest to a verified-working build (v0.9.11,
# revision 7070574b46). FireSTARR v0.9.12-alpha-2 introduced an x/y
# transpose regression — see https://github.com/CWFMF/firestarr-cpp/issues/17.
# Keep these in sync with scripts/install_nomad_setup.sh.
FIRESTARR_REGISTRY="ghcr.io/cwfmf/firestarr-cpp"
FIRESTARR_IMAGE_NAME="firestarr"
FIRESTARR_IMAGE_TAG="${FIRESTARR_IMAGE_TAG:-main-latest}"
FIRESTARR_IMAGE_TAG_ARM64="${FIRESTARR_IMAGE_TAG_ARM64:-main-latest}"

# Build a fully-qualified image reference. Treats values starting with
# "sha256:" as digest pins (uses "@") and everything else as tags (uses ":").
firestarr_image_ref() {
    local ref="$1"
    if [[ "$ref" == sha256:* ]]; then
        echo "${FIRESTARR_REGISTRY}/${FIRESTARR_IMAGE_NAME}@${ref}"
    else
        echo "${FIRESTARR_REGISTRY}/${FIRESTARR_IMAGE_NAME}:${ref}"
    fi
}

# ---- Printing ----------------------------------------------------------
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; MAGENTA='\033[0;35m'; NC='\033[0m'
hr()    { echo -e "${CYAN}══════════════════════════════════════════════════════════════${NC}"; }
step()  { echo -e "${GREEN}▶${NC} $1"; }
info()  { echo -e "${CYAN}ℹ${NC} $1"; }
warn()  { echo -e "${YELLOW}⚠${NC} $1"; }
ok()    { echo -e "${GREEN}✔${NC} $1"; }
fail()  { echo -e "${RED}✖${NC} $1" >&2; exit 1; }
dry()   { echo -e "${MAGENTA}[DRY RUN]${NC} $1"; }
run_cmd() { if [ "$DRY_RUN" = true ]; then dry "Would run: $*"; else "$@"; fi; }

hr
echo -e "  ${CYAN}Project Nomad — Demo Installer${NC}"
echo -e "  Nomad: ${GREEN}$NOMAD_VERSION${NC}    Mode: ${GREEN}SAN${NC}+${GREEN}Docker${NC}    Dry-run: ${DRY_RUN}"
hr

# ---- Step 0: installer prerequisites (mirrors check_installer_prerequisites)
step "Checking installer prerequisites (git, curl, tar, unzip)"
missing=()
for t in git curl tar unzip; do command -v "$t" >/dev/null 2>&1 || missing+=("$t"); done
[ ${#missing[@]} -eq 0 ] || fail "missing prerequisites: ${missing[*]}"
ok "ok"

# ---- Step 1: cd + source existing .env (mirrors main()) ---------------
cd "$PROJECT_DIR"
if [ -f "$ENV_FILE" ]; then
    set -a; source "$ENV_FILE"; set +a
    info ".env sourced (existing values will be honoured as installer defaults)"
fi

# ---- Step 2: pin Nomad to the requested tag (the demo-specific bit) ---
step "Pin Nomad to $NOMAD_VERSION"
run_cmd git fetch --tags origin >/dev/null
git rev-parse --verify "$NOMAD_VERSION" >/dev/null 2>&1 \
    || fail "tag $NOMAD_VERSION not found on origin"
current_tag=$(git describe --tags --exact-match 2>/dev/null || echo "")
if [ "$current_tag" = "$NOMAD_VERSION" ]; then
    info "already on $NOMAD_VERSION"
else
    run_cmd git checkout "$NOMAD_VERSION"
    ok "checked out $NOMAD_VERSION"
fi

# ---- Step 3: set deployment + infra (mirrors step1/step2) -------------
NOMAD_DEPLOYMENT_MODE="SAN"
NOMAD_INFRA="docker"
FIRESTARR_INFRA="docker"
FIRESTARR_EXECUTION_MODE="docker"

# ---- Step 4: paths + ports + hostname (mirrors step3 defaults) --------
# All env-or-default, identical to what the menu installer's prompts use.
FIRESTARR_DOWNLOAD_DIR="${FIRESTARR_DOWNLOAD_DIR:-$HOME/Downloads}"
FIRESTARR_DATASET_PATH="${FIRESTARR_DATASET_PATH:-$HOME/firestarr_data}"
SIMS_OUTPUT_PATH="$FIRESTARR_DATASET_PATH/sims"
NOMAD_DATA_PATH="${NOMAD_DATA_PATH:-$FIRESTARR_DATASET_PATH}"
NOMAD_FRONTEND_HOST_PORT="${NOMAD_FRONTEND_HOST_PORT:-3901}"
NOMAD_BACKEND_HOST_PORT="${NOMAD_BACKEND_HOST_PORT:-4901}"
NOMAD_SERVER_HOSTNAME="${NOMAD_SERVER_HOSTNAME:-$(hostname -f 2>/dev/null || hostname 2>/dev/null || echo localhost)}"
# IANA zone used to stamp local timestamps in the usage log. REQUIRED by the
# backend - it will not start without it. The demo install is non-interactive,
# so this comes from the environment or falls back to Mountain time.
NOMAD_HOME_TIMEZONE="${NOMAD_HOME_TIMEZONE:-America/Edmonton}"
DATASET_INSTALL_MODE="download"

info "FIRESTARR_DATASET_PATH = $FIRESTARR_DATASET_PATH"
info "NOMAD_DATA_PATH        = $NOMAD_DATA_PATH"
info "NOMAD_FRONTEND_HOST_PORT = $NOMAD_FRONTEND_HOST_PORT"
info "NOMAD_BACKEND_HOST_PORT  = $NOMAD_BACKEND_HOST_PORT"
info "NOMAD_SERVER_HOSTNAME    = $NOMAD_SERVER_HOSTNAME"

# ---- Step 5: validate prerequisites (docker only) ---------------------
step "Validating docker prerequisites"
command -v docker >/dev/null      || fail "docker not on PATH"
docker compose version >/dev/null || fail "docker compose v2 required"
ok "docker + compose ok"

# ---- Step 6: resolve FIRESTARR_IMAGE (mirrors detect_architecture +
# configure_firestarr_image, accepting the recommended/option-1 choice
# non-interactively)
step "Resolve FireSTARR image (matches main installer's recommended)"
arch=$(uname -m)
if [ -f /proc/cpuinfo ] && grep -qE '\bavx2\b' /proc/cpuinfo; then HAS_AVX2=true; HAS_AVX=true
elif [ -f /proc/cpuinfo ] && grep -qE '\bavx\b' /proc/cpuinfo; then HAS_AVX2=false; HAS_AVX=true
else HAS_AVX2=false; HAS_AVX=false
fi
case "$arch" in
    arm64|aarch64) FIRESTARR_IMAGE="$(firestarr_image_ref "$FIRESTARR_IMAGE_TAG_ARM64")" ;;
    x86_64)
        [ "$HAS_AVX" = true ] || fail "CPU lacks AVX — FireSTARR cannot run"
        FIRESTARR_IMAGE="$(firestarr_image_ref "$FIRESTARR_IMAGE_TAG")" ;;
    *) FIRESTARR_IMAGE="$(firestarr_image_ref "$FIRESTARR_IMAGE_TAG")" ;;
esac
ok "FIRESTARR_IMAGE = $FIRESTARR_IMAGE"

# ---- Step 7: generate_env_file (line-for-line equivalent) -------------
step "Writing .env (in place, preserves unrelated keys)"

update_env_value() {
    local key="$1" value="$2"
    if [ "$DRY_RUN" = true ]; then dry "Would set $key=$value"; return 0; fi
    if grep -q "^${key}=" "$ENV_FILE" 2>/dev/null; then
        sed -i "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
    elif grep -q "^#.*${key}=" "$ENV_FILE" 2>/dev/null; then
        sed -i "s|^#.*${key}=.*|${key}=${value}|" "$ENV_FILE"
    else
        echo "${key}=${value}" >> "$ENV_FILE"
    fi
}

# Backup .env (same convention as main installer)
if [ -f "$ENV_FILE" ]; then
    if [ "$DRY_RUN" = true ]; then dry "Would back up $ENV_FILE"; else
        cp "$ENV_FILE" "$ENV_FILE.backup.$(date +%Y%m%d_%H%M%S)"
        info "backed up .env"
    fi
elif [ -f "$ENV_EXAMPLE" ]; then
    if [ "$DRY_RUN" = true ]; then dry "Would seed .env from .env.example"; else
        cp "$ENV_EXAMPLE" "$ENV_FILE"
        info "seeded .env from .env.example"
    fi
else
    [ "$DRY_RUN" = true ] && dry "Would touch empty .env" || touch "$ENV_FILE"
fi

update_env_value "NOMAD_DEPLOYMENT_MODE"    "$NOMAD_DEPLOYMENT_MODE"
update_env_value "FIRESTARR_DATASET_PATH"   "$FIRESTARR_DATASET_PATH"
update_env_value "FIRESTARR_EXECUTION_MODE" "$FIRESTARR_EXECUTION_MODE"
update_env_value "NOMAD_DATA_PATH"          "$NOMAD_DATA_PATH"
update_env_value "NOMAD_FRONTEND_HOST_PORT" "$NOMAD_FRONTEND_HOST_PORT"
update_env_value "NOMAD_BACKEND_HOST_PORT"  "$NOMAD_BACKEND_HOST_PORT"
update_env_value "NOMAD_SERVER_HOSTNAME"    "$NOMAD_SERVER_HOSTNAME"
update_env_value "NOMAD_HOME_TIMEZONE"      "$NOMAD_HOME_TIMEZONE"
update_env_value "NOMAD_USAGE_LOG_PATH"     "/appl/data/usage/usage.jsonl"
update_env_value "NOMAD_USAGE_LOG_MAX_BYTES" "52428800"
update_env_value "VITE_API_BASE_URL"        "http://${NOMAD_SERVER_HOSTNAME}:${NOMAD_BACKEND_HOST_PORT}"
update_env_value "VITE_API_PORT"            "$NOMAD_BACKEND_HOST_PORT"
update_env_value "FIRESTARR_IMAGE"          "$FIRESTARR_IMAGE"

# ---- Step 8: dataset install (idempotent via marker) ------------------
MARKER="$FIRESTARR_DATASET_PATH/.dataset_source"
# Prefer the year-picker index (the .env.example default since #322); fall back
# to a single fixed source if an operator has configured one instead. The
# marker only needs to be a stable identity for "what is installed".
SRC=$(grep -E '^FIRESTARR_DATASET_INDEX=' "$ENV_EXAMPLE" | head -1 | sed -E 's|^FIRESTARR_DATASET_INDEX=||')
[ -n "$SRC" ] || SRC=$(grep -E '^FIRESTARR_DATASET_SOURCE=' "$ENV_EXAMPLE" | head -1 | sed -E 's|^FIRESTARR_DATASET_SOURCE=||')
[ -n "$SRC" ] || fail "no FIRESTARR_DATASET_INDEX or FIRESTARR_DATASET_SOURCE in .env.example"

step "FireSTARR dataset (idempotent)"
need_dl=false
if [ ! -f "$MARKER" ]; then info "no marker — will install"; need_dl=true
elif [ "$(cat "$MARKER")" != "$SRC" ]; then info "marker differs from .env.example — will refresh"; need_dl=true
else info "marker matches current source — skipping"
fi

if [ "$need_dl" = true ]; then
    [ -x "$SCRIPT_DIR/install-firestarr-dataset.sh" ] \
        || fail "$SCRIPT_DIR/install-firestarr-dataset.sh missing"
    export FIRESTARR_DOWNLOAD_DIR
    run_cmd bash "$SCRIPT_DIR/install-firestarr-dataset.sh"
    if [ "$DRY_RUN" = false ]; then
        mkdir -p "$FIRESTARR_DATASET_PATH"
        printf '%s\n' "$SRC" > "$MARKER"
        ok "marker written: $MARKER"
    fi
fi

# ---- Step 9: ensure sims dir is writable (mirrors ensure_sims_writable)
step "Ensuring sims dir is writable"
if [ "$DRY_RUN" = true ]; then
    dry "Would mkdir -p $SIMS_OUTPUT_PATH && chmod 755"
else
    mkdir -p "$SIMS_OUTPUT_PATH"
    chmod 755 "$SIMS_OUTPUT_PATH"
    ok "$SIMS_OUTPUT_PATH"
fi

# ---- Step 10: build/pull docker images (mirrors install_all_docker §6)
step "docker compose build + pull firestarr-app"
run_cmd docker compose -f "$PROJECT_DIR/docker-compose.yaml" build
run_cmd docker compose -f "$PROJECT_DIR/docker-compose.yaml" pull firestarr-app

# ---- Done -------------------------------------------------------------
hr
ok "Demo install complete — stack NOT started"
echo "  Nomad version:           $NOMAD_VERSION"
echo "  FireSTARR image:         $FIRESTARR_IMAGE"
echo "  FireSTARR dataset path:  $FIRESTARR_DATASET_PATH"
echo "  NOMAD_DATA_PATH:         $NOMAD_DATA_PATH"
echo "  Frontend host port:      $NOMAD_FRONTEND_HOST_PORT"
echo "  Backend  host port:      $NOMAD_BACKEND_HOST_PORT"
echo "  Server hostname:         $NOMAD_SERVER_HOSTNAME"
echo
echo "To start: cd $PROJECT_DIR && docker compose up -d"
hr
