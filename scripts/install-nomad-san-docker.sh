#!/bin/bash
#
# Project Nomad - SAN + Docker Headless Installer
# Quick install for SAN mode with Docker infrastructure
#
# Usage:
#   curl -fsSL https://.../install-nomad-san-docker.sh | bash
#
# Environment Variables (optional, defaults shown):
#   INSTALL_DIR=./project_nomad       Where to extract Nomad
#   FIRESTARR_DATASET_PATH=~/firestarr_data   Dataset location
#   NOMAD_PORT=4901                   Backend/server port
#
# Example with custom settings:
#   curl -fsSL ... | INSTALL_DIR=./my_nomad bash
#

set -e

# Script version
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
    echo "║   Project Nomad - SAN + Docker Installer v${INSTALLER_VERSION}       ║"
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
NOMAD_PORT="${NOMAD_PORT:-4901}"
NOMAD_FRONTEND_HOST_PORT="${NOMAD_FRONTEND_HOST_PORT:-3901}"
NOMAD_BACKEND_HOST_PORT="${NOMAD_BACKEND_HOST_PORT:-4901}"
NOMAD_SERVER_HOSTNAME="${NOMAD_SERVER_HOSTNAME:-localhost}"

# FireSTARR image configuration
#
# Docker default is pinned by digest to a verified-working build (v0.9.11,
# revision 7070574b46, published 2026-05-13 on the main channel). FireSTARR
# v0.9.12-alpha-2 introduced an x/y transpose regression — see
# https://github.com/CWFMF/firestarr-cpp/issues/17. Bump when fixed upstream.
FIRESTARR_REGISTRY="${FIRESTARR_REGISTRY:-ghcr.io/cwfmf/firestarr-cpp}"
FIRESTARR_IMAGE_NAME="${FIRESTARR_IMAGE_NAME:-firestarr}"
FIRESTARR_IMAGE_TAG="${FIRESTARR_IMAGE_TAG:-sha256:b4f8ca8b2ced7c3424191d28e8781d4c766e2664120ecbcb63591811820f257d}"
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

# Derived paths
NOMAD_DATA_PATH="${NOMAD_DATA_PATH:-$FIRESTARR_DATASET_PATH}"
SIMS_OUTPUT_PATH="${SIMS_OUTPUT_PATH:-$FIRESTARR_DATASET_PATH/sims}"

# GitHub release info
REPO_OWNER="WISE-Developers"
REPO_NAME="project_nomad"
VERSION="${VERSION:-latest}"

# ============================================
# Utility Functions
# ============================================

detect_architecture() {
    local arch
    arch=$(uname -m)

    case "$arch" in
        arm64|aarch64)
            FIRESTARR_IMAGE="$(firestarr_image_ref "$FIRESTARR_IMAGE_TAG_ARM64")"
            ;;
        x86_64)
            FIRESTARR_IMAGE="$(firestarr_image_ref "$FIRESTARR_IMAGE_TAG")"
            ;;
        *)
            FIRESTARR_IMAGE="$(firestarr_image_ref "$FIRESTARR_IMAGE_TAG")"
            ;;
    esac
}

get_latest_version() {
    local api_url="https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest"
    local response

    response=$(curl -fsSL "$api_url" 2>/dev/null || echo "")

    if [ -z "$response" ]; then
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

    VERSION=$(echo "$response" | grep -o '"tag_name": "[^"]*"' | head -1 | sed 's/.*: "\(.*\)".*/\1/')

    if [ -z "$VERSION" ]; then
        print_error "Could not parse version from GitHub API response"
        exit 1
    fi
}

# ============================================
# Prerequisites
# ============================================

check_prerequisites() {
    print_step "Checking prerequisites..."

    # Check Docker
    if ! command -v docker &> /dev/null; then
        print_error "Docker is required but not installed"
        echo ""
        echo "    Install Docker Engine and re-run this installer:"
        echo ""
        echo "      curl -fsSL https://get.docker.com | sh"
        echo ""
        exit 1
    fi

    if ! docker compose version &> /dev/null; then
        print_error "Docker Compose v2 is required"
        echo ""
        echo "    Docker Compose v2 is included with Docker Engine."
        echo "    Re-install Docker:"
        echo ""
        echo "      curl -fsSL https://get.docker.com | sh"
        echo ""
        exit 1
    fi

    print_success "Docker available"

    # Check curl
    if ! command -v curl &> /dev/null; then
        print_error "curl is required"
        exit 1
    fi

    print_success "Prerequisites satisfied"
}

# ============================================
# Download Nomad
# ============================================

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

    print_success "Downloaded Nomad ${VERSION}" >&2
    echo "$temp_file"
}

extract_nomad() {
    local tarball="$1"

    print_step "Extracting to ${INSTALL_DIR}..."

    # Create install directory
    if [ -d "$INSTALL_DIR" ]; then
        print_warning "Directory exists: ${INSTALL_DIR}"
        rm -rf "${INSTALL_DIR}.backup"
        mv "$INSTALL_DIR" "${INSTALL_DIR}.backup"
        print_info "Backed up to ${INSTALL_DIR}.backup"
    fi

    mkdir -p "$INSTALL_DIR"

    # Extract
    local temp_extract
    temp_extract=$(mktemp -d)
    tar -xzf "$tarball" -C "$temp_extract"

    # Move contents up (GitHub tarballs have nested folder)
    local extracted_dir
    extracted_dir=$(find "$temp_extract" -mindepth 1 -maxdepth 1 -type d | head -1)
    mv "${extracted_dir}"/* "$INSTALL_DIR/"
    rm -rf "$temp_extract"

    print_success "Extracted to ${INSTALL_DIR}"
}

# ============================================
# Generate .env Configuration
# ============================================

generate_env() {
    print_step "Generating configuration..."

    local env_file="${INSTALL_DIR}/.env"

    # Create .env from example if exists
    if [ -f "${INSTALL_DIR}/.env.example" ]; then
        cp "${INSTALL_DIR}/.env.example" "$env_file"
    else
        touch "$env_file"
    fi

    # Helper function to update env values (cross-platform sed)
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

    # Core settings
    update_env "NOMAD_DEPLOYMENT_MODE" "SAN"
    update_env "FIRESTARR_DATASET_PATH" "$FIRESTARR_DATASET_PATH"
    update_env "FIRESTARR_EXECUTION_MODE" "docker"
    update_env "NOMAD_DATA_PATH" "$NOMAD_DATA_PATH"

    # Port configuration
    update_env "PORT" "$NOMAD_PORT"
    update_env "NOMAD_FRONTEND_HOST_PORT" "$NOMAD_FRONTEND_HOST_PORT"
    update_env "NOMAD_BACKEND_HOST_PORT" "$NOMAD_BACKEND_HOST_PORT"
    update_env "VITE_API_PORT" "$NOMAD_BACKEND_HOST_PORT"
    update_env "VITE_API_BASE_URL" "http://${NOMAD_SERVER_HOSTNAME}:${NOMAD_BACKEND_HOST_PORT}"
    update_env "NOMAD_SERVER_HOSTNAME" "$NOMAD_SERVER_HOSTNAME"

    # FireSTARR image
    detect_architecture
    update_env "FIRESTARR_IMAGE" "$FIRESTARR_IMAGE"

    # Auth mode (SAN default)
    update_env "NOMAD_AUTH_MODE" "simple"
    update_env "VITE_AUTH_MODE" "simple"

    print_success "Configuration saved to ${env_file}"
}

# ============================================
# FireSTARR Dataset
# ============================================

check_dataset() {
    print_step "Checking FireSTARR dataset..."

    if [ -d "$FIRESTARR_DATASET_PATH/generated/grid" ]; then
        print_success "Existing dataset found at ${FIRESTARR_DATASET_PATH}"
        return 0
    fi

    print_warning "Dataset not found at ${FIRESTARR_DATASET_PATH}"
    echo ""
    echo "The FireSTARR dataset (~50GB) is required for fire modeling."
    echo ""

    if [ -z "$AUTO_INSTALL_DATASET" ]; then
        echo "To auto-download, run with AUTO_INSTALL_DATASET=1:"
        echo "  curl ... | AUTO_INSTALL_DATASET=1 bash"
        echo ""
        echo "Or download manually later:"
        echo "  cd ${INSTALL_DIR}"
        echo "  ./scripts/install-firestarr-dataset.sh"
        return 0
    fi

    print_step "Auto-downloading dataset..."
    cd "$INSTALL_DIR"
    bash scripts/install-firestarr-dataset.sh
}

# ============================================
# Docker Setup
# ============================================

setup_docker() {
    print_step "Setting up Docker environment..."

    cd "$INSTALL_DIR"

    # Create sims directory
    mkdir -p "$SIMS_OUTPUT_PATH"
    chmod 755 "$SIMS_OUTPUT_PATH"

    # Pull FireSTARR image
    print_step "Pulling FireSTARR image..."
    docker compose pull firestarr-app || print_warning "FireSTARR image pull may have issues"

    # Build Nomad
    print_step "Building Nomad containers..."
    docker compose build

    print_success "Docker setup complete"
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
    echo "  Deployment Mode:     SAN (Stand Alone Nomad)"
    echo "  Infrastructure:    Docker"
    echo "  Install Directory: ${INSTALL_DIR}"
    echo "  Dataset Path:      ${FIRESTARR_DATASET_PATH}"
    echo "  Access URL:        http://${NOMAD_SERVER_HOSTNAME}:${NOMAD_FRONTEND_HOST_PORT}"
    echo ""
}

start_nomad() {
    print_step "Starting Project Nomad..."

    cd "$INSTALL_DIR"
    docker compose up -d

    print_success "Project Nomad is starting!"
    echo ""
    echo "Access Nomad at: http://${NOMAD_SERVER_HOSTNAME}:${NOMAD_FRONTEND_HOST_PORT}"
    echo ""
    echo "View logs: docker compose logs -f"
    echo "Stop:      docker compose down"
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

    setup_docker

    print_summary

    if [ -z "$SKIP_START" ]; then
        start_nomad
    else
        print_info "Skip start requested. To start manually:"
        echo "  cd ${INSTALL_DIR}"
        echo "  docker compose up -d"
    fi
}

main "$@"
