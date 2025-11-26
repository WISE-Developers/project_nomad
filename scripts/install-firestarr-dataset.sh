#!/bin/bash
#
# FireSTARR Dataset Installer
# Downloads and installs the FireSTARR national dataset for fire modeling
#
# Usage:
#   ./scripts/install-firestarr-dataset.sh
#
# Configuration is read from .env file:
#   FIRESTARR_DATASET_SOURCE - URL or local path to dataset zip file
#   FIRESTARR_DATASET_PATH   - Local path to install dataset to
#

set -e

# Configuration file
ENV_FILE=".env"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_header() {
    echo -e "${BLUE}"
    echo "╔════════════════════════════════════════════════════════════╗"
    echo "║           FireSTARR Dataset Installer                      ║"
    echo "║           Project Nomad - Fire Modeling System             ║"
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

# Load configuration from .env
load_config() {
    if [ ! -f "$ENV_FILE" ]; then
        print_error "Configuration file not found: $ENV_FILE"
        echo ""
        echo "Create a .env file with:"
        echo "  FIRESTARR_DATASET_SOURCE=https://example.com/dataset.zip"
        echo "  FIRESTARR_DATASET_PATH=./firestarr_data"
        echo ""
        echo "Or copy from .env.example:"
        echo "  cp .env.example .env"
        exit 1
    fi

    # Source the .env file
    set -a
    source "$ENV_FILE"
    set +a

    # Validate required variables
    if [ -z "$FIRESTARR_DATASET_SOURCE" ]; then
        print_error "FIRESTARR_DATASET_SOURCE not set in $ENV_FILE"
        exit 1
    fi

    if [ -z "$FIRESTARR_DATASET_PATH" ]; then
        print_error "FIRESTARR_DATASET_PATH not set in $ENV_FILE"
        exit 1
    fi
}

# Check if source is a URL or local path
is_url() {
    local source="$1"
    [[ "$source" =~ ^https?:// ]] || [[ "$source" =~ ^ftp:// ]]
}

# Check for required tools
check_dependencies() {
    local missing=()

    # Only need curl/wget if source is a URL
    if is_url "$FIRESTARR_DATASET_SOURCE"; then
        if ! command -v curl &> /dev/null && ! command -v wget &> /dev/null; then
            missing+=("curl or wget")
        fi
    fi

    if ! command -v unzip &> /dev/null; then
        missing+=("unzip")
    fi

    if [ ${#missing[@]} -ne 0 ]; then
        print_error "Missing required tools: ${missing[*]}"
        echo "Please install them and try again."
        exit 1
    fi
}

# Download file with progress
download_file() {
    local url="$1"
    local output="$2"

    if command -v curl &> /dev/null; then
        curl -L --progress-bar -o "$output" "$url"
    elif command -v wget &> /dev/null; then
        wget --show-progress -O "$output" "$url"
    fi
}

# Clean up Mac artifacts and flatten nested root folder
cleanup_and_flatten() {
    local target_dir="$1"

    # Remove Mac artifacts
    if [ -d "$target_dir/__MACOSX" ]; then
        rm -rf "$target_dir/__MACOSX"
        print_success "Removed Mac artifacts (__MACOSX)"
    fi
    find "$target_dir" -name ".DS_Store" -delete 2>/dev/null || true

    # Check for single nested root folder (excluding sims which we create)
    local nested_dirs=()
    for dir in "$target_dir"/*/; do
        [ -d "$dir" ] || continue
        local dirname=$(basename "$dir")
        # Skip our sims directory
        if [ "$dirname" != "sims" ]; then
            nested_dirs+=("$dir")
        fi
    done

    # If exactly one directory found, check if it contains the actual data
    if [ ${#nested_dirs[@]} -eq 1 ]; then
        local nested="${nested_dirs[0]}"
        local nested_name=$(basename "$nested")

        # Check if this looks like a version folder (contains generated/ or other expected content)
        if [ -d "$nested/generated" ] || [ -f "$nested/README.txt" ] || [ -f "$nested/METADATA.txt" ]; then
            print_step "Flattening nested folder: $nested_name"

            # Move all contents up (including hidden files)
            shopt -s dotglob
            mv "$nested"/* "$target_dir/" 2>/dev/null || true
            shopt -u dotglob

            # Remove the now-empty nested folder
            rmdir "$nested" 2>/dev/null || rm -rf "$nested"

            # Clean any .DS_Store that came with the move
            find "$target_dir" -name ".DS_Store" -delete 2>/dev/null || true

            print_success "Flattened to $target_dir"
        fi
    fi
}

# Main installation
main() {
    print_header

    # Load configuration
    print_step "Loading configuration from $ENV_FILE..."
    load_config
    print_success "Configuration loaded"

    echo ""
    echo "  Source: $FIRESTARR_DATASET_SOURCE"
    echo "  Target: $FIRESTARR_DATASET_PATH"
    echo ""

    # Check dependencies
    print_step "Checking dependencies..."
    check_dependencies
    print_success "All dependencies found"

    # Check if already installed
    if [ -d "$FIRESTARR_DATASET_PATH/generated" ]; then
        print_warning "Dataset appears to be already installed at $FIRESTARR_DATASET_PATH"
        echo ""
        read -p "Reinstall? This will overwrite existing data. [y/N] " -n 1 -r
        echo ""
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            echo "Installation cancelled."
            exit 0
        fi
    fi

    # Create install directory
    print_step "Creating installation directory..."
    mkdir -p "$FIRESTARR_DATASET_PATH"
    print_success "Directory ready: $FIRESTARR_DATASET_PATH"

    # Get dataset (download if URL, use directly if local)
    if is_url "$FIRESTARR_DATASET_SOURCE"; then
        print_step "Downloading FireSTARR dataset..."
        echo "    This may take a while depending on your connection..."
        echo ""

        TEMP_FILE=$(mktemp)
        if download_file "$FIRESTARR_DATASET_SOURCE" "$TEMP_FILE"; then
            print_success "Download complete"
        else
            print_error "Download failed"
            rm -f "$TEMP_FILE"
            exit 1
        fi
        SOURCE_FILE="$TEMP_FILE"
        CLEANUP_TEMP=true
    else
        print_step "Using local dataset file..."
        if [ ! -f "$FIRESTARR_DATASET_SOURCE" ]; then
            print_error "Local file not found: $FIRESTARR_DATASET_SOURCE"
            exit 1
        fi
        print_success "Found: $FIRESTARR_DATASET_SOURCE"
        SOURCE_FILE="$FIRESTARR_DATASET_SOURCE"
        CLEANUP_TEMP=false
    fi

    # Extract dataset
    print_step "Extracting dataset..."
    unzip -q -o "$SOURCE_FILE" -d "$FIRESTARR_DATASET_PATH"
    print_success "Extraction complete"

    # Clean up temp file if we downloaded
    if [ "$CLEANUP_TEMP" = true ]; then
        rm -f "$TEMP_FILE"
    fi

    # Clean Mac artifacts and flatten nested root folder if present
    print_step "Cleaning up extraction..."
    cleanup_and_flatten "$FIRESTARR_DATASET_PATH"

    # Create sims directory for simulation outputs
    print_step "Creating sims directory..."
    mkdir -p "$FIRESTARR_DATASET_PATH/sims"
    print_success "Created $FIRESTARR_DATASET_PATH/sims"

    # Verify installation
    print_step "Verifying installation..."
    local errors=0

    if [ -d "$FIRESTARR_DATASET_PATH/generated/grid" ]; then
        local grid_count=$(find "$FIRESTARR_DATASET_PATH/generated/grid" -name "*.tif" 2>/dev/null | wc -l)
        print_success "Grid data found ($grid_count tiles)"
    else
        print_warning "Grid data not found at expected location"
        errors=$((errors + 1))
    fi

    if [ -d "$FIRESTARR_DATASET_PATH/generated/bounds" ]; then
        print_success "Boundary data found"
    else
        print_warning "Boundary data not found at expected location"
        errors=$((errors + 1))
    fi

    echo ""
    echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"

    if [ $errors -eq 0 ]; then
        print_success "Installation complete!"
    else
        print_warning "Installation complete with warnings"
    fi

    echo ""
    echo "Dataset installed to: $FIRESTARR_DATASET_PATH"
    echo ""
    echo "You can now run FireSTARR with:"
    echo "    docker compose up firestarr-app"
    echo ""
}

# Run main function
main "$@"
