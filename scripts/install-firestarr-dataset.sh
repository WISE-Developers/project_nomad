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

print_info() {
    echo -e "${BLUE}ℹ${NC} $1"
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

    # Validate required variables. Either the year-picker index OR a single
    # source must be configured.
    if [ -z "$FIRESTARR_DATASET_SOURCE" ] && [ -z "$FIRESTARR_DATASET_INDEX" ]; then
        print_error "Set FIRESTARR_DATASET_INDEX (year picker) or FIRESTARR_DATASET_SOURCE (single dataset) in $ENV_FILE"
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
# ============================================================================
# Index-driven year picker (#312/#319)
# Enabled when FIRESTARR_DATASET_INDEX points at an index.json listing per-year
# fuel datasets. Downloads the selected year(s), verifies each sha256, and
# installs each into generated/grid/100m/{year}/ so multiple vintages coexist
# and FireSTARR auto-selects the dataset matching the model's run year.
# ============================================================================

# sha256 of a file (portable: shasum on macOS, sha256sum on Linux).
sha256_of() {
    if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}'
    elif command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
    else echo ""; fi
}

# Fetch the index (URL or local path) to stdout.
fetch_index() {
    local src="$1"
    if is_url "$src"; then
        if command -v curl >/dev/null 2>&1; then curl -fsSL "$src"
        elif command -v wget >/dev/null 2>&1; then wget -qO- "$src"
        else return 1; fi
    else
        [ -f "$src" ] && cat "$src"
    fi
}

# Extract a scalar value for a top-level key ("baseUrl", "default", ...).
json_scalar() {
    printf '%s\n' "$1" | grep -m1 "\"$2\"" \
        | sed -E "s/.*\"$2\"[[:space:]]*:[[:space:]]*\"?([^\",}]+)\"?.*/\1/" \
        | sed -E 's/[[:space:]]+$//'
}

# Emit one "vintage<TAB>file<TAB>sha256<TAB>bytes" line per dataset (each dataset
# object is on its own line in the index). bytes is 0 when the index omits it.
parse_datasets() {
    printf '%s\n' "$1" | grep '"vintage"' | while IFS= read -r line; do
        local v f s b
        v=$(printf '%s' "$line" | sed -E 's/.*"vintage"[[:space:]]*:[[:space:]]*([0-9]+).*/\1/')
        f=$(printf '%s' "$line" | sed -E 's/.*"file"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')
        s=$(printf '%s' "$line" | sed -E 's/.*"sha256"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')
        b=$(printf '%s' "$line" | grep -o '"bytes"[[:space:]]*:[[:space:]]*[0-9]*' \
            | sed -E 's/.*:[[:space:]]*//')
        [ -n "$b" ] || b=0
        [ -n "$v" ] && printf '%s\t%s\t%s\t%s\n' "$v" "$f" "$s" "$b"
    done
}

# Total download bytes for the chosen years.
#   $1 = rows from parse_datasets, $2 = space/newline separated years
# Years absent from the index contribute 0 — they're reported separately when
# the install loop skips them.
bytes_for_years() {
    local rows="$1" years="$2" total=0 y b
    for y in $years; do
        b=$(printf '%s\n' "$rows" | awk -F'\t' -v y="$y" '$1==y{print $4; exit}')
        [ -n "$b" ] || b=0
        total=$((total + b))
    done
    printf '%s\n' "$total"
}

# Render bytes as GB with one decimal, using integer math only (bash 3, no bc).
format_bytes() {
    local bytes="${1:-0}" whole tenths
    whole=$((bytes / 1000000000))
    tenths=$(( (bytes % 1000000000) / 100000000 ))
    printf '%s.%s GB\n' "$whole" "$tenths"
}

# True (0) when path's filesystem has at least $2 bytes free.
#   $1 = target path (may not exist yet), $2 = required bytes
have_free_space() {
    local path="$1" required="$2" check_path avail_kb avail_bytes

    # Walk up to the nearest existing directory — the target is usually not
    # created yet, and df on a missing path reports nothing useful.
    check_path="$path"
    while [ ! -d "$check_path" ] && [ "$check_path" != "/" ]; do
        check_path=$(dirname "$check_path")
    done

    avail_kb=$(df -k "$check_path" 2>/dev/null | tail -1 | awk '{print $4}')
    # Unreadable df: report failure rather than assuming there's room.
    [ -n "$avail_kb" ] || return 1

    avail_bytes=$((avail_kb * 1024))
    [ "$avail_bytes" -ge "$required" ]
}

# Install one downloaded flat zip into the multi-year layout.
#   $1 = zip file, $2 = vintage
# Extracts to same-filesystem staging (fast mv), then places:
#   generated/grid/100m/{year}/  (tiles + per-year dataset.json/checksums.txt)
#   fuel.lut                      (shared at root)
install_one_year() {
    local zip="$1" year="$2"
    local dst="$FIRESTARR_DATASET_PATH"
    local stage="$dst/.staging_${year}"
    rm -rf "$stage"; mkdir -p "$stage"
    unzip -q -o "$zip" -d "$stage"

    mkdir -p "$dst/generated/grid/100m"
    # Pre-clean this year's folder so stale tiles from a prior edition can't linger.
    rm -rf "$dst/generated/grid/100m/$year"
    mv "$stage/generated/grid/100m/$year" "$dst/generated/grid/100m/$year"
    # Shared lut at root.
    [ -f "$stage/fuel.lut" ] && cp "$stage/fuel.lut" "$dst/fuel.lut"
    # Keep per-year provenance with the year (avoids root collisions across years).
    for m in dataset.json checksums.txt; do
        [ -f "$stage/$m" ] && mv "$stage/$m" "$dst/generated/grid/100m/$year/$m"
    done
    rm -rf "$stage"
}

# Interactive/headless index-driven install.
run_year_picker() {
    command -v unzip >/dev/null 2>&1 || { print_error "unzip is required"; exit 1; }
    if is_url "$FIRESTARR_DATASET_INDEX"; then
        command -v curl >/dev/null 2>&1 || command -v wget >/dev/null 2>&1 || {
            print_error "curl or wget is required to fetch the dataset index"; exit 1; }
    fi
    print_step "Fetching dataset index: $FIRESTARR_DATASET_INDEX"
    local index; index=$(fetch_index "$FIRESTARR_DATASET_INDEX") || {
        print_error "Could not fetch dataset index"; exit 1; }
    local base default rows
    base=$(json_scalar "$index" baseUrl)
    default=$(json_scalar "$index" default)
    rows=$(parse_datasets "$index")
    [ -n "$rows" ] || { print_error "No datasets found in index"; exit 1; }

    local years; years=$(printf '%s\n' "$rows" | cut -f1 | sort -n | tr '\n' ' ')
    echo ""
    echo "  Available fuel dataset years: $years"
    echo "  (label = run year; a run in year N uses dataset N)"

    local selection
    if [ -n "$FIRESTARR_DATASET_YEARS" ]; then
        selection="$FIRESTARR_DATASET_YEARS"        # non-interactive override
    else
        echo ""
        echo "  Enter year(s) to install (space/comma separated), or 'all'."
        read -p "  Years [default: $default]: " selection
        selection="${selection:-$default}"
    fi

    local chosen
    if printf '%s' "$selection" | grep -qiw all; then
        chosen=$(printf '%s\n' "$rows" | cut -f1 | sort -n)
    else
        chosen=$(printf '%s' "$selection" | tr ',' ' ')
    fi

    local dl_dir="${FIRESTARR_DOWNLOAD_DIR:-$HOME/Downloads}"

    # Size the install from the years actually chosen, before downloading
    # anything. The archives are already-compressed GeoTIFFs, so extracted size
    # is ~the same as the zip: budget the total once for the download folder
    # (archives are kept for reinstalls) and again for the install location.
    local need; need=$(bytes_for_years "$rows" "$chosen")
    if [ "$need" -gt 0 ]; then
        echo ""
        echo "  Selected years need about $(format_bytes "$need") to download,"
        echo "  and about the same again once installed."
        echo "    Download folder: $dl_dir"
        echo "    Install location: $FIRESTARR_DATASET_PATH"

        local short=0
        if ! have_free_space "$dl_dir" "$need"; then
            print_error "Not enough free space for the download in $dl_dir (need $(format_bytes "$need"))"
            short=1
        fi
        if ! have_free_space "$FIRESTARR_DATASET_PATH" "$need"; then
            print_error "Not enough free space to install into $FIRESTARR_DATASET_PATH (need $(format_bytes "$need"))"
            short=1
        fi
        if [ "$short" -eq 1 ]; then
            echo ""
            echo "  Free up space, choose fewer years, or point"
            echo "  FIRESTARR_DOWNLOAD_DIR / FIRESTARR_DATASET_PATH at a larger disk."
            exit 1
        fi
        print_success "Disk space OK for $(format_bytes "$need")"
    fi

    mkdir -p "$dl_dir"
    mkdir -p "$FIRESTARR_DATASET_PATH"

    local y
    for y in $chosen; do
        local row file expect
        row=$(printf '%s\n' "$rows" | awk -F'\t' -v y="$y" '$1==y{print; exit}')
        [ -n "$row" ] || { print_error "Year $y not in index — skipping"; continue; }
        file=$(printf '%s' "$row" | cut -f2)
        expect=$(printf '%s' "$row" | cut -f3)
        local url="${base%/}/$file"
        local dest="$dl_dir/$file"

        print_step "Year $y: downloading $file"
        if [ -f "$dest" ] && [ "$(sha256_of "$dest")" = "$expect" ]; then
            print_info "Reusing verified local copy: $dest"
        else
            download_file "$url" "$dest" || { print_error "Download failed: $url"; exit 1; }
        fi

        print_step "Year $y: verifying sha256"
        local got; got=$(sha256_of "$dest")
        if [ -n "$expect" ] && [ "$got" != "$expect" ]; then
            print_error "Checksum mismatch for $file"
            echo "    expected: $expect"; echo "    got:      $got"
            exit 1
        fi
        print_success "Year $y verified"

        print_step "Year $y: installing"
        install_one_year "$dest" "$y"
        print_success "Year $y installed -> generated/grid/100m/$y/"
    done

    # Record installed vintages.
    local installed
    installed=$(find "$FIRESTARR_DATASET_PATH/generated/grid/100m" -maxdepth 1 -type d \
        -name '[0-9][0-9][0-9][0-9]' 2>/dev/null | xargs -n1 basename 2>/dev/null | sort -n | tr '\n' ' ')
    print_success "Installed fuel years: ${installed:-none}"

    mkdir -p "$FIRESTARR_DATASET_PATH/sims"; chmod 777 "$FIRESTARR_DATASET_PATH/sims"
    print_success "Ready: $FIRESTARR_DATASET_PATH"
}

main() {
    print_header

    # Load configuration
    print_step "Loading configuration from $ENV_FILE..."
    load_config
    print_success "Configuration loaded"

    # Year-picker mode: if a dataset index is configured, use it and finish.
    if [ -n "$FIRESTARR_DATASET_INDEX" ]; then
        run_year_picker
        echo ""
        print_success "Dataset installation complete"
        exit 0
    fi

    echo ""
    echo "  Source: $FIRESTARR_DATASET_SOURCE"
    echo "  Target: $FIRESTARR_DATASET_PATH"
    echo ""

    # Check dependencies
    print_step "Checking dependencies..."
    check_dependencies
    print_success "All dependencies found"

    # Get dataset (download if URL, use directly if local)
    if is_url "$FIRESTARR_DATASET_SOURCE"; then
        # Extract original filename from URL
        local url_filename=$(basename "$FIRESTARR_DATASET_SOURCE")
        # Remove query string if present
        url_filename="${url_filename%%\?*}"
        # Default to firestarr_dataset.zip if we can't extract a name
        [ -z "$url_filename" ] && url_filename="firestarr_dataset.zip"

        local input_dir=""

        # Use FIRESTARR_DOWNLOAD_DIR if already set (from main installer)
        if [ -n "$FIRESTARR_DOWNLOAD_DIR" ]; then
            input_dir="$FIRESTARR_DOWNLOAD_DIR"
            print_info "Using download folder: $input_dir"
        else
            local default_dir="$HOME/Downloads"

            echo ""
            echo "Where should the dataset archive be saved?"
            echo "    Filename: $url_filename"
            echo "    (This file will be preserved for future reinstalls)"
            read -p "Download folder [$default_dir]: " input_dir
            input_dir="${input_dir:-$default_dir}"
            # Expand ~ to $HOME
            input_dir="${input_dir/#\~/$HOME}"
        fi

        # Remove trailing slash
        input_dir="${input_dir%/}"

        local download_file="$input_dir/$url_filename"

        # Create directory if needed
        if [ ! -d "$input_dir" ]; then
            mkdir -p "$input_dir" || {
                print_error "Cannot create directory: $input_dir"
                exit 1
            }
        fi

        # Check if already downloaded
        if [ -f "$download_file" ]; then
            print_warning "Dataset file already exists: $download_file"
            read -p "Use existing file? [Y/n] " -n 1 -r
            echo ""
            if [[ ! $REPLY =~ ^[Nn]$ ]]; then
                print_success "Using existing download"
                SOURCE_FILE="$download_file"
            else
                print_step "Downloading FireSTARR dataset..."
                echo "    Downloading to: $download_file"
                echo ""
                if download_file "$FIRESTARR_DATASET_SOURCE" "$download_file"; then
                    print_success "Download complete: $download_file"
                else
                    print_error "Download failed"
                    exit 1
                fi
                SOURCE_FILE="$download_file"
            fi
        else
            print_step "Downloading FireSTARR dataset..."
            echo "    Downloading to: $download_file"
            echo ""
            if download_file "$FIRESTARR_DATASET_SOURCE" "$download_file"; then
                print_success "Download complete: $download_file"
            else
                print_error "Download failed"
                exit 1
            fi
            SOURCE_FILE="$download_file"
        fi
        DOWNLOADED_FILE="$download_file"
    else
        print_step "Using local dataset file..."
        if [ ! -f "$FIRESTARR_DATASET_SOURCE" ]; then
            print_error "Local file not found: $FIRESTARR_DATASET_SOURCE"
            exit 1
        fi
        print_success "Found: $FIRESTARR_DATASET_SOURCE"
        SOURCE_FILE="$FIRESTARR_DATASET_SOURCE"
        DOWNLOADED_FILE=""
    fi

    # Now we have the source file - check if target already has data
    if [ -d "$FIRESTARR_DATASET_PATH/generated" ]; then
        print_warning "Dataset already installed at $FIRESTARR_DATASET_PATH"
        echo ""
        read -p "Overwrite existing installation? [y/N] " -n 1 -r
        echo ""
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            echo "Installation cancelled. Archive preserved at: $SOURCE_FILE"
            exit 0
        fi
    fi

    # Create install directory
    print_step "Creating installation directory..."
    mkdir -p "$FIRESTARR_DATASET_PATH"
    print_success "Directory ready: $FIRESTARR_DATASET_PATH"

    # Extract dataset
    print_step "Extracting dataset..."
    unzip -q -o "$SOURCE_FILE" -d "$FIRESTARR_DATASET_PATH"
    print_success "Extraction complete"

    # Clean Mac artifacts and flatten nested root folder if present
    print_step "Cleaning up extraction..."
    cleanup_and_flatten "$FIRESTARR_DATASET_PATH"

    # Create sims directory for simulation outputs
    # Must be world-writable so FireSTARR container (UID 1000) can write to it
    print_step "Creating sims directory..."
    mkdir -p "$FIRESTARR_DATASET_PATH/sims"
    chmod 777 "$FIRESTARR_DATASET_PATH/sims"
    print_success "Created $FIRESTARR_DATASET_PATH/sims (world-writable)"

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

    # Tell user about the preserved download file
    if [ -n "$DOWNLOADED_FILE" ] && [ -f "$DOWNLOADED_FILE" ]; then
        local file_size=$(du -h "$DOWNLOADED_FILE" | cut -f1)
        echo -e "${YELLOW}Downloaded archive preserved:${NC} $DOWNLOADED_FILE ($file_size)"
        echo "    You can delete this file once you've verified everything works:"
        echo "    rm \"$DOWNLOADED_FILE\""
        echo ""
    fi

    echo "You can now run FireSTARR with:"
    echo "    docker compose up firestarr-app"
    echo ""
}

# Run main function
# Only auto-run when executed directly (allows sourcing for tests).
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
    main "$@"
fi
