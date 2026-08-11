#!/bin/bash
#
# Project Nomad - SAN + Metal Headless Installer
# Quick install for SAN mode with Metal (native) infrastructure
#
# Usage:
#   curl -fsSL https://.../install-nomad-san-metal.sh | bash
#
# Optional Environment Variables (defaults shown):
#   INSTALL_DIR=./project_nomad       Where to extract Nomad
#   FIRESTARR_DATASET_PATH=~/firestarr_data   Dataset location
#   NOMAD_PORT=4901                   Server port
#   FIRESTARR_BINARY_PATH=            Auto-download if not set
#
# Example:
#   curl -fsSL ... | INSTALL_DIR=./my_nomad bash
#

set -e

INSTALLER_VERSION="1.0.0"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

print_header() {
    echo -e "${BLUE}"
    echo "╔════════════════════════════════════════════════════════════╗"
    echo "║   Project Nomad - SAN + Metal Installer v${INSTALLER_VERSION}          ║"
    echo "║              Headless / Non-Interactive Mode             ║"
    echo "╚════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

print_step() { echo -e "${GREEN}▶${NC} $1"; }
print_warning() { echo -e "${YELLOW}⚠${NC} $1"; }
print_error() { echo -e "${RED}✖${NC} $1"; }
print_success() { echo -e "${GREEN}✔${NC} $1"; }
print_info() { echo -e "${CYAN}ℹ${NC} $1"; }

# ============================================
# Configuration
# ============================================

# Set defaults
INSTALL_DIR="${INSTALL_DIR:-./project_nomad}"
FIRESTARR_DATASET_PATH="${FIRESTARR_DATASET_PATH:-$HOME/firestarr_data}"
FIRESTARR_DATASET_INDEX="${FIRESTARR_DATASET_INDEX:-https://fgmfiles.spyd.com/datasets/nomad/index.json}"
NOMAD_PORT="${NOMAD_PORT:-4901}"
NOMAD_SERVER_HOSTNAME="${NOMAD_SERVER_HOSTNAME:-localhost}"
NOMAD_DATA_PATH="${NOMAD_DATA_PATH:-$FIRESTARR_DATASET_PATH}"
SIMS_OUTPUT_PATH="${SIMS_OUTPUT_PATH:-$FIRESTARR_DATASET_PATH/sims}"

# Home time zone (#332)
#
# IANA zone used to stamp local timestamps in the usage log. The backend is
# fail-fast on this: it will not start if the key is missing or invalid, because
# the container's own clock is UTC and a fallback would record every local time
# silently wrong.
#
# An environment value pre-fills the answer; the operator can override it. With
# no tty the same default is taken silently, so a piped install cannot hang and
# cannot pick a different zone than an attended one would.
NOMAD_HOME_TIMEZONE="${NOMAD_HOME_TIMEZONE:-America/Edmonton}"

if [ -t 0 ]; then
    echo ""
    echo "  Home time zone"
    echo "  Usage log entries are stamped with local wall-clock time using this zone."
    echo "  Use an IANA zone name, e.g. America/Edmonton, America/Winnipeg, America/Toronto."
    read -p "  Time zone [$NOMAD_HOME_TIMEZONE]: " _tz_reply
    if [ -n "$_tz_reply" ]; then
        NOMAD_HOME_TIMEZONE="$_tz_reply"
    fi
fi

# Validate here, so a typo fails next to the mistake rather than at first boot.
case "$NOMAD_HOME_TIMEZONE" in
    [+-]*)
        echo "ERROR: NOMAD_HOME_TIMEZONE is \"$NOMAD_HOME_TIMEZONE\", a fixed UTC offset." >&2
        echo "       A fixed offset cannot observe DST. Use an IANA zone name," >&2
        echo "       for example America/Edmonton." >&2
        exit 1
        ;;
    */*) ;;
    *)
        echo "ERROR: NOMAD_HOME_TIMEZONE is \"$NOMAD_HOME_TIMEZONE\", which is not an" >&2
        echo "       IANA zone name. Expected Area/Location, for example America/Edmonton." >&2
        exit 1
        ;;
esac

# FireSTARR binary source
FIRESTARR_BINARY_RELEASE_REPO="https://github.com/CWFMF/firestarr-cpp/releases/download"
FIRESTARR_BINARY_RELEASE_TAG="${FIRESTARR_BINARY_RELEASE_TAG:-unstable-latest}"

# GitHub
REPO_OWNER="WISE-Developers"
REPO_NAME="project_nomad"
VERSION="${VERSION:-latest}"

# ============================================
# Prerequisites
# ============================================

check_prerequisites() {
    print_step "Checking prerequisites..."

    # Check Node.js
    if ! command -v node &> /dev/null; then
        print_error "Node.js is required but not installed"
        echo ""
        echo "    Install Node.js 22.x and re-run this installer:"
        echo ""
        echo "      curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -"
        echo "      sudo apt-get install -y nodejs"
        echo ""
        exit 1
    fi

    local node_major
    node_major=$(node -v 2>/dev/null | sed 's/v//' | cut -d. -f1)
    if [ "$node_major" -lt 20 ]; then
        print_error "Node.js version $(node -v) is too old (need >= 20)"
        echo ""
        echo "    Upgrade to Node.js 22.x and re-run this installer:"
        echo ""
        echo "      curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -"
        echo "      sudo apt-get install -y nodejs"
        echo ""
        exit 1
    fi
    print_success "Node.js $(node -v) available"

    # Check npm
    if ! command -v npm &> /dev/null; then
        print_error "npm is required but not installed"
        exit 1
    fi
    print_success "npm available"

    # Check GDAL
    if ! command -v gdalinfo &> /dev/null; then
        print_error "GDAL is required for Nomad backend"
        echo "Install: sudo apt-get install gdal-bin libgdal-dev"
        exit 1
    fi
    print_success "GDAL available"

    # Check sqlite3
    if ! command -v sqlite3 &> /dev/null; then
        print_warning "sqlite3 not found, will be needed for database"
    fi

    # glibc check (Linux only)
    if [[ "$OSTYPE" == "linux"* ]]; then
        local glibc_version
        glibc_version=$(ldd --version 2>/dev/null | head -1 | grep -oE '[0-9]+\.[0-9]+$')
        if [ -n "$glibc_version" ]; then
            local glibc_major glibc_minor
            glibc_major=$(echo "$glibc_version" | cut -d. -f1)
            glibc_minor=$(echo "$glibc_version" | cut -d. -f2)
            if [ "$glibc_major" -lt 2 ] || { [ "$glibc_major" -eq 2 ] && [ "$glibc_minor" -lt 34 ]; }; then
                print_error "glibc $glibc_version is too old (need >= 2.34)"
                exit 1
            fi
        fi
    fi

    print_success "Prerequisites satisfied"
}

# ============================================
# Download Nomad
# ============================================

get_latest_version() {
    local api_url="https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest"
    local response
    response=$(curl -fsSL "$api_url" 2>/dev/null || echo "")
    if [ -n "$response" ]; then
        VERSION=$(echo "$response" | grep -o '"tag_name": "[^"]*"' | head -1 | sed 's/.*: "\(.*\)".*/\1/')
    else
        print_error "Failed to fetch latest version from GitHub API"
        echo ""
        echo "This could be due to:"
        echo "  - Network connectivity issues"
        echo "  - GitHub API rate limiting"
        echo ""
        echo "To retry with explicit version:"
        echo "  curl ... | VERSION=v0.4.2 bash"
        exit 1
    fi

    if [ -z "$VERSION" ]; then
        print_error "Could not parse version from GitHub API response"
        exit 1
    fi
}

download_nomad() {
    if [ "$VERSION" = "latest" ]; then
        print_step "Detecting latest version..." >&2
        get_latest_version
    fi

    print_step "Downloading Nomad ${VERSION}..." >&2
    local tarball_url="https://github.com/${REPO_OWNER}/${REPO_NAME}/archive/refs/tags/${VERSION}.tar.gz"
    local temp_file
    temp_file=$(mktemp)

    if ! curl -fsSL "$tarball_url" -o "$temp_file"; then
        print_error "Failed to download Nomad ${VERSION}" >&2
        rm -f "$temp_file"
        exit 1
    fi

    echo "$temp_file"
}

extract_nomad() {
    local tarball="$1"
    print_step "Extracting to ${INSTALL_DIR}..."

    if [ -d "$INSTALL_DIR" ]; then
        print_warning "Directory exists: ${INSTALL_DIR}"
        rm -rf "${INSTALL_DIR}.backup"
        mv "$INSTALL_DIR" "${INSTALL_DIR}.backup"
        print_info "Backed up to ${INSTALL_DIR}.backup"
    fi

    mkdir -p "$INSTALL_DIR"
    local temp_extract
    temp_extract=$(mktemp -d)
    tar -xzf "$tarball" -C "$temp_extract"

    local extracted_dir
    extracted_dir=$(find "$temp_extract" -mindepth 1 -maxdepth 1 -type d | head -1)
    mv "${extracted_dir}"/* "$INSTALL_DIR/"
    rm -rf "$temp_extract"

    print_success "Extracted to ${INSTALL_DIR}"
}

# ============================================
# Generate .env
# ============================================

generate_env() {
    print_step "Generating configuration..."
    local env_file="${INSTALL_DIR}/.env"

    if [ -f "${INSTALL_DIR}/.env.example" ]; then
        cp "${INSTALL_DIR}/.env.example" "$env_file"
    else
        touch "$env_file"
    fi

    update_env() {
        local key="$1"
        local value="$2"
        if grep -q "^${key}=" "$env_file" 2>/dev/null; then
            if [[ "$OSTYPE" == "darwin"* ]]; then
                sed -i '' "s|^${key}=.*|${key}=${value}|" "$env_file"
            else
                sed -i "s|^${key}=.*|${key}=${value}|" "$env_file"
            fi
        elif grep -q "^#.*${key}=" "$env_file" 2>/dev/null; then
            if [[ "$OSTYPE" == "darwin"* ]]; then
                sed -i '' "s|^#.*${key}=.*|${key}=${value}|" "$env_file"
            else
                sed -i "s|^#.*${key}=.*|${key}=${value}|" "$env_file"
            fi
        else
            echo "${key}=${value}" >> "$env_file"
        fi
    }

    update_env "NOMAD_DEPLOYMENT_MODE" "SAN"
    update_env "NOMAD_HOME_TIMEZONE" "$NOMAD_HOME_TIMEZONE"
    update_env "FIRESTARR_DATASET_PATH" "$FIRESTARR_DATASET_PATH"
    # .env is built key-by-key here, not copied from .env.example, so the
    # example default never reaches it (see #322 regression).
    update_env "FIRESTARR_DATASET_INDEX" "$FIRESTARR_DATASET_INDEX"
    update_env "FIRESTARR_EXECUTION_MODE" "binary"
    update_env "NOMAD_DATA_PATH" "$NOMAD_DATA_PATH"
    update_env "PORT" "$NOMAD_PORT"
    update_env "VITE_API_PORT" "$NOMAD_PORT"
    update_env "VITE_API_BASE_URL" "http://${NOMAD_SERVER_HOSTNAME}:${NOMAD_PORT}"
    update_env "NOMAD_SERVER_HOSTNAME" "$NOMAD_SERVER_HOSTNAME"
    update_env "NOMAD_AUTH_MODE" "simple"
    update_env "VITE_AUTH_MODE" "simple"

    # --- Crash & error reporting consent (Sentry, #313) ---
    # OFF by default. Opt in via NOMAD_ERROR_REPORTING=true (non-interactive) or
    # the prompt below. On opt-in we inject CIFFC's Sentry DSNs (frontend build
    # bakes VITE_SENTRY_DSN; backend reads SENTRY_DSN). No DSN => never phones home.
    local sentry_front="https://1260ee8a9108d645b99331926186fe9b@o4511356192751616.ingest.us.sentry.io/4511570358894592"
    local sentry_back="https://ae5f37e92bcaa761abe6f8856708684c@o4511356192751616.ingest.us.sentry.io/4511808188907520"
    local sentry_optin="no"
    if [ -n "$NOMAD_ERROR_REPORTING" ]; then
        case "$(printf '%s' "$NOMAD_ERROR_REPORTING" | tr '[:upper:]' '[:lower:]')" in
            true|yes|y|1) sentry_optin="yes" ;;
        esac
    elif [ -t 0 ]; then
        echo ""
        echo "  Nomad can report crashes and errors to the development team to help"
        echo "  fix bugs. Reports are scrubbed of personal data. Optional; off by default."
        read -p "  Allow Nomad to report crashes and errors? [y/N] " -n 1 -r
        echo ""
        [[ "$REPLY" =~ ^[Yy]$ ]] && sentry_optin="yes"
    fi
    # Set VITE_SENTRY_DSN first: once uncommented it no longer matches the
    # SENTRY_DSN substring pattern, so the next call can't clobber it.
    if [ "$sentry_optin" = "yes" ]; then
        update_env "VITE_SENTRY_DSN" "$sentry_front"
        update_env "SENTRY_DSN" "$sentry_back"
        print_success "Crash & error reporting enabled"
    else
        update_env "VITE_SENTRY_DSN" ""
        update_env "SENTRY_DSN" ""
        echo "  Crash & error reporting disabled (no data will be sent)"
    fi

    # Set FireSTARR binary path if provided or will be auto-installed
    if [ -n "$FIRESTARR_BINARY_PATH" ]; then
        update_env "FIRESTARR_BINARY_PATH" "$FIRESTARR_BINARY_PATH"
    fi

    print_success "Configuration saved"
}

# ============================================
# FireSTARR Dataset
# ============================================

check_dataset() {
    print_step "Checking FireSTARR dataset..."

    if [ -d "$FIRESTARR_DATASET_PATH/generated/grid" ]; then
        print_success "Dataset found"
        return 0
    fi

    print_warning "Dataset not found at ${FIRESTARR_DATASET_PATH}"
    if [ -z "$AUTO_INSTALL_DATASET" ]; then
        echo ""
        echo "To auto-download, run with AUTO_INSTALL_DATASET=1"
        echo "Or download later: cd ${INSTALL_DIR} && ./scripts/install-firestarr-dataset.sh"
    else
        print_step "Auto-downloading dataset..."
        cd "$INSTALL_DIR"
        bash scripts/install-firestarr-dataset.sh
    fi
}

# ============================================
# FireSTARR Binary
# ============================================

get_platform_asset() {
    local arch
    arch=$(uname -m)
    local os_name
    os_name=$(uname -s | tr '[:upper:]' '[:lower:]')

    case "$os_name" in
        darwin)
            echo "firestarr-macos-arm64-clang-Release.tar.gz"
            ;;
        linux)
            echo "firestarr-ubuntu-x64-gcc-Release.tar.gz"
            ;;
        *)
            echo ""
            ;;
    esac
}

install_firestarr_binary() {
    if [ -n "$FIRESTARR_BINARY_PATH" ] && [ -x "$FIRESTARR_BINARY_PATH" ]; then
        print_success "Using existing FireSTARR: $FIRESTARR_BINARY_PATH"
        return 0
    fi

    print_step "Installing FireSTARR binary..."

    local asset_name
    asset_name=$(get_platform_asset)
    if [ -z "$asset_name" ]; then
        print_error "Unsupported platform for auto-install"
        echo "Please set FIRESTARR_BINARY_PATH manually"
        exit 1
    fi

    local download_url="${FIRESTARR_BINARY_RELEASE_REPO}/${FIRESTARR_BINARY_RELEASE_TAG}/${asset_name}"
    local install_dir="${INSTALL_DIR}/firestarr"
    local temp_file
    temp_file=$(mktemp)

    print_info "Downloading from: $download_url"
    if ! curl -fsSL "$download_url" -o "$temp_file"; then
        print_error "Failed to download FireSTARR binary"
        rm -f "$temp_file"
        exit 1
    fi

    mkdir -p "$install_dir"
    tar -xzf "$temp_file" -C "$install_dir"
    rm -f "$temp_file"

    # Find binary
    local binary_path
    binary_path=$(find "$install_dir" -name "firestarr" -type f -executable 2>/dev/null | head -1)
    if [ -z "$binary_path" ]; then
        print_error "Could not find firestarr binary after extraction"
        exit 1
    fi

    FIRESTARR_BINARY_PATH="$binary_path"
    print_success "FireSTARR installed: $binary_path"
}

# ============================================
# Build Nomad
# ============================================

build_nomad() {
    print_step "Installing Node.js dependencies..."
    cd "$INSTALL_DIR"

    # Install with dev dependencies in BOTH root and workspaces. TypeScript
    # and friends live in backend/ and frontend/ package.json — without
    # --workspaces the build fails with "tsc: command not found".
    env NODE_ENV=development npm install \
        --include=dev \
        --workspaces \
        --include-workspace-root

    print_step "Rebuilding native modules..."
    npm rebuild

    print_step "Building Nomad..."
    npm run build

    print_success "Build complete"
}

# ============================================
# Summary & Start
# ============================================

print_summary() {
    echo ""
    echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
    echo -e "${CYAN}              Installation Summary${NC}"
    echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
    echo ""
    echo "  Deployment Mode: SAN (Stand Alone Nomad)"
    echo "  Infrastructure:    Metal (native)"
    echo "  Install Directory: ${INSTALL_DIR}"
    echo "  Dataset Path:      ${FIRESTARR_DATASET_PATH}"
    echo "  Access URL:        http://${NOMAD_SERVER_HOSTNAME}:${NOMAD_PORT}"
    echo ""
}

start_nomad() {
    print_step "Starting Project Nomad..."
    cd "$INSTALL_DIR"

    if [ -z "$SKIP_START" ]; then
        print_info "Starting in production mode..."
        npm run start
    else
        print_info "Skip start requested."
        echo "To start manually: cd ${INSTALL_DIR} && npm run start"
    fi
}

# ============================================
# Main
# ============================================

main() {
    # Resolve to absolute path so repeated cd $INSTALL_DIR works
    case "$INSTALL_DIR" in
        /*) ;; # already absolute
        *)  INSTALL_DIR="$(pwd)/${INSTALL_DIR#./}" ;;
    esac

    print_header
    check_prerequisites

    local tarball
    tarball=$(download_nomad)
    extract_nomad "$tarball"
    rm -f "$tarball"

    generate_env
    check_dataset
    install_firestarr_binary

    # Update .env with FireSTARR binary path if auto-installed
    if [ -n "$FIRESTARR_BINARY_PATH" ]; then
        generate_env
    fi

    build_nomad
    print_summary

    if [ -z "$SKIP_START" ]; then
        start_nomad
    fi
}

main "$@"
