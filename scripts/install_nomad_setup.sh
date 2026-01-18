#!/bin/bash
#
# Project Nomad Setup Wizard
# Menu-driven installer supporting multiple deployment configurations
#
# Usage:
#   ./scripts/install_nomad_setup.sh [--dry-run]
#
# Options:
#   --dry-run    Show what would be done without making changes
#

set -e

# Installer version
INSTALLER_VERSION="2.0.0"

# Script directory (for calling other scripts)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Configuration file
ENV_FILE="$PROJECT_DIR/.env"
ENV_EXAMPLE="$PROJECT_DIR/.env.example"

# Dry run mode
DRY_RUN=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        -h|--help)
            echo "Usage: $0 [--dry-run]"
            echo ""
            echo "Options:"
            echo "  --dry-run    Show what would be done without making changes"
            echo ""
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
NC='\033[0m' # No Color

# ============================================
# Print Functions
# ============================================

print_header() {
    echo -e "${BLUE}"
    echo "╔════════════════════════════════════════════════════════════╗"
    echo "║           Project Nomad Setup Wizard v${INSTALLER_VERSION}               ║"
    echo "║           Fire Modeling System                             ║"
    if [ "$DRY_RUN" = true ]; then
    echo "║                    [DRY RUN MODE]                          ║"
    fi
    echo "╚════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

print_step() {
    echo -e "${GREEN}▶${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

print_error() {
    echo -e "${RED}✖${NC} $1"
}

print_success() {
    echo -e "${GREEN}✔${NC} $1"
}

print_info() {
    echo -e "${CYAN}ℹ${NC} $1"
}

print_dry_run() {
    echo -e "${MAGENTA}[DRY RUN]${NC} $1"
}

# Execute or print based on dry-run mode
run_cmd() {
    if [ "$DRY_RUN" = true ]; then
        print_dry_run "Would run: $*"
        return 0
    else
        "$@"
    fi
}

# ============================================
# Menu Functions
# ============================================

display_menu() {
    local title="$1"
    shift
    local options=("$@")

    echo ""
    echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
    echo -e "${CYAN}              $title${NC}"
    echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
    echo ""
}

get_selection() {
    local max="$1"
    local default="$2"
    local choice

    while true; do
        read -p "Select an option [1-$max] (default: $default): " choice
        choice="${choice:-$default}"

        if [[ "$choice" =~ ^[0-9]+$ ]] && [ "$choice" -ge 1 ] && [ "$choice" -le "$max" ]; then
            echo "$choice"
            return 0
        fi
        print_warning "Invalid selection. Please enter 1-$max."
    done
}

# ============================================
# Early Prerequisite Checks (fail fast)
# ============================================

# Check Node.js version early - exits if Node is missing or too old
check_node_early() {
    local required_major=20

    if ! command -v node &> /dev/null; then
        echo ""
        print_error "Node.js is not installed"
        echo ""
        echo "    Node.js >= $required_major is required for native installation."
        echo ""
        echo "    To install Node.js:"
        echo "      macOS:   brew install node@$required_major"
        echo "      Or use nvm: nvm install $required_major"
        echo ""
        exit 1
    fi

    local node_version
    node_version=$(node -v | sed 's/v//')
    local major_version
    major_version=$(echo "$node_version" | cut -d. -f1)

    if [ "$major_version" -lt "$required_major" ]; then
        echo ""
        print_error "Node.js $node_version is installed, but >= $required_major is required"
        echo ""
        echo "    To upgrade Node.js:"
        echo "      macOS:   brew install node@$required_major"
        echo "      Or use nvm: nvm install $required_major && nvm use $required_major"
        echo ""
        exit 1
    fi
}

# ============================================
# Step 1: Deployment Mode
# ============================================

step1_deployment_mode() {
    display_menu "Step 1: Deployment Mode"

    echo -e "    ${GREEN}1) SAN (Stand Alone Nomad)${NC}"
    echo "       Complete self-contained deployment"
    echo "       - SQLite database (no external DB required)"
    echo "       - Simple username-based authentication"
    echo "       - Ideal for: single users, demonstrations, field deployments"
    echo ""
    echo -e "    ${CYAN}2) ACN (Agency Centric Nomad)${NC}"
    echo "       Integrates into existing agency infrastructure"
    echo "       - PostgreSQL, MySQL, SQL Server, or Oracle database"
    echo "       - OIDC or SAML authentication with your identity provider"
    echo "       - Ideal for: agency deployments, multi-user environments"
    echo ""

    local choice
    choice=$(get_selection 2 1)

    case $choice in
        1)
            NOMAD_DEPLOYMENT_MODE="SAN"
            print_success "Selected: SAN (Stand Alone Nomad)"
            ;;
        2)
            NOMAD_DEPLOYMENT_MODE="ACN"
            print_success "Selected: ACN (Agency Centric Nomad)"
            ;;
    esac
}

# ============================================
# Step 2: Infrastructure Choice
# ============================================

step2_infrastructure() {
    display_menu "Step 2: Infrastructure"

    echo -e "    ${GREEN}1) All Docker (Recommended)${NC}"
    echo "       Everything runs in containers"
    echo "       - Easiest setup, consistent across platforms"
    echo "       - Requires: Docker Desktop or Docker Engine"
    echo ""
    echo -e "    ${YELLOW}2) All Metal${NC}"
    echo "       Everything runs natively on host"
    echo "       - Maximum performance, no containerization overhead"
    echo "       - Requires: Node.js >= 20, GDAL libraries, FireSTARR binary"
    echo ""
    echo -e "    ${YELLOW}3) Nomad Docker + FireSTARR Metal${NC}"
    echo "       Nomad GUI/API in containers, native FireSTARR"
    echo "       - Good for high-performance modeling with easy Nomad setup"
    echo "       - Requires: Docker, FireSTARR binary"
    echo ""
    echo -e "    ${YELLOW}4) Nomad Metal + FireSTARR Docker${NC}"
    echo "       Native development environment, containerized modeling"
    echo "       - Ideal for Nomad development with easy FireSTARR setup"
    echo "       - Requires: Node.js >= 20, GDAL libraries, Docker"
    echo ""

    local choice
    choice=$(get_selection 4 1)

    case $choice in
        1)
            NOMAD_INFRA="docker"
            FIRESTARR_INFRA="docker"
            FIRESTARR_EXECUTION_MODE="docker"
            print_success "Selected: All Docker"
            ;;
        2)
            check_node_early
            NOMAD_INFRA="metal"
            FIRESTARR_INFRA="metal"
            FIRESTARR_EXECUTION_MODE="binary"
            print_success "Selected: All Metal"
            ;;
        3)
            NOMAD_INFRA="docker"
            FIRESTARR_INFRA="metal"
            FIRESTARR_EXECUTION_MODE="binary"
            print_success "Selected: Nomad Docker + FireSTARR Metal"
            ;;
        4)
            check_node_early
            NOMAD_INFRA="metal"
            FIRESTARR_INFRA="docker"
            FIRESTARR_EXECUTION_MODE="docker"
            print_success "Selected: Nomad Metal + FireSTARR Docker"
            ;;
    esac
}

# ============================================
# Dataset Configuration
# ============================================

# Prompt user for dataset source - use existing or download new
prompt_dataset_source() {
    echo -e "${CYAN}FireSTARR Dataset${NC}"
    echo "    The dataset includes fuel grids, DEM data (~50GB)."
    echo ""
    echo -e "    ${GREEN}1) Use existing dataset${NC}"
    echo "       Point to an already-downloaded FireSTARR dataset"
    echo ""
    echo -e "    ${GREEN}2) Download dataset${NC}"
    echo "       Download the dataset during installation"
    echo ""
    echo -e "    ${YELLOW}3) Skip for now${NC}"
    echo "       Configure dataset location later"
    echo ""

    local choice
    read -p "Select an option [1-3] (default: 2): " choice
    choice="${choice:-2}"

    case "$choice" in
        1)
            # Use existing dataset
            prompt_existing_dataset
            ;;
        2)
            # Download new - just get the target path
            prompt_new_dataset_path
            DATASET_INSTALL_MODE="download"
            ;;
        3)
            # Skip - use default path but don't download
            local default_dataset="${FIRESTARR_DATASET_PATH:-$HOME/firestarr_data}"
            FIRESTARR_DATASET_PATH="$default_dataset"
            DATASET_INSTALL_MODE="skip"
            print_info "Skipping dataset configuration - you'll need to set this up later"
            ;;
        *)
            prompt_new_dataset_path
            DATASET_INSTALL_MODE="download"
            ;;
    esac
}

# Option 1: Use existing dataset
prompt_existing_dataset() {
    echo ""
    echo -e "${CYAN}Existing Dataset Location${NC}"
    echo "    Point to a directory containing the FireSTARR dataset."
    echo "    Expected structure: {path}/generated/grid/100m/"
    echo ""

    local default_dataset="${FIRESTARR_DATASET_PATH:-$HOME/firestarr_data}"
    read -p "Dataset path [$default_dataset]: " input_dataset
    input_dataset="${input_dataset:-$default_dataset}"

    # Expand ~ if present
    input_dataset="${input_dataset/#\~/$HOME}"

    # Convert to absolute path
    if [[ ! "$input_dataset" = /* ]]; then
        input_dataset="$(pwd)/$input_dataset"
    fi

    # Validate dataset exists
    if [ -d "$input_dataset/generated/grid" ]; then
        print_success "Dataset found: $input_dataset"
        FIRESTARR_DATASET_PATH="$input_dataset"
        DATASET_INSTALL_MODE="existing"
    else
        print_warning "Dataset structure not found at: $input_dataset"
        echo "    Expected: $input_dataset/generated/grid/"
        echo ""
        read -p "Use this path anyway and download later? [Y/n] " -n 1 -r
        echo ""
        if [[ ! $REPLY =~ ^[Nn]$ ]]; then
            FIRESTARR_DATASET_PATH="$input_dataset"
            DATASET_INSTALL_MODE="download"
        else
            # Recurse to let them try again
            prompt_dataset_source
            return
        fi
    fi
}

# Option 2: Download new dataset - get target path
prompt_new_dataset_path() {
    echo ""
    echo -e "${CYAN}Dataset Download Location${NC}"
    echo "    Where to download the FireSTARR dataset (~50GB required)."
    echo ""

    local default_dataset="${FIRESTARR_DATASET_PATH:-$HOME/firestarr_data}"
    read -p "Dataset path [$default_dataset]: " input_dataset
    input_dataset="${input_dataset:-$default_dataset}"

    # Expand ~ if present
    input_dataset="${input_dataset/#\~/$HOME}"

    # Convert to absolute path
    if [[ ! "$input_dataset" = /* ]]; then
        input_dataset="$(pwd)/$input_dataset"
    fi

    FIRESTARR_DATASET_PATH="$input_dataset"
    print_success "Dataset will be downloaded to: $FIRESTARR_DATASET_PATH"
}

# ============================================
# Step 3: Path Configuration
# ============================================

step3_paths() {
    display_menu "Step 3: Path Configuration"

    # Dataset configuration
    prompt_dataset_source
    echo ""

    # Sims output (usually under dataset path)
    echo -e "${CYAN}Simulation Output Directory${NC}"
    echo "    Where FireSTARR writes simulation results."
    echo ""
    local default_sims="$FIRESTARR_DATASET_PATH/sims"
    read -p "Sims output [$default_sims]: " input_sims
    SIMS_OUTPUT_PATH="${input_sims:-$default_sims}"
    print_success "Sims output: $SIMS_OUTPUT_PATH"
    echo ""

    # Database location (SAN mode only)
    if [ "$NOMAD_DEPLOYMENT_MODE" = "SAN" ]; then
        echo -e "${CYAN}SQLite Database Location${NC}"
        echo "    Where the Nomad database file (nomad.db) will be stored."
        echo ""
        local default_db="$FIRESTARR_DATASET_PATH"
        read -p "Database location [$default_db]: " input_db
        NOMAD_DATA_PATH="${input_db:-$default_db}"
        print_success "Database location: $NOMAD_DATA_PATH/nomad.db"
        echo ""
    fi

    # Agency configuration (ACN mode only)
    if [ "$NOMAD_DEPLOYMENT_MODE" = "ACN" ]; then
        echo -e "${CYAN}Agency ID${NC}"
        echo "    Your agency's configuration folder name."
        echo "    Configuration will be loaded from: /configuration/{agency_id}/config.json"
        echo ""
        read -p "Agency ID [generic]: " input_agency
        NOMAD_AGENCY_ID="${input_agency:-generic}"
        print_success "Agency ID: $NOMAD_AGENCY_ID"
        echo ""

        echo -e "${CYAN}Database Configuration${NC}"
        echo "    ACN mode requires an external database."
        echo ""
        read -p "Database type (pg/mysql/mssql/oracledb) [pg]: " input_db_client
        NOMAD_DB_CLIENT="${input_db_client:-pg}"

        read -p "Database host [localhost]: " input_db_host
        NOMAD_DB_HOST="${input_db_host:-localhost}"

        local default_port="5432"
        case $NOMAD_DB_CLIENT in
            mysql|mysql2) default_port="3306" ;;
            mssql) default_port="1433" ;;
            oracledb) default_port="1521" ;;
        esac
        read -p "Database port [$default_port]: " input_db_port
        NOMAD_DB_PORT="${input_db_port:-$default_port}"

        read -p "Database name [nomad]: " input_db_name
        NOMAD_DB_NAME="${input_db_name:-nomad}"

        read -p "Database user [nomad]: " input_db_user
        NOMAD_DB_USER="${input_db_user:-nomad}"

        read -sp "Database password: " input_db_password
        echo ""
        NOMAD_DB_PASSWORD="$input_db_password"

        print_success "Database configured: $NOMAD_DB_CLIENT://$NOMAD_DB_HOST:$NOMAD_DB_PORT/$NOMAD_DB_NAME"
        echo ""
    fi

    # FireSTARR binary source (metal FireSTARR only)
    if [ "$FIRESTARR_INFRA" = "metal" ]; then
        prompt_firestarr_binary_source
        echo ""
    fi
}

# ============================================
# Prerequisite Validation
# ============================================

validate_prerequisites() {
    local errors=0

    print_step "Validating prerequisites for your configuration..."
    echo ""

    # Docker requirements
    if [ "$NOMAD_INFRA" = "docker" ] || [ "$FIRESTARR_INFRA" = "docker" ]; then
        if ! command -v docker &> /dev/null; then
            print_error "Docker is required but not installed"
            echo "    Install from: https://docs.docker.com/get-docker/"
            ((errors++))
        elif ! docker compose version &> /dev/null; then
            print_error "Docker Compose is required but not available"
            ((errors++))
        else
            print_success "Docker and Docker Compose available"
        fi
    fi

    # Node.js requirements (metal Nomad)
    if [ "$NOMAD_INFRA" = "metal" ]; then
        if ! command -v node &> /dev/null; then
            print_error "Node.js is required but not installed"
            echo "    Required version: >= 20.0.0"
            echo "    Install from: https://nodejs.org/"
            ((errors++))
        else
            local node_version
            node_version=$(node -v | sed 's/v//')
            local major_version
            major_version=$(echo "$node_version" | cut -d. -f1)
            if [ "$major_version" -lt 20 ]; then
                print_error "Node.js version $node_version is too old (need >= 20)"
                ((errors++))
            else
                print_success "Node.js $node_version available"
            fi
        fi

        # npm check
        if ! command -v npm &> /dev/null; then
            print_error "npm is required but not installed"
            ((errors++))
        else
            print_success "npm available"
        fi

        # GDAL check for backend native compilation
        if ! command -v gdalinfo &> /dev/null; then
            print_warning "GDAL not found - gdal-async may fail to compile"
            echo "    Install GDAL development libraries:"
            echo "    - macOS: brew install gdal"
            echo "    - Ubuntu: apt install gdal-bin libgdal-dev"
            echo "    - Fedora: dnf install gdal gdal-devel"
        else
            print_success "GDAL available"
        fi
    fi

    # FireSTARR binary requirements (metal FireSTARR)
    if [ "$FIRESTARR_INFRA" = "metal" ]; then
        case "$FIRESTARR_INSTALL_MODE" in
            archive)
                if [[ "$FIRESTARR_ARCHIVE_SOURCE" =~ ^https?:// ]]; then
                    print_success "FireSTARR will be downloaded from URL"
                elif [ -f "$FIRESTARR_ARCHIVE_SOURCE" ]; then
                    print_success "FireSTARR archive found: $FIRESTARR_ARCHIVE_SOURCE"
                else
                    print_warning "FireSTARR archive not found: $FIRESTARR_ARCHIVE_SOURCE"
                fi
                print_info "Will install to: $FIRESTARR_INSTALL_DIR"
                ;;
            existing)
                if [ -n "$FIRESTARR_BINARY_PATH" ] && [ -x "$FIRESTARR_BINARY_PATH" ]; then
                    print_success "Existing FireSTARR binary: $FIRESTARR_BINARY_PATH"
                else
                    print_warning "FireSTARR binary not found or not executable: $FIRESTARR_BINARY_PATH"
                fi
                ;;
            skip|"")
                print_warning "FireSTARR binary not configured"
                echo "    You'll need to compile FireSTARR or download a pre-built binary"
                echo "    See: https://github.com/WISE-Developers/firestarr"
                ;;
        esac
    fi

    return $errors
}

# ============================================
# Architecture Detection (from install_nomad.sh)
# ============================================

is_colima() {
    if docker context show 2>/dev/null | grep -q "colima"; then
        return 0
    fi
    if docker info 2>/dev/null | grep -qi "colima"; then
        return 0
    fi
    return 1
}

has_avx2() {
    local arch
    arch=$(uname -m)

    if [ "$arch" = "x86_64" ]; then
        if [ -f /proc/cpuinfo ]; then
            if grep -q "avx2" /proc/cpuinfo; then
                return 0
            fi
        fi
        if command -v sysctl &> /dev/null; then
            if sysctl -n machdep.cpu.features 2>/dev/null | grep -qi "AVX2"; then
                return 0
            fi
            if sysctl -n machdep.cpu.leaf7_features 2>/dev/null | grep -qi "AVX2"; then
                return 0
            fi
        fi
        return 1
    fi
    return 1
}

detect_architecture() {
    local arch
    arch=$(uname -m)
    local os
    os=$(uname -s)

    DETECTED_ARCH="$arch"
    DETECTED_OS="$os"
    DETECTED_COLIMA=false
    DETECTED_AVX2=false

    if is_colima; then
        DETECTED_COLIMA=true
    fi

    if has_avx2; then
        DETECTED_AVX2=true
    fi

    # Determine recommended image based on detection
    case "$arch" in
        arm64|aarch64)
            RECOMMENDED_IMAGE="ghcr.io/wise-developers/firestarr:\${VERSION}-arm64"
            ;;
        x86_64)
            if [ "$DETECTED_AVX2" = true ]; then
                RECOMMENDED_IMAGE="ghcr.io/cwfmf/firestarr:dev-\${VERSION}"
            else
                RECOMMENDED_IMAGE="ghcr.io/wise-developers/firestarr:\${VERSION}-sandybridge"
            fi
            ;;
        *)
            RECOMMENDED_IMAGE="ghcr.io/cwfmf/firestarr:dev-\${VERSION}"
            ;;
    esac
}

configure_firestarr_image() {
    print_step "Detecting system architecture..."
    detect_architecture

    echo ""
    echo "    Operating System:  $DETECTED_OS"
    echo "    CPU Architecture:  $DETECTED_ARCH"
    echo "    AVX2 Support:      $([ "$DETECTED_AVX2" = true ] && echo "Yes" || echo "No")"
    echo "    Docker via Colima: $([ "$DETECTED_COLIMA" = true ] && echo "Yes" || echo "No")"
    echo ""

    # Expand VERSION in recommended image
    local expanded_image
    expanded_image=$(eval echo "$RECOMMENDED_IMAGE")

    echo "Available FireSTARR images:"
    echo ""
    echo "    1) Recommended: $expanded_image"
    echo "    2) Modern x86_64 (AVX2):    ghcr.io/cwfmf/firestarr:dev-${VERSION}"
    echo "    3) Older x86_64 (no AVX2):  ghcr.io/wise-developers/firestarr:${VERSION}-sandybridge"
    echo "    4) ARM64 (Apple Silicon):   ghcr.io/wise-developers/firestarr:${VERSION}-arm64"
    echo "    5) Enter custom image"
    echo ""
    read -p "Select an option [1-5] (default: 1): " choice

    case "${choice:-1}" in
        1)
            FIRESTARR_IMAGE="$expanded_image"
            ;;
        2)
            FIRESTARR_IMAGE="ghcr.io/cwfmf/firestarr:dev-${VERSION}"
            ;;
        3)
            FIRESTARR_IMAGE="ghcr.io/wise-developers/firestarr:${VERSION}-sandybridge"
            ;;
        4)
            FIRESTARR_IMAGE="ghcr.io/wise-developers/firestarr:${VERSION}-arm64"
            ;;
        5)
            read -p "Enter custom image: " custom_image
            FIRESTARR_IMAGE="${custom_image:-$expanded_image}"
            ;;
        *)
            FIRESTARR_IMAGE="$expanded_image"
            ;;
    esac

    print_success "FireSTARR image: $FIRESTARR_IMAGE"
}

# ============================================
# FireSTARR Binary Installation (Metal Mode)
# ============================================

# Get platform string for binary naming (e.g., "arm64-macos", "x86_64-linux")
get_platform_string() {
    local arch os_name
    arch=$(uname -m)
    os_name=$(uname -s | tr '[:upper:]' '[:lower:]')

    # Normalize architecture names
    case "$arch" in
        arm64|aarch64) arch="arm64" ;;
        x86_64|amd64) arch="x86_64" ;;
    esac

    # Normalize OS names
    case "$os_name" in
        darwin) os_name="macos" ;;
    esac

    echo "${arch}-${os_name}"
}

# Prompt user for FireSTARR binary configuration
# Two options: use existing installation or install from archive
prompt_firestarr_binary_source() {
    local platform
    platform=$(get_platform_string)

    echo ""
    echo -e "${CYAN}FireSTARR Binary Configuration${NC}"
    echo "    Detected platform: $platform"
    echo ""
    echo -e "    ${GREEN}1) Use existing FireSTARR installation${NC}"
    echo "       Point to an already-installed FireSTARR binary"
    echo "       Note: Nomad will update settings.ini to use its dataset path"
    echo ""
    echo -e "    ${GREEN}2) Install FireSTARR for Nomad${NC}"
    echo "       Provide a distribution archive (.zip) to install"
    echo "       Nomad will extract and configure it"
    echo ""
    echo -e "    ${YELLOW}3) Skip for now${NC}"
    echo "       Configure FireSTARR later"
    echo ""

    local choice
    read -p "Select an option [1-3] (default: 2): " choice
    choice="${choice:-2}"

    case "$choice" in
        1)
            # Use existing installation
            prompt_existing_firestarr
            ;;
        2)
            # Install from archive
            prompt_firestarr_archive
            ;;
        3)
            print_info "Skipping FireSTARR configuration - you'll need to set this up later"
            FIRESTARR_BINARY_SOURCE=""
            FIRESTARR_BINARY_PATH=""
            FIRESTARR_INSTALL_MODE="skip"
            return 1
            ;;
        *)
            print_warning "Invalid selection, skipping"
            return 1
            ;;
    esac
}

# Option 1: Use existing FireSTARR installation
prompt_existing_firestarr() {
    echo ""
    echo -e "${CYAN}Existing FireSTARR Installation${NC}"
    echo ""
    read -p "Path to FireSTARR binary: " binary_path

    # Expand ~ if present
    binary_path="${binary_path/#\~/$HOME}"

    if [ -z "$binary_path" ]; then
        print_warning "No path provided"
        return 1
    fi

    if [ ! -f "$binary_path" ]; then
        print_error "Binary not found: $binary_path"
        return 1
    fi

    if [ ! -x "$binary_path" ]; then
        print_warning "Binary exists but is not executable: $binary_path"
    fi

    # Check for existing settings.ini
    local binary_dir
    binary_dir=$(dirname "$binary_path")
    local settings_file="$binary_dir/settings.ini"

    if [ -f "$settings_file" ]; then
        print_warning "Existing settings.ini found at: $settings_file"
        echo "    Nomad will update RASTER_ROOT to point to the Nomad dataset."
        echo ""
        read -p "Continue? [Y/n] " -n 1 -r
        echo ""
        if [[ $REPLY =~ ^[Nn]$ ]]; then
            return 1
        fi
    fi

    FIRESTARR_BINARY_PATH="$binary_path"
    FIRESTARR_INSTALL_MODE="existing"
    print_success "Will use existing FireSTARR: $binary_path"
    return 0
}

# Option 2: Install FireSTARR from archive
prompt_firestarr_archive() {
    echo ""
    echo -e "${CYAN}Install FireSTARR for Nomad${NC}"
    echo ""
    echo "    Provide a FireSTARR distribution archive (.zip)"
    echo "    This can be a local file path or a URL"
    echo ""

    read -p "Archive location (.zip or URL): " archive_source

    # Expand ~ if present
    archive_source="${archive_source/#\~/$HOME}"

    if [ -z "$archive_source" ]; then
        print_warning "No archive provided"
        return 1
    fi

    # Validate source exists (if local file)
    if [[ ! "$archive_source" =~ ^https?:// ]]; then
        if [ ! -f "$archive_source" ]; then
            print_error "Archive not found: $archive_source"
            return 1
        fi
    fi

    FIRESTARR_ARCHIVE_SOURCE="$archive_source"

    # Ask for installation directory
    echo ""
    local default_install_dir="$HOME/.local/share/nomad/firestarr"
    read -p "Installation directory [$default_install_dir]: " install_dir
    install_dir="${install_dir:-$default_install_dir}"

    # Expand ~ if present
    install_dir="${install_dir/#\~/$HOME}"

    # Convert to absolute path if relative
    if [[ ! "$install_dir" = /* ]]; then
        install_dir="$(pwd)/$install_dir"
    fi

    FIRESTARR_INSTALL_DIR="$install_dir"
    FIRESTARR_INSTALL_MODE="archive"

    print_success "Will install FireSTARR from: $archive_source"
    print_success "Installation directory: $install_dir"
    return 0
}

# Install FireSTARR from archive (.zip)
# Extracts archive and generates settings.ini
install_firestarr_from_archive() {
    local archive_source="$1"
    local install_dir="$2"
    local dataset_path="$3"

    if [ -z "$archive_source" ] || [ -z "$install_dir" ]; then
        print_error "Archive source and install directory required"
        return 1
    fi

    print_step "Installing FireSTARR from archive..."

    # Create install directory
    if [ "$DRY_RUN" = true ]; then
        print_dry_run "Would create directory: $install_dir"
    else
        mkdir -p "$install_dir"
    fi

    local archive_file="$archive_source"

    # Download if URL
    if [[ "$archive_source" =~ ^https?:// ]]; then
        print_step "Downloading archive..."
        archive_file="/tmp/firestarr_download_$$.zip"

        if [ "$DRY_RUN" = true ]; then
            print_dry_run "Would download: $archive_source -> $archive_file"
        else
            if command -v curl &> /dev/null; then
                curl -fSL "$archive_source" -o "$archive_file"
            elif command -v wget &> /dev/null; then
                wget -q "$archive_source" -O "$archive_file"
            else
                print_error "Neither curl nor wget available for download"
                return 1
            fi

            if [ ! -f "$archive_file" ]; then
                print_error "Download failed"
                return 1
            fi
        fi
    fi

    # Extract archive
    print_step "Extracting archive..."
    if [ "$DRY_RUN" = true ]; then
        print_dry_run "Would extract: $archive_file -> $install_dir"
    else
        if [[ "$archive_file" =~ \.zip$ ]]; then
            unzip -q -o "$archive_file" -d "$install_dir"
        elif [[ "$archive_file" =~ \.(tar\.gz|tgz)$ ]]; then
            tar -xzf "$archive_file" -C "$install_dir"
        elif [[ "$archive_file" =~ \.tar$ ]]; then
            tar -xf "$archive_file" -C "$install_dir"
        else
            print_error "Unsupported archive format (use .zip, .tar.gz, or .tar)"
            return 1
        fi
    fi

    # Clean up downloaded file
    if [[ "$archive_source" =~ ^https?:// ]] && [ "$DRY_RUN" = false ]; then
        rm -f "$archive_file"
    fi

    # Find the binary (might be in a subdirectory)
    local binary_path=""
    if [ "$DRY_RUN" = true ]; then
        binary_path="$install_dir/firestarr"
        print_dry_run "Would search for firestarr binary in $install_dir"
    else
        # Look for firestarr binary
        binary_path=$(find "$install_dir" -name "firestarr" -type f 2>/dev/null | head -1)

        if [ -z "$binary_path" ]; then
            # Try case-insensitive
            binary_path=$(find "$install_dir" -iname "firestarr" -type f 2>/dev/null | head -1)
        fi

        if [ -z "$binary_path" ]; then
            print_error "Could not find firestarr binary in extracted archive"
            echo "    Contents of $install_dir:"
            ls -la "$install_dir"
            return 1
        fi

        # Make executable
        chmod +x "$binary_path"
    fi

    # Generate settings.ini in the same directory as the binary
    local binary_dir
    binary_dir=$(dirname "$binary_path")
    local settings_file="$binary_dir/settings.ini"
    local raster_root="$dataset_path/generated/grid/100m"

    print_step "Generating settings.ini..."
    if [ "$DRY_RUN" = true ]; then
        print_dry_run "Would create $settings_file with RASTER_ROOT = $raster_root"
    else
        cat > "$settings_file" << EOF
# FireSTARR settings - generated by Project Nomad installer
# $(date)

RASTER_ROOT = $raster_root
EOF
    fi

    # Verify
    if [ "$DRY_RUN" = false ]; then
        if [ -x "$binary_path" ]; then
            print_success "FireSTARR binary: $binary_path"
        else
            print_error "Binary not executable: $binary_path"
            return 1
        fi

        if [ -f "$settings_file" ]; then
            print_success "settings.ini: $settings_file"
        fi
    fi

    FIRESTARR_BINARY_PATH="$binary_path"
    return 0
}

# Update settings.ini for existing FireSTARR installation
update_existing_firestarr_settings() {
    local binary_path="$1"
    local dataset_path="$2"

    local binary_dir
    binary_dir=$(dirname "$binary_path")
    local settings_file="$binary_dir/settings.ini"
    local raster_root="$dataset_path/generated/grid/100m"

    print_step "Updating settings.ini for Nomad..."

    if [ "$DRY_RUN" = true ]; then
        print_dry_run "Would update $settings_file with RASTER_ROOT = $raster_root"
        return 0
    fi

    # Backup existing settings.ini if present
    if [ -f "$settings_file" ]; then
        local backup="$settings_file.backup.$(date +%Y%m%d_%H%M%S)"
        cp "$settings_file" "$backup"
        print_info "Backed up existing settings.ini to $backup"
    fi

    # Update or create settings.ini
    if [ -f "$settings_file" ]; then
        # Update existing RASTER_ROOT line or append
        if grep -q "^RASTER_ROOT" "$settings_file"; then
            if [[ "$OSTYPE" == "darwin"* ]]; then
                sed -i '' "s|^RASTER_ROOT.*|RASTER_ROOT = $raster_root|" "$settings_file"
            else
                sed -i "s|^RASTER_ROOT.*|RASTER_ROOT = $raster_root|" "$settings_file"
            fi
        else
            echo "" >> "$settings_file"
            echo "# Added by Project Nomad installer - $(date)" >> "$settings_file"
            echo "RASTER_ROOT = $raster_root" >> "$settings_file"
        fi
    else
        # Create new settings.ini
        cat > "$settings_file" << EOF
# FireSTARR settings - generated by Project Nomad installer
# $(date)

RASTER_ROOT = $raster_root
EOF
    fi

    print_success "settings.ini updated: $settings_file"
    return 0
}

# ============================================
# Git Line-Ending Check
# ============================================

check_git_autocrlf() {
    print_step "Checking git line-ending configuration..."

    if ! command -v git &> /dev/null; then
        return 0
    fi

    local autocrlf
    autocrlf=$(git config --get core.autocrlf 2>/dev/null || echo "")

    if [ "$autocrlf" = "true" ]; then
        print_warning "Git core.autocrlf is set to 'true'"
        echo ""
        echo "    This can break shell scripts with 'bad interpreter' errors."
        echo "    To fix: git rm --cached -r . && git reset --hard"
        echo ""
        read -p "Continue anyway? [y/N] " -n 1 -r
        echo ""
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            return 1
        fi
    else
        print_success "Git line-ending configuration OK"
    fi

    return 0
}

# ============================================
# .env Generation
# ============================================

update_env_value() {
    local key="$1"
    local value="$2"

    if [ "$DRY_RUN" = true ]; then
        print_dry_run "Would set $key=$value"
        return 0
    fi

    if grep -q "^${key}=" "$ENV_FILE" 2>/dev/null; then
        # Update existing
        if [[ "$OSTYPE" == "darwin"* ]]; then
            sed -i '' "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
        else
            sed -i "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
        fi
    elif grep -q "^#.*${key}=" "$ENV_FILE" 2>/dev/null; then
        # Uncomment and update
        if [[ "$OSTYPE" == "darwin"* ]]; then
            sed -i '' "s|^#.*${key}=.*|${key}=${value}|" "$ENV_FILE"
        else
            sed -i "s|^#.*${key}=.*|${key}=${value}|" "$ENV_FILE"
        fi
    else
        # Append
        echo "${key}=${value}" >> "$ENV_FILE"
    fi
}

generate_env_file() {
    print_step "Generating .env configuration..."

    if [ "$DRY_RUN" = true ]; then
        print_dry_run "Would generate/update .env file"
    else
        # Backup existing .env if present
        if [ -f "$ENV_FILE" ]; then
            local backup="$ENV_FILE.backup.$(date +%Y%m%d_%H%M%S)"
            cp "$ENV_FILE" "$backup"
            print_info "Backed up existing .env to $backup"
        fi

        # Start with example as template if no .env exists
        if [ ! -f "$ENV_FILE" ] && [ -f "$ENV_EXAMPLE" ]; then
            cp "$ENV_EXAMPLE" "$ENV_FILE"
            print_info "Created .env from .env.example"
        elif [ ! -f "$ENV_FILE" ]; then
            touch "$ENV_FILE"
            print_info "Created new .env file"
        fi
    fi

    # Update values based on wizard selections
    update_env_value "NOMAD_DEPLOYMENT_MODE" "$NOMAD_DEPLOYMENT_MODE"
    update_env_value "FIRESTARR_DATASET_PATH" "$FIRESTARR_DATASET_PATH"
    update_env_value "FIRESTARR_EXECUTION_MODE" "$FIRESTARR_EXECUTION_MODE"

    if [ -n "$NOMAD_DATA_PATH" ]; then
        update_env_value "NOMAD_DATA_PATH" "$NOMAD_DATA_PATH"
    fi

    if [ -n "$NOMAD_AGENCY_ID" ]; then
        update_env_value "NOMAD_AGENCY_ID" "$NOMAD_AGENCY_ID"
    fi

    if [ -n "$FIRESTARR_BINARY_PATH" ]; then
        update_env_value "FIRESTARR_BINARY_PATH" "$FIRESTARR_BINARY_PATH"
    fi

    if [ -n "$FIRESTARR_IMAGE" ]; then
        update_env_value "FIRESTARR_IMAGE" "$FIRESTARR_IMAGE"
    fi

    # ACN database settings
    if [ "$NOMAD_DEPLOYMENT_MODE" = "ACN" ]; then
        update_env_value "NOMAD_DB_CLIENT" "$NOMAD_DB_CLIENT"
        update_env_value "NOMAD_DB_HOST" "$NOMAD_DB_HOST"
        update_env_value "NOMAD_DB_PORT" "$NOMAD_DB_PORT"
        update_env_value "NOMAD_DB_NAME" "$NOMAD_DB_NAME"
        update_env_value "NOMAD_DB_USER" "$NOMAD_DB_USER"
        update_env_value "NOMAD_DB_PASSWORD" "$NOMAD_DB_PASSWORD"
    fi

    # Prompt for MapBox token if not set
    if [ "$DRY_RUN" = false ]; then
        if ! grep -q "^VITE_MAPBOX_TOKEN=..*$" "$ENV_FILE" 2>/dev/null; then
            echo ""
            echo -e "${CYAN}MapBox Access Token${NC}"
            echo "    Required for map display. Get one at:"
            echo "    https://account.mapbox.com/access-tokens/"
            echo ""
            read -p "MapBox token (or press Enter to skip): " mapbox_token
            if [ -n "$mapbox_token" ]; then
                update_env_value "VITE_MAPBOX_TOKEN" "$mapbox_token"
            else
                print_warning "MapBox token not set - maps won't render"
            fi
        fi
    fi

    print_success ".env file configured"
}

# ============================================
# Installation Functions
# ============================================

install_dataset() {
    print_step "Installing FireSTARR dataset..."

    local install_script="$SCRIPT_DIR/install-firestarr-dataset.sh"

    if [ ! -f "$install_script" ]; then
        print_error "Install script not found: $install_script"
        return 1
    fi

    run_cmd bash "$install_script"
}

ensure_sims_writable() {
    local sims_dir="$FIRESTARR_DATASET_PATH/sims"

    if [ "$DRY_RUN" = true ]; then
        print_dry_run "Would create and set permissions on $sims_dir"
        return 0
    fi

    if [ ! -d "$sims_dir" ]; then
        print_step "Creating sims directory..."
        mkdir -p "$sims_dir"
    fi

    print_step "Setting sims directory permissions..."
    chmod 777 "$sims_dir"
    print_success "sims directory is writable"
}

install_all_docker() {
    print_step "Installing: All Docker configuration"
    echo ""

    # 1. Generate .env
    generate_env_file

    # 2. Configure FireSTARR image
    if [ -z "$FIRESTARR_IMAGE" ]; then
        # Load VERSION from .env if available
        if [ -f "$ENV_FILE" ]; then
            source "$ENV_FILE"
        fi
        VERSION="${VERSION:-0.9.5.4}"
        configure_firestarr_image
        update_env_value "FIRESTARR_IMAGE" "$FIRESTARR_IMAGE"
    fi

    # 3. Install dataset based on mode selected in wizard
    case "$DATASET_INSTALL_MODE" in
        existing)
            print_success "Using existing dataset: $FIRESTARR_DATASET_PATH"
            ;;
        download)
            echo ""
            read -p "Install FireSTARR dataset now? [Y/n] " -n 1 -r
            echo ""
            if [[ ! $REPLY =~ ^[Nn]$ ]]; then
                install_dataset
            fi
            ;;
        skip|"")
            print_warning "Dataset installation skipped"
            ;;
    esac

    # 4. Ensure sims directory
    ensure_sims_writable

    # 5. Pull/build Docker images
    print_step "Building/pulling Docker images..."
    run_cmd docker compose -f "$PROJECT_DIR/docker-compose.yaml" build
    run_cmd docker compose -f "$PROJECT_DIR/docker-compose.yaml" pull firestarr-app

    print_success "All Docker installation complete!"
    echo ""
    echo "To start Project Nomad:"
    echo "    cd $PROJECT_DIR"
    echo "    docker compose up -d"
    echo ""
    echo "Access at: http://localhost:\${NOMAD_FRONTEND_HOST_PORT:-3000}"
}

install_nomad_metal_firestarr_docker() {
    print_step "Installing: Nomad Metal + FireSTARR Docker configuration"
    echo ""

    # 1. Generate .env
    generate_env_file

    # 2. Configure FireSTARR image
    if [ -z "$FIRESTARR_IMAGE" ]; then
        if [ -f "$ENV_FILE" ]; then
            source "$ENV_FILE"
        fi
        VERSION="${VERSION:-0.9.5.4}"
        configure_firestarr_image
        update_env_value "FIRESTARR_IMAGE" "$FIRESTARR_IMAGE"
    fi

    # 3. Install dataset based on mode selected in wizard
    case "$DATASET_INSTALL_MODE" in
        existing)
            print_success "Using existing dataset: $FIRESTARR_DATASET_PATH"
            ;;
        download)
            echo ""
            read -p "Install FireSTARR dataset now? [Y/n] " -n 1 -r
            echo ""
            if [[ ! $REPLY =~ ^[Nn]$ ]]; then
                install_dataset
            fi
            ;;
        skip|"")
            print_warning "Dataset installation skipped"
            ;;
    esac

    # 4. Ensure sims directory
    ensure_sims_writable

    # 5. Pull FireSTARR image
    print_step "Pulling FireSTARR Docker image..."
    run_cmd docker compose -f "$PROJECT_DIR/docker-compose.yaml" pull firestarr-app

    # 6. Install Node.js dependencies
    print_step "Installing Node.js dependencies..."
    run_cmd npm --prefix "$PROJECT_DIR" install

    # 7. Build backend and frontend
    print_step "Building Nomad..."
    run_cmd npm --prefix "$PROJECT_DIR" run build

    print_success "Nomad Metal + FireSTARR Docker installation complete!"
    echo ""
    echo "To start Project Nomad (development):"
    echo "    cd $PROJECT_DIR"
    echo "    npm run dev"
    echo ""
    echo "To start Project Nomad (production):"
    echo "    cd $PROJECT_DIR"
    echo "    npm run start"
    echo ""
    echo "Access at: http://localhost:3001"
    echo "FireSTARR will run in Docker containers when needed."
}

install_all_metal() {
    print_step "Installing: All Metal configuration"
    echo ""

    # 1. Generate .env
    generate_env_file

    # 2. Install dataset based on mode selected in wizard
    case "$DATASET_INSTALL_MODE" in
        existing)
            print_success "Using existing dataset: $FIRESTARR_DATASET_PATH"
            ;;
        download)
            echo ""
            read -p "Install FireSTARR dataset now? [Y/n] " -n 1 -r
            echo ""
            if [[ ! $REPLY =~ ^[Nn]$ ]]; then
                install_dataset
            fi
            ;;
        skip|"")
            print_warning "Dataset installation skipped"
            ;;
    esac

    # 3. Ensure sims directory
    ensure_sims_writable

    # 4. Install/configure FireSTARR binary based on selected mode
    case "$FIRESTARR_INSTALL_MODE" in
        archive)
            # Install from archive
            if install_firestarr_from_archive "$FIRESTARR_ARCHIVE_SOURCE" "$FIRESTARR_INSTALL_DIR" "$FIRESTARR_DATASET_PATH"; then
                update_env_value "FIRESTARR_BINARY_PATH" "$FIRESTARR_BINARY_PATH"
            fi
            ;;
        existing)
            # Use existing installation, update settings.ini
            update_existing_firestarr_settings "$FIRESTARR_BINARY_PATH" "$FIRESTARR_DATASET_PATH"
            update_env_value "FIRESTARR_BINARY_PATH" "$FIRESTARR_BINARY_PATH"
            ;;
        skip|"")
            print_warning "FireSTARR binary not configured"
            echo "    You'll need to set FIRESTARR_BINARY_PATH in .env"
            ;;
    esac

    # 5. Install Node.js dependencies
    print_step "Installing Node.js dependencies..."
    run_cmd npm --prefix "$PROJECT_DIR" install

    # 6. Build backend and frontend
    print_step "Building Nomad..."
    run_cmd npm --prefix "$PROJECT_DIR" run build

    print_success "All Metal installation complete!"
    echo ""
    echo "To start Project Nomad (development):"
    echo "    cd $PROJECT_DIR"
    echo "    npm run dev"
    echo ""
    echo "To start Project Nomad (production):"
    echo "    cd $PROJECT_DIR"
    echo "    npm run start"
    echo ""
    echo "Access at: http://localhost:3001"
}

install_nomad_docker_firestarr_metal() {
    print_step "Installing: Nomad Docker + FireSTARR Metal configuration"
    echo ""

    # 1. Generate .env
    generate_env_file

    # 2. Install dataset based on mode selected in wizard
    case "$DATASET_INSTALL_MODE" in
        existing)
            print_success "Using existing dataset: $FIRESTARR_DATASET_PATH"
            ;;
        download)
            echo ""
            read -p "Install FireSTARR dataset now? [Y/n] " -n 1 -r
            echo ""
            if [[ ! $REPLY =~ ^[Nn]$ ]]; then
                install_dataset
            fi
            ;;
        skip|"")
            print_warning "Dataset installation skipped"
            ;;
    esac

    # 3. Ensure sims directory
    ensure_sims_writable

    # 4. Install/configure FireSTARR binary based on selected mode
    case "$FIRESTARR_INSTALL_MODE" in
        archive)
            # Install from archive
            if install_firestarr_from_archive "$FIRESTARR_ARCHIVE_SOURCE" "$FIRESTARR_INSTALL_DIR" "$FIRESTARR_DATASET_PATH"; then
                update_env_value "FIRESTARR_BINARY_PATH" "$FIRESTARR_BINARY_PATH"
            fi
            ;;
        existing)
            # Use existing installation, update settings.ini
            update_existing_firestarr_settings "$FIRESTARR_BINARY_PATH" "$FIRESTARR_DATASET_PATH"
            update_env_value "FIRESTARR_BINARY_PATH" "$FIRESTARR_BINARY_PATH"
            ;;
        skip|"")
            print_warning "FireSTARR binary not configured"
            echo "    You'll need to set FIRESTARR_BINARY_PATH in .env"
            ;;
    esac

    # 5. Build Nomad containers
    print_step "Building Nomad containers..."
    run_cmd docker compose -f "$PROJECT_DIR/docker-compose.yaml" build nomad-backend nomad-frontend

    print_success "Nomad Docker + FireSTARR Metal installation complete!"
    echo ""
    echo "To start Project Nomad:"
    echo "    cd $PROJECT_DIR"
    echo "    docker compose up -d nomad-backend nomad-frontend"
    echo ""
    echo "FireSTARR will run as native binary at: $FIRESTARR_BINARY_PATH"
}

# ============================================
# Verification
# ============================================

verify_installation() {
    echo ""
    echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
    echo -e "${CYAN}              Installation Verification${NC}"
    echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
    echo ""

    local warnings=0
    local errors=0

    # Check .env
    if [ -f "$ENV_FILE" ] || [ "$DRY_RUN" = true ]; then
        print_success ".env file exists"
    else
        print_error ".env file not created"
        ((errors++))
    fi

    # Check dataset
    if [ -d "$FIRESTARR_DATASET_PATH/generated/grid" ]; then
        print_success "FireSTARR dataset installed"
    else
        print_warning "FireSTARR dataset not found"
        ((warnings++))
    fi

    # Infrastructure-specific checks
    if [ "$NOMAD_INFRA" = "docker" ]; then
        if [ "$DRY_RUN" = true ] || docker compose -f "$PROJECT_DIR/docker-compose.yaml" config &> /dev/null; then
            print_success "Docker Compose configuration valid"
        else
            print_error "Docker Compose configuration invalid"
            ((errors++))
        fi
    fi

    if [ "$NOMAD_INFRA" = "metal" ]; then
        if [ -d "$PROJECT_DIR/node_modules" ] || [ "$DRY_RUN" = true ]; then
            print_success "Node.js dependencies installed"
        else
            print_warning "Node.js dependencies not installed"
            ((warnings++))
        fi

        if [ -d "$PROJECT_DIR/backend/dist" ] && [ -d "$PROJECT_DIR/frontend/dist" ] || [ "$DRY_RUN" = true ]; then
            print_success "Applications built"
        else
            print_warning "Applications not built"
            ((warnings++))
        fi
    fi

    if [ "$FIRESTARR_INFRA" = "docker" ]; then
        if [ "$DRY_RUN" = true ]; then
            print_success "FireSTARR Docker image (dry run)"
        elif [ -n "$FIRESTARR_IMAGE" ] && docker image inspect "$FIRESTARR_IMAGE" &> /dev/null 2>&1; then
            print_success "FireSTARR Docker image available"
        else
            print_warning "FireSTARR Docker image not pulled"
            ((warnings++))
        fi
    fi

    if [ "$FIRESTARR_INFRA" = "metal" ]; then
        if [ -n "$FIRESTARR_BINARY_PATH" ] && [ -x "$FIRESTARR_BINARY_PATH" ]; then
            print_success "FireSTARR binary available"
        else
            print_warning "FireSTARR binary not configured"
            ((warnings++))
        fi
    fi

    echo ""
    if [ $errors -eq 0 ] && [ $warnings -eq 0 ]; then
        print_success "Verification complete - all checks passed"
    elif [ $errors -eq 0 ]; then
        print_warning "Verification complete - $warnings warning(s)"
    else
        print_error "Verification found $errors error(s) and $warnings warning(s)"
    fi

    return $errors
}

# ============================================
# Summary
# ============================================

print_summary() {
    echo ""
    echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
    echo -e "${CYAN}              Configuration Summary${NC}"
    echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
    echo ""
    echo "    Deployment Mode:         $NOMAD_DEPLOYMENT_MODE"
    echo "    Nomad Infrastructure:    $NOMAD_INFRA"
    echo "    FireSTARR Infrastructure: $FIRESTARR_INFRA"
    if [ "$DATASET_INSTALL_MODE" = "existing" ]; then
    echo "    Dataset Path:            $FIRESTARR_DATASET_PATH (existing)"
    elif [ "$DATASET_INSTALL_MODE" = "download" ]; then
    echo "    Dataset Path:            $FIRESTARR_DATASET_PATH (will download)"
    else
    echo "    Dataset Path:            $FIRESTARR_DATASET_PATH (skipped)"
    fi
    if [ -n "$FIRESTARR_IMAGE" ]; then
    echo "    FireSTARR Image:         $FIRESTARR_IMAGE"
    fi
    if [ "$FIRESTARR_INSTALL_MODE" = "archive" ]; then
    echo "    FireSTARR Archive:       $FIRESTARR_ARCHIVE_SOURCE"
    echo "    FireSTARR Install Dir:   $FIRESTARR_INSTALL_DIR"
    elif [ "$FIRESTARR_INSTALL_MODE" = "existing" ]; then
    echo "    FireSTARR Binary:        $FIRESTARR_BINARY_PATH (existing)"
    elif [ -n "$FIRESTARR_BINARY_PATH" ]; then
    echo "    FireSTARR Binary:        $FIRESTARR_BINARY_PATH"
    fi
    if [ "$NOMAD_DEPLOYMENT_MODE" = "ACN" ]; then
    echo "    Agency ID:               $NOMAD_AGENCY_ID"
    echo "    Database:                $NOMAD_DB_CLIENT://$NOMAD_DB_HOST:$NOMAD_DB_PORT/$NOMAD_DB_NAME"
    fi
    echo ""
}

# ============================================
# Main Function
# ============================================

main() {
    print_header

    # Change to project directory
    cd "$PROJECT_DIR"

    # Load existing .env if present
    if [ -f "$ENV_FILE" ]; then
        set -a
        source "$ENV_FILE"
        set +a
    fi

    # Run wizard
    step1_deployment_mode
    step2_infrastructure
    step3_paths

    # Show summary
    print_summary

    echo ""
    read -p "Proceed with installation? [Y/n] " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Nn]$ ]]; then
        print_info "Installation cancelled"
        exit 0
    fi

    # Git line ending check
    if ! check_git_autocrlf; then
        exit 1
    fi

    # Validate prerequisites
    if ! validate_prerequisites; then
        if [ "$DRY_RUN" = false ]; then
            print_error "Prerequisites not met. Please install required dependencies."
            exit 1
        fi
    fi

    # Run appropriate installation
    case "${NOMAD_INFRA}_${FIRESTARR_INFRA}" in
        docker_docker)
            install_all_docker
            ;;
        metal_metal)
            install_all_metal
            ;;
        docker_metal)
            install_nomad_docker_firestarr_metal
            ;;
        metal_docker)
            install_nomad_metal_firestarr_docker
            ;;
    esac

    # Verification
    verify_installation

    echo ""
    echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
    if [ "$DRY_RUN" = true ]; then
        print_info "Dry run complete - no changes were made"
    else
        print_success "Project Nomad setup complete!"
    fi
    echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
}

# Run main function
main "$@"
