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

# Check and install basic tools the installer itself needs
# This runs FIRST, before any menus, to avoid mid-install failures
check_installer_prerequisites() {
    print_step "Checking installer prerequisites..."

    # Tools the installer script itself needs
    local required_tools=(git curl tar unzip)
    local missing_tools=()

    for tool in "${required_tools[@]}"; do
        if ! command -v "$tool" &> /dev/null; then
            missing_tools+=("$tool")
        fi
    done

    if [ ${#missing_tools[@]} -eq 0 ]; then
        print_success "All installer prerequisites available"
        return 0
    fi

    # Try to auto-install on Linux
    if [[ "$OSTYPE" == "linux"* ]]; then
        print_step "Installing missing tools: ${missing_tools[*]}..."
        if sudo apt update -qq && sudo apt install -y -qq "${missing_tools[@]}"; then
            print_success "Installed: ${missing_tools[*]}"
            return 0
        else
            print_error "Failed to install: ${missing_tools[*]}"
        fi
    fi

    # macOS or failed Linux install - report what's missing
    if [[ "$OSTYPE" == "darwin"* ]]; then
        print_error "Missing tools: ${missing_tools[*]}"
        echo ""
        echo "    Install with: brew install ${missing_tools[*]}"
        echo ""
    fi

    exit 1
}

# Comprehensive dependency check for metal mode - checks EVERYTHING at once
check_metal_deps_early() {
    local missing=()
    local warnings=()

    # Node.js
    if ! command -v node &> /dev/null; then
        missing+=("node (Node.js >= 20)")
    else
        local node_major
        node_major=$(node -v 2>/dev/null | sed 's/v//' | cut -d. -f1)
        if [ -z "$node_major" ] || [ "$node_major" -lt 20 ]; then
            missing+=("node >= 20 (found: $(node -v 2>/dev/null || echo 'unknown'))")
        fi
    fi

    # npm
    if ! command -v npm &> /dev/null; then
        missing+=("npm")
    fi

    # NOTE: GDAL not required - FireSTARR bundles its own GDAL/PROJ

    # sqlite3 (for SAN mode database)
    if ! command -v sqlite3 &> /dev/null; then
        if [[ "$OSTYPE" == "linux"* ]]; then
            # Auto-install sqlite3 on Linux
            sudo apt install -y -qq sqlite3 2>/dev/null || missing+=("sqlite3")
        else
            missing+=("sqlite3")
        fi
    fi

    # Linux-specific: check glibc version
    if [[ "$OSTYPE" == "linux"* ]]; then
        local glibc_version
        glibc_version=$(ldd --version 2>/dev/null | head -1 | grep -oE '[0-9]+\.[0-9]+$' || echo "")
        if [ -n "$glibc_version" ]; then
            local glibc_major glibc_minor
            glibc_major=$(echo "$glibc_version" | cut -d. -f1)
            glibc_minor=$(echo "$glibc_version" | cut -d. -f2)
            if [ "$glibc_major" -lt 2 ] || { [ "$glibc_major" -eq 2 ] && [ "$glibc_minor" -lt 38 ]; }; then
                missing+=("glibc >= 2.38 (found: $glibc_version) - need Ubuntu 24.04+")
            fi
        fi

        # NOTE: FireSTARR is statically linked - no libproj/libtiff needed
    fi

    # Report all missing deps at once
    if [ ${#missing[@]} -gt 0 ]; then
        echo ""
        print_error "Missing dependencies for metal mode:"
        echo ""
        for dep in "${missing[@]}"; do
            echo "    ✖ $dep"
        done
        echo ""

        if [[ "$OSTYPE" == "linux"* ]]; then
            echo "    Install on Ubuntu/Debian:"
            echo "        sudo apt install nodejs npm sqlite3"
            echo ""
        elif [[ "$OSTYPE" == "darwin"* ]]; then
            echo "    Install on macOS:"
            echo "        brew install node sqlite3"
            echo ""
        fi

        return 1
    fi

    return 0
}

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
        if [[ "$OSTYPE" == "darwin"* ]]; then
            echo "      brew install node@$required_major"
        elif [[ "$OSTYPE" == "linux"* ]]; then
            echo "      # Using NodeSource (recommended):"
            echo "      curl -fsSL https://deb.nodesource.com/setup_$required_major.x | sudo -E bash -"
            echo "      sudo apt-get install -y nodejs"
            echo ""
            echo "      # Or using nvm:"
            echo "      curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash"
            echo "      nvm install $required_major"
        else
            echo "      Visit: https://nodejs.org/en/download/"
        fi
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
        if [[ "$OSTYPE" == "darwin"* ]]; then
            echo "      brew install node@$required_major"
        elif [[ "$OSTYPE" == "linux"* ]]; then
            echo "      # Using NodeSource:"
            echo "      curl -fsSL https://deb.nodesource.com/setup_$required_major.x | sudo -E bash -"
            echo "      sudo apt-get install -y nodejs"
            echo ""
            echo "      # Or using nvm:"
            echo "      nvm install $required_major && nvm use $required_major"
        else
            echo "      Visit: https://nodejs.org/en/download/"
        fi
        echo ""
        exit 1
    fi
}

# Check glibc version for FireSTARR binary compatibility (Linux only)
check_glibc_early() {
    # Only check on Linux
    [[ "$OSTYPE" != "linux"* ]] && return 0

    local required_version="2.34"
    local glibc_version

    # Get glibc version from ldd
    glibc_version=$(ldd --version 2>/dev/null | head -n1 | grep -oE '[0-9]+\.[0-9]+$')

    if [ -z "$glibc_version" ]; then
        print_warning "Could not detect glibc version"
        return 0
    fi

    # Compare versions (convert to comparable integers: 2.34 -> 234)
    local required_int=$(echo "$required_version" | tr -d '.')
    local current_int=$(echo "$glibc_version" | tr -d '.')

    if [ "$current_int" -lt "$required_int" ]; then
        echo ""
        print_error "glibc $glibc_version is installed, but >= $required_version is required for FireSTARR"
        echo ""
        echo "    The FireSTARR binary requires glibc >= $required_version."
        echo "    Your system has glibc $glibc_version."
        echo ""
        echo "    Options:"
        echo "      1. Upgrade to Ubuntu 22.04+ or a distro with glibc >= $required_version"
        echo "      2. Use Docker mode instead (recommended for older systems)"
        echo ""
        exit 1
    fi
}

# NOTE: FireSTARR binary is fully self-contained (statically linked)
# No external library dependencies beyond base system (libc, libstdc++, libgcc_s)

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

    echo -e "    ${GREEN}1) Docker (Recommended)${NC}"
    echo "       Everything runs in containers"
    echo "       - Easiest setup, consistent across platforms"
    echo "       - Requires: Docker Desktop or Docker Engine"
    echo ""
    echo -e "    ${YELLOW}2) Metal${NC}"
    echo "       Everything runs natively on host"
    echo "       - Maximum performance, no containerization overhead"
    echo "       - Requires: Node.js >= 20, GDAL libraries, FireSTARR binary"
    echo ""

    local choice
    choice=$(get_selection 2 1)

    case $choice in
        1)
            NOMAD_INFRA="docker"
            FIRESTARR_INFRA="docker"
            FIRESTARR_EXECUTION_MODE="docker"
            print_success "Selected: Docker"
            ;;
        2)
            # Check ALL metal dependencies at once - fail fast with complete list
            if ! check_metal_deps_early; then
                echo ""
                print_error "Cannot proceed with metal mode - missing dependencies"
                echo ""
                echo "    Options:"
                echo "      1. Install the missing dependencies and re-run installer"
                echo "      2. Re-run installer and choose Docker mode instead"
                echo ""
                exit 1
            fi
            NOMAD_INFRA="metal"
            FIRESTARR_INFRA="metal"
            FIRESTARR_EXECUTION_MODE="binary"
            print_success "Selected: Metal - all dependencies satisfied"
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
    echo "       Point to an already-installed FireSTARR dataset"
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

# Option 2: Download new dataset - get download folder and install path
prompt_new_dataset_path() {
    echo ""
    echo -e "${CYAN}Dataset Archive Download Folder${NC}"
    echo "    Where to save the downloaded archive file (~50GB)."
    echo "    The archive is preserved for future reinstalls."
    echo ""

    local default_download="${FIRESTARR_DOWNLOAD_DIR:-$HOME/Downloads}"
    read -p "Download folder [$default_download]: " input_download
    input_download="${input_download:-$default_download}"

    # Expand ~ if present
    input_download="${input_download/#\~/$HOME}"

    # Convert to absolute path
    if [[ ! "$input_download" = /* ]]; then
        input_download="$(pwd)/$input_download"
    fi

    FIRESTARR_DOWNLOAD_DIR="$input_download"
    print_success "Archive will be downloaded to: $FIRESTARR_DOWNLOAD_DIR"

    echo ""
    echo -e "${CYAN}Dataset Install Location${NC}"
    echo "    Where to extract and install the dataset."
    echo ""

    local default_dataset="${FIRESTARR_DATASET_PATH:-$HOME/firestarr_data}"
    read -p "Install path [$default_dataset]: " input_dataset
    input_dataset="${input_dataset:-$default_dataset}"

    # Expand ~ if present
    input_dataset="${input_dataset/#\~/$HOME}"

    # Convert to absolute path
    if [[ ! "$input_dataset" = /* ]]; then
        input_dataset="$(pwd)/$input_dataset"
    fi

    FIRESTARR_DATASET_PATH="$input_dataset"
    print_success "Dataset will be installed to: $FIRESTARR_DATASET_PATH"
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

    # Port configuration (metal Nomad only)
    if [ "$NOMAD_INFRA" = "metal" ]; then
        echo -e "${CYAN}Server Port Configuration${NC}"
        echo "    Port for the Nomad server (serves both API and UI in production)."
        echo ""
        read -p "Server port [4901]: " input_port
        NOMAD_PORT="${input_port:-4901}"
        print_success "Server port: $NOMAD_PORT"
        echo ""

        echo -e "${CYAN}Server Hostname${NC}"
        echo "    The hostname or IP address users will use to access Nomad."
        echo "    For local-only access, use 'localhost'."
        echo "    For network access, use the server's IP or hostname."
        echo ""
        read -p "Server hostname [localhost]: " input_hostname
        NOMAD_SERVER_HOSTNAME="${input_hostname:-localhost}"
        print_success "Server hostname: $NOMAD_SERVER_HOSTNAME"
        echo ""
    fi

    # Port configuration (Docker Nomad)
    if [ "$NOMAD_INFRA" = "docker" ]; then
        echo -e "${CYAN}Docker Port Configuration${NC}"
        echo "    Host ports for accessing Nomad containers."
        echo ""
        read -p "Frontend port (web UI) [3901]: " input_frontend_port
        NOMAD_FRONTEND_HOST_PORT="${input_frontend_port:-3901}"
        print_success "Frontend port: $NOMAD_FRONTEND_HOST_PORT"
        echo ""
        read -p "Backend port (API) [4901]: " input_backend_port
        NOMAD_BACKEND_HOST_PORT="${input_backend_port:-4901}"
        print_success "Backend port: $NOMAD_BACKEND_HOST_PORT"
        echo ""

        echo -e "${CYAN}Server Hostname${NC}"
        echo "    The hostname or IP address users will use to access Nomad."
        echo "    For local development, use 'localhost'."
        echo "    For remote servers, use the server's domain or IP (e.g., myserver.com)."
        echo ""
        # Try to detect hostname
        local detected_hostname
        detected_hostname=$(hostname -f 2>/dev/null || hostname 2>/dev/null || echo "localhost")
        read -p "Server hostname [$detected_hostname]: " input_hostname
        NOMAD_SERVER_HOSTNAME="${input_hostname:-$detected_hostname}"
        print_success "Server hostname: $NOMAD_SERVER_HOSTNAME"
        echo ""
    fi

    # MapBox API Token
    echo -e "${CYAN}MapBox Access Token${NC}"
    echo "    Required for map display. The map will not render without a valid token."
    echo ""
    echo "    To get a free MapBox token:"
    echo "      1. Go to https://account.mapbox.com/auth/signup/"
    echo "      2. Create a free account (no credit card required)"
    echo "      3. Go to https://account.mapbox.com/access-tokens/"
    echo "      4. Copy your default public token or create a new one"
    echo ""
    read -p "MapBox token (or press Enter to skip): " input_mapbox
    if [ -n "$input_mapbox" ]; then
        MAPBOX_TOKEN="$input_mapbox"
        print_success "MapBox token configured"
    else
        print_warning "MapBox token not set - maps won't render until configured"
        echo "    You can add it later to .env as: VITE_MAPBOX_TOKEN=your_token"
    fi
    echo ""

    # FireSTARR binary source (metal FireSTARR only)
    if [ "$FIRESTARR_INFRA" = "metal" ]; then
        prompt_firestarr_binary_source
        echo ""
    fi
}

# ============================================
# GDAL Validation (for Nomad backend)
# ============================================

# Validate GDAL installation for metal mode
# The Nomad backend uses gdal-async npm package for contour generation
# which requires native GDAL libraries (gdal-bin, libgdal-dev)
validate_gdal() {
    print_step "Checking GDAL installation..."

    # Check if gdalinfo is available (indicates gdal-bin is installed)
    if ! command -v gdalinfo &> /dev/null; then
        print_error "GDAL is required but not installed"
        echo ""
        echo "    The Nomad backend requires GDAL for contour generation."
        echo "    (Note: This is separate from FireSTARR which bundles its own GDAL)"
        echo ""

        # Offer to install on supported platforms
        if [[ "$OSTYPE" == "linux"* ]]; then
            if command -v apt-get &> /dev/null; then
                echo "    Install with: sudo apt-get install gdal-bin libgdal-dev"
                echo ""
                read -p "Would you like to install GDAL now? [y/N]: " install_gdal
                if [[ "$install_gdal" =~ ^[Yy] ]]; then
                    print_step "Installing GDAL..."
                    if sudo apt-get update && sudo apt-get install -y gdal-bin libgdal-dev; then
                        print_success "GDAL installed successfully"
                        return 0
                    else
                        print_error "Failed to install GDAL"
                        return 1
                    fi
                fi
            else
                echo "    Install GDAL using your package manager (dnf, yum, pacman, etc.)"
            fi
        elif [[ "$OSTYPE" == "darwin"* ]]; then
            echo "    Install with Homebrew: brew install gdal"
        fi
        return 1
    fi

    # Get GDAL version
    local gdal_version
    gdal_version=$(gdalinfo --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+' | head -1)

    if [ -n "$gdal_version" ]; then
        local gdal_major
        gdal_major=$(echo "$gdal_version" | cut -d. -f1)

        # Require GDAL 3.x for gdal-async compatibility
        if [ "$gdal_major" -lt 3 ]; then
            print_warning "GDAL version $gdal_version is old (recommend >= 3.0)"
            echo "    The gdal-async npm package works best with GDAL 3.x"
            return 0  # Warning only, don't fail
        else
            print_success "GDAL $gdal_version available"
        fi
    else
        print_success "GDAL available (version unknown)"
    fi

    # Check for development headers (needed for npm install of gdal-async)
    if [[ "$OSTYPE" == "linux"* ]]; then
        if ! pkg-config --exists gdal 2>/dev/null; then
            print_warning "GDAL development headers may be missing"
            echo "    Install with: sudo apt-get install libgdal-dev"
            echo "    Required for building gdal-async npm package"
        fi
    fi

    return 0
}

# ============================================
# Disk Space Validation
# ============================================

# Check available disk space for a given path
# Args: $1 = path, $2 = required_gb, $3 = description
# Returns: 0 if sufficient, 1 if insufficient
check_disk_space() {
    local path="$1"
    local required_gb="$2"
    local description="${3:-this location}"

    # Find the mount point for this path (use parent if path doesn't exist yet)
    local check_path="$path"
    while [ ! -d "$check_path" ] && [ "$check_path" != "/" ]; do
        check_path=$(dirname "$check_path")
    done

    # Get available space in GB
    local available_kb available_gb
    if [[ "$OSTYPE" == "darwin"* ]]; then
        available_kb=$(df -k "$check_path" | tail -1 | awk '{print $4}')
    else
        available_kb=$(df -k "$check_path" | tail -1 | awk '{print $4}')
    fi
    available_gb=$((available_kb / 1024 / 1024))

    if [ "$available_gb" -lt "$required_gb" ]; then
        print_error "Insufficient disk space for $description"
        echo "    Path: $path"
        echo "    Available: ${available_gb}GB"
        echo "    Required: ${required_gb}GB"
        echo ""
        return 1
    else
        print_success "Disk space OK for $description (${available_gb}GB available, ${required_gb}GB needed)"
        return 0
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
        else
            # Check Docker version (minimum 20.10)
            local docker_version
            docker_version=$(docker --version | grep -oE '[0-9]+\.[0-9]+' | head -1)
            local docker_major docker_minor
            docker_major=$(echo "$docker_version" | cut -d. -f1)
            docker_minor=$(echo "$docker_version" | cut -d. -f2)

            if [ "$docker_major" -lt 20 ] || { [ "$docker_major" -eq 20 ] && [ "$docker_minor" -lt 10 ]; }; then
                print_error "Docker version $docker_version is too old (need >= 20.10)"
                echo "    Update Docker: https://docs.docker.com/engine/install/"
                ((errors++))
            else
                print_success "Docker $docker_version available"
            fi

            # Check Docker Compose
            if ! docker compose version &> /dev/null; then
                print_error "Docker Compose v2 is required but not available"
                echo "    Install: apt-get install docker-compose-plugin"
                echo "    Or: https://docs.docker.com/compose/install/"
                ((errors++))
            else
                local compose_version
                compose_version=$(docker compose version | grep -oE '[0-9]+\.[0-9]+' | head -1)
                local compose_major
                compose_major=$(echo "$compose_version" | cut -d. -f1)

                if [ "$compose_major" -lt 2 ]; then
                    print_error "Docker Compose v$compose_version is too old (need v2+)"
                    echo "    Install: apt-get install docker-compose-plugin"
                    ((errors++))
                else
                    print_success "Docker Compose v$compose_version available"
                fi
            fi
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

        # GDAL check (required for Nomad backend contour generation)
        if ! validate_gdal; then
            ((errors++))
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

    # Disk space validation
    echo ""
    print_step "Checking disk space..."

    # Check dataset path (need ~45GB for dataset)
    if [ -n "$FIRESTARR_DATASET_PATH" ] && [ "$DATASET_INSTALL_MODE" = "download" ]; then
        if ! check_disk_space "$FIRESTARR_DATASET_PATH" 45 "FireSTARR dataset"; then
            ((errors++))
        fi
    elif [ -n "$FIRESTARR_DATASET_PATH" ]; then
        # Existing dataset - just need space for sims (~5GB minimum)
        if ! check_disk_space "$FIRESTARR_DATASET_PATH" 5 "simulation outputs"; then
            ((errors++))
        fi
    fi

    # Check download directory if downloading to a DIFFERENT disk
    # (if same disk, the 45GB check above already covers the temporary archive space)
    if [ -n "$FIRESTARR_DOWNLOAD_DIR" ] && [ "$DATASET_INSTALL_MODE" = "download" ]; then
        # Ensure directories exist for mount comparison
        mkdir -p "$FIRESTARR_DOWNLOAD_DIR" 2>/dev/null
        mkdir -p "$FIRESTARR_DATASET_PATH" 2>/dev/null

        local dataset_mount download_mount
        dataset_mount=$(df "$FIRESTARR_DATASET_PATH" 2>/dev/null | tail -1 | awk '{print $1}')
        download_mount=$(df "$FIRESTARR_DOWNLOAD_DIR" 2>/dev/null | tail -1 | awk '{print $1}')

        # Only check download dir space if on different mount AND we got valid mount info
        if [ -n "$dataset_mount" ] && [ -n "$download_mount" ] && [ "$dataset_mount" != "$download_mount" ]; then
            if ! check_disk_space "$FIRESTARR_DOWNLOAD_DIR" 45 "dataset download"; then
                ((errors++))
            fi
        fi
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

has_avx() {
    local arch
    arch=$(uname -m)

    if [ "$arch" = "x86_64" ]; then
        if [ -f /proc/cpuinfo ]; then
            # Check for AVX (but not AVX2 specifically - just base AVX)
            if grep -qE '\bavx\b' /proc/cpuinfo; then
                return 0
            fi
        fi
        if command -v sysctl &> /dev/null; then
            if sysctl -n machdep.cpu.features 2>/dev/null | grep -qi "AVX"; then
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
    DETECTED_AVX=false
    DETECTED_QEMU=false

    if is_colima; then
        DETECTED_COLIMA=true
    fi

    if has_avx2; then
        DETECTED_AVX2=true
        DETECTED_AVX=true  # AVX2 implies AVX
    elif has_avx; then
        DETECTED_AVX=true
    fi

    # Detect QEMU virtual CPU
    if [ -f /proc/cpuinfo ] && grep -qi "QEMU" /proc/cpuinfo; then
        DETECTED_QEMU=true
    fi

    # Determine recommended image based on detection
    # Images from CWFMF firestarr-cpp repository
    case "$arch" in
        arm64|aarch64)
            RECOMMENDED_IMAGE="ghcr.io/cwfmf/firestarr-cpp/firestarr:latest-arm64"
            ;;
        x86_64)
            if [ "$DETECTED_AVX2" = true ] || [ "$DETECTED_AVX" = true ]; then
                RECOMMENDED_IMAGE="ghcr.io/cwfmf/firestarr-cpp/firestarr:latest"
            else
                # No AVX - cannot run FireSTARR
                RECOMMENDED_IMAGE=""
            fi
            ;;
        *)
            RECOMMENDED_IMAGE="ghcr.io/cwfmf/firestarr-cpp/firestarr:latest"
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
    echo "    AVX Support:       $([ "$DETECTED_AVX" = true ] && echo "Yes" || echo "No")"
    echo "    Docker via Colima: $([ "$DETECTED_COLIMA" = true ] && echo "Yes" || echo "No")"
    if [ "$DETECTED_QEMU" = true ]; then
    echo "    QEMU Virtual CPU:  Yes"
    fi
    echo ""

    # Check if CPU meets minimum requirements (AVX required for x86_64)
    if [ "$DETECTED_ARCH" = "x86_64" ] && [ "$DETECTED_AVX" = false ]; then
        print_error "CPU does not support AVX instructions"
        echo ""
        echo "    FireSTARR requires a CPU with AVX support (2011 or newer)."
        echo ""
        if [ "$DETECTED_QEMU" = true ]; then
            echo "    This appears to be a QEMU virtual machine with a basic CPU profile."
            echo "    To run FireSTARR, configure your VM with a CPU that supports AVX:"
            echo ""
            echo "    Option 1: Use host CPU passthrough (best performance)"
            echo "        -cpu host"
            echo ""
            echo "    Option 2: Use a specific CPU model with AVX"
            echo "        -cpu SandyBridge    (minimum for AVX)"
            echo "        -cpu Haswell        (recommended, includes AVX2)"
            echo ""
        else
            echo "    This CPU is too old to run FireSTARR."
            echo "    Consider running on newer hardware or a VM with AVX-capable CPU."
        fi
        return 1
    fi

    # Expand VERSION in recommended image
    local expanded_image
    expanded_image=$(eval echo "$RECOMMENDED_IMAGE")

    echo "Available FireSTARR images:"
    echo ""
    echo "    1) Recommended: $expanded_image"
    echo "    2) x86_64 (Linux/Windows):   ghcr.io/cwfmf/firestarr-cpp/firestarr:latest"
    echo "    3) ARM64 (Apple Silicon):    ghcr.io/cwfmf/firestarr-cpp/firestarr:latest-arm64"
    echo "    4) Enter custom image"
    echo ""
    read -p "Select an option [1-4] (default: 1): " choice

    case "${choice:-1}" in
        1)
            FIRESTARR_IMAGE="$expanded_image"
            ;;
        2)
            FIRESTARR_IMAGE="ghcr.io/cwfmf/firestarr-cpp/firestarr:latest"
            ;;
        3)
            FIRESTARR_IMAGE="ghcr.io/cwfmf/firestarr-cpp/firestarr:latest-arm64"
            ;;
        4)
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

# Get default FireSTARR binary URL for the current platform
# Returns the GitHub release URL for firestarr-latest
get_default_firestarr_url() {
    local arch os_name
    arch=$(uname -m)
    os_name=$(uname -s | tr '[:upper:]' '[:lower:]')

    # local base_url="https://github.com/WISE-Developers/project_nomad/releases/download/firestarr-latest"
    local base_url="https://github.com/CWFMF/firestarr-cpp/releases/download/firestarr-latest"
    
    local asset_name=""

    case "$os_name" in
        darwin)
            # macOS - only ARM64 builds available
            # asset_name="firestarr-macos-arm64.tar.gz"
            asset_name="firestarr-macos-arm64-clang-Release.tar.gz"
            ;;
        linux)
            # Linux - use Ubuntu 22.04 build (broader glibc compatibility)
            # asset_name="firestarr-linux-ubuntu-22.04.tar.gz"
            asset_name="firestarr-ubuntu-x64-gcc-Release.tar.gz"

            ;;
        msys*|mingw*|cygwin*|windows*)
            # Windows
            # asset_name="firestarr-windows-x64.zip"
            asset_name="firestarr-windows-x64-cl-Release.zip"

            ;;
        *)
            # Unknown OS - return empty
            echo ""
            return 1
            ;;
    esac

    echo "${base_url}/${asset_name}"
    return 0
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
        echo "    Nomad will update RASTER_ROOT and FUEL_LOOKUP_TABLE to point to the Nomad dataset."
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

    # Get platform-specific default URL
    local default_url
    default_url=$(get_default_firestarr_url)

    if [ -n "$default_url" ]; then
        echo "    A pre-built FireSTARR binary is available for your platform."
        echo "    Press Enter to download from GitHub, or provide a custom path/URL."
        echo ""
        echo "    Default: $default_url"
        echo ""
        read -p "Archive location [Enter for default]: " archive_source

        # Use default if empty
        if [ -z "$archive_source" ]; then
            archive_source="$default_url"
            print_info "Using pre-built binary from GitHub releases"
        fi
    else
        echo "    Provide a FireSTARR distribution archive (.tar.gz or .zip)"
        echo "    This can be a local file path or a URL"
        echo ""
        read -p "Archive location: " archive_source

        if [ -z "$archive_source" ]; then
            print_warning "No archive provided"
            return 1
        fi
    fi

    # Expand ~ if present
    archive_source="${archive_source/#\~/$HOME}"

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
        # Preserve original extension from URL for correct extraction
        local url_ext=""
        if [[ "$archive_source" =~ \.(tar\.gz|tgz)$ ]]; then
            url_ext=".tar.gz"
        elif [[ "$archive_source" =~ \.tar$ ]]; then
            url_ext=".tar"
        elif [[ "$archive_source" =~ \.zip$ ]]; then
            url_ext=".zip"
        else
            url_ext=".zip"  # Default fallback
        fi
        archive_file="/tmp/firestarr_download_$$${url_ext}"

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
        # Look for firestarr binary (check both Unix and Windows names)
        binary_path=$(find "$install_dir" -name "firestarr" -type f 2>/dev/null | head -1)

        if [ -z "$binary_path" ]; then
            # Try Windows .exe extension
            binary_path=$(find "$install_dir" -name "firestarr.exe" -type f 2>/dev/null | head -1)
        fi

        if [ -z "$binary_path" ]; then
            # Try case-insensitive (Unix)
            binary_path=$(find "$install_dir" -iname "firestarr" -type f 2>/dev/null | head -1)
        fi

        if [ -z "$binary_path" ]; then
            # Try case-insensitive (Windows)
            binary_path=$(find "$install_dir" -iname "firestarr.exe" -type f 2>/dev/null | head -1)
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

    # Configure settings.ini in the same directory as the binary
    local binary_dir
    binary_dir=$(dirname "$binary_path")
    local settings_file="$binary_dir/settings.ini"
    local raster_root="$dataset_path/generated/grid/100m"

    print_step "Configuring settings.ini..."
    if [ "$DRY_RUN" = true ]; then
        print_dry_run "Would configure $settings_file with RASTER_ROOT = $raster_root"
    else
        if [ -f "$settings_file" ]; then
            # Archive included settings.ini - update RASTER_ROOT preserving other settings
            local backup="$settings_file.backup.$(date +%Y%m%d_%H%M%S)"
            cp "$settings_file" "$backup"
            print_info "Backed up existing settings.ini to $backup"

            # Update RASTER_ROOT
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

            # Update FUEL_LOOKUP_TABLE to absolute path
            local fuel_lut_path="$dataset_path/fuel.lut"
            if grep -q "^FUEL_LOOKUP_TABLE" "$settings_file"; then
                if [[ "$OSTYPE" == "darwin"* ]]; then
                    sed -i '' "s|^FUEL_LOOKUP_TABLE.*|FUEL_LOOKUP_TABLE = $fuel_lut_path|" "$settings_file"
                else
                    sed -i "s|^FUEL_LOOKUP_TABLE.*|FUEL_LOOKUP_TABLE = $fuel_lut_path|" "$settings_file"
                fi
            else
                echo "FUEL_LOOKUP_TABLE = $fuel_lut_path" >> "$settings_file"
            fi
            print_info "Updated RASTER_ROOT and FUEL_LOOKUP_TABLE in existing settings.ini"
        else
            # No settings.ini in archive - create new one with required settings
            cat > "$settings_file" << EOF
# FireSTARR settings - generated by Project Nomad installer
# $(date)

RASTER_ROOT = $raster_root
FUEL_LOOKUP_TABLE = $dataset_path/fuel.lut
EOF
            print_info "Created new settings.ini with RASTER_ROOT and FUEL_LOOKUP_TABLE"
        fi
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
    local fuel_lut_path="$dataset_path/fuel.lut"

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

        # Update FUEL_LOOKUP_TABLE to absolute path
        if grep -q "^FUEL_LOOKUP_TABLE" "$settings_file"; then
            if [[ "$OSTYPE" == "darwin"* ]]; then
                sed -i '' "s|^FUEL_LOOKUP_TABLE.*|FUEL_LOOKUP_TABLE = $fuel_lut_path|" "$settings_file"
            else
                sed -i "s|^FUEL_LOOKUP_TABLE.*|FUEL_LOOKUP_TABLE = $fuel_lut_path|" "$settings_file"
            fi
        else
            echo "FUEL_LOOKUP_TABLE = $fuel_lut_path" >> "$settings_file"
        fi
    else
        # Create new settings.ini with required settings
        cat > "$settings_file" << EOF
# FireSTARR settings - generated by Project Nomad installer
# $(date)

RASTER_ROOT = $raster_root
FUEL_LOOKUP_TABLE = $fuel_lut_path
EOF
    fi

    print_success "settings.ini configured with RASTER_ROOT and FUEL_LOOKUP_TABLE"
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

    if [ -n "$NOMAD_PORT" ]; then
        update_env_value "PORT" "$NOMAD_PORT"
        # Metal mode: set API URL using configured hostname and port
        local metal_hostname="${NOMAD_SERVER_HOSTNAME:-localhost}"
        update_env_value "VITE_API_PORT" "$NOMAD_PORT"
        update_env_value "VITE_API_BASE_URL" "http://${metal_hostname}:${NOMAD_PORT}"
    fi

    if [ -n "$NOMAD_FRONTEND_HOST_PORT" ]; then
        update_env_value "NOMAD_FRONTEND_HOST_PORT" "$NOMAD_FRONTEND_HOST_PORT"
    fi

    if [ -n "$NOMAD_BACKEND_HOST_PORT" ]; then
        update_env_value "NOMAD_BACKEND_HOST_PORT" "$NOMAD_BACKEND_HOST_PORT"
    fi

    # Set API base URL for Docker deployments (frontend needs to know where backend is)
    # Only apply in Docker mode - metal mode already set these correctly above
    if [ "$NOMAD_INFRA" = "docker" ] && [ -n "$NOMAD_SERVER_HOSTNAME" ] && [ -n "$NOMAD_BACKEND_HOST_PORT" ]; then
        update_env_value "VITE_API_BASE_URL" "http://${NOMAD_SERVER_HOSTNAME}:${NOMAD_BACKEND_HOST_PORT}"
        update_env_value "VITE_API_PORT" "$NOMAD_BACKEND_HOST_PORT"
    fi

    if [ -n "$MAPBOX_TOKEN" ]; then
        update_env_value "VITE_MAPBOX_TOKEN" "$MAPBOX_TOKEN"
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

    # Export download dir so dataset script can use it
    export FIRESTARR_DOWNLOAD_DIR
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
        if ! configure_firestarr_image; then
            print_error "Cannot proceed - CPU does not meet FireSTARR requirements"
            exit 1
        fi
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

    # 5. Verify disk space for Docker images (need ~10GB)
    echo ""
    print_step "Checking remaining disk space for Docker images..."
    if ! check_disk_space "$FIRESTARR_DATASET_PATH" 10 "Docker images"; then
        print_error "Insufficient disk space remaining for Docker images"
        echo "    Docker needs ~10GB to build/pull images for frontend, backend, and FireSTARR."
        echo "    Free up disk space or use a larger volume before continuing."
        exit 1
    fi

    # 6. Pull/build Docker images
    print_step "Building/pulling Docker images..."
    run_cmd docker compose -f "$PROJECT_DIR/docker-compose.yaml" build
    run_cmd docker compose -f "$PROJECT_DIR/docker-compose.yaml" pull firestarr-app

    print_success "All Docker installation complete!"
    echo ""
    echo "To start Project Nomad:"
    echo "    cd $PROJECT_DIR"
    echo "    docker compose up -d"
    echo ""
    source "$ENV_FILE"
    local access_hostname="${NOMAD_SERVER_HOSTNAME:-localhost}"
    echo "Access Nomad at: http://${access_hostname}:$NOMAD_FRONTEND_HOST_PORT"
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

    # 6. Install Node.js dependencies
    print_step "Installing Node.js dependencies..."
    run_cmd npm --prefix "$PROJECT_DIR" install

    # 8. Clear Vite cache to ensure fresh build with new .env values
    print_step "Clearing Vite cache..."
    rm -rf "$PROJECT_DIR/frontend/node_modules/.vite" "$PROJECT_DIR/frontend/dist" 2>/dev/null || true

    # 9. Build backend and frontend
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
    echo "Access at: http://${NOMAD_SERVER_HOSTNAME:-localhost}:${NOMAD_PORT:-4901}"
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
    if [ -n "$NOMAD_PORT" ]; then
    echo "    Server Port:             $NOMAD_PORT"
    fi
    if [ -n "$NOMAD_SERVER_HOSTNAME" ]; then
    echo "    Server Hostname:         $NOMAD_SERVER_HOSTNAME"
    fi
    if [ -n "$NOMAD_FRONTEND_HOST_PORT" ]; then
    echo "    Frontend Port:           $NOMAD_FRONTEND_HOST_PORT"
    fi
    if [ -n "$NOMAD_BACKEND_HOST_PORT" ]; then
    echo "    Backend Port:            $NOMAD_BACKEND_HOST_PORT"
    fi
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

    # Check installer's own prerequisites FIRST (git, curl, tar, unzip)
    check_installer_prerequisites

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
    case "$NOMAD_INFRA" in
        docker)
            install_all_docker
            ;;
        metal)
            install_all_metal
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
