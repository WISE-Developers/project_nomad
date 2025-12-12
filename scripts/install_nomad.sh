#!/bin/bash
#
# Project Nomad Installer
# Detects system architecture, validates configuration, installs datasets,
# and offers test options
#
# Usage:
#   ./scripts/install_nomad.sh
#

set -e

# Installer version
INSTALLER_VERSION="1.0.0"

# Script directory (for calling other scripts)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Configuration file
ENV_FILE="$PROJECT_DIR/.env"
ENV_EXAMPLE="$PROJECT_DIR/.env.example"

# Required environment variables
REQUIRED_VARS=(
    "VERSION"
    "USERNAME"
    "USER_ID"
    "FIRESTARR_DATASET_SOURCE"
    "FIRESTARR_DATASET_PATH"
)

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

print_header() {
    echo -e "${BLUE}"
    echo "╔════════════════════════════════════════════════════════════╗"
    echo "║           Project Nomad Installer v${INSTALLER_VERSION}                   ║"
    echo "║           Fire Modeling System                             ║"
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

# ============================================
# Architecture Detection
# ============================================

# Detect if running under Colima (Mac Docker alternative)
is_colima() {
    if docker context show 2>/dev/null | grep -q "colima"; then
        return 0
    fi
    # Also check docker info for colima
    if docker info 2>/dev/null | grep -qi "colima"; then
        return 0
    fi
    return 1
}

# Check if CPU supports AVX2 (required for modern FireSTARR builds)
has_avx2() {
    local arch=$(uname -m)

    if [ "$arch" = "x86_64" ]; then
        # Linux
        if [ -f /proc/cpuinfo ]; then
            if grep -q "avx2" /proc/cpuinfo; then
                return 0
            fi
        fi
        # macOS
        if command -v sysctl &> /dev/null; then
            if sysctl -n machdep.cpu.features 2>/dev/null | grep -qi "AVX2"; then
                return 0
            fi
            # Also check leaf7 features on macOS
            if sysctl -n machdep.cpu.leaf7_features 2>/dev/null | grep -qi "AVX2"; then
                return 0
            fi
        fi
        return 1
    fi
    # Non-x86 architectures don't have AVX2
    return 1
}

# Detect system architecture and recommend FireSTARR image
detect_architecture() {
    local arch=$(uname -m)
    local os=$(uname -s)

    DETECTED_ARCH="$arch"
    DETECTED_OS="$os"
    DETECTED_COLIMA=false
    DETECTED_AVX2=false
    RECOMMENDED_IMAGE=""
    ARCH_EXPLANATION=""

    # Check for Colima
    if is_colima; then
        DETECTED_COLIMA=true
    fi

    # Check for AVX2
    if has_avx2; then
        DETECTED_AVX2=true
    fi

    # Determine recommended image based on detection
    case "$arch" in
        arm64|aarch64)
            RECOMMENDED_IMAGE="ghcr.io/wise-developers/firestarr:${VERSION}-arm64"
            ARCH_EXPLANATION="ARM64 architecture detected (Apple Silicon or ARM server).
    This requires the ARM64-native FireSTARR build."
            ;;
        x86_64)
            if [ "$DETECTED_AVX2" = true ]; then
                RECOMMENDED_IMAGE="ghcr.io/cwfmf/firestarr:dev-${VERSION}"
                ARCH_EXPLANATION="Modern x86_64 CPU with AVX2 support detected.
    This is optimal and can use the standard FireSTARR build."
            else
                RECOMMENDED_IMAGE="ghcr.io/wise-developers/firestarr:${VERSION}-sandybridge"
                ARCH_EXPLANATION="Older x86_64 CPU without AVX2 support detected.
    This requires the Sandybridge-compatible FireSTARR build
    (compiled for older CPUs without modern vector instructions)."
            fi
            ;;
        *)
            RECOMMENDED_IMAGE="ghcr.io/cwfmf/firestarr:dev-${VERSION}"
            ARCH_EXPLANATION="Unknown architecture: $arch
    Defaulting to standard x86_64 build. This may not work on your system."
            ;;
    esac
}

# Display architecture detection results and get user confirmation
configure_firestarr_image() {
    print_step "Detecting system architecture..."
    detect_architecture

    echo ""
    echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
    echo -e "${CYAN}              Architecture Detection Results${NC}"
    echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
    echo ""
    echo "    Operating System:  $DETECTED_OS"
    echo "    CPU Architecture:  $DETECTED_ARCH"
    echo "    AVX2 Support:      $([ "$DETECTED_AVX2" = true ] && echo "Yes" || echo "No")"
    echo "    Docker via Colima: $([ "$DETECTED_COLIMA" = true ] && echo "Yes" || echo "No")"
    echo ""
    echo -e "${CYAN}Analysis:${NC}"
    echo "    $ARCH_EXPLANATION"
    echo ""
    echo -e "${CYAN}Recommended Image:${NC}"
    echo -e "    ${GREEN}$RECOMMENDED_IMAGE${NC}"
    echo ""
    echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
    echo ""

    # Check if FIRESTARR_IMAGE is already set in .env
    if [ -n "$FIRESTARR_IMAGE" ]; then
        if [ "$FIRESTARR_IMAGE" = "$RECOMMENDED_IMAGE" ]; then
            print_success "FIRESTARR_IMAGE in .env matches recommendation"
            return 0
        else
            print_warning "FIRESTARR_IMAGE in .env differs from recommendation:"
            echo "    Current:     $FIRESTARR_IMAGE"
            echo "    Recommended: $RECOMMENDED_IMAGE"
            echo ""
            read -p "Keep current setting? [Y/n] " -n 1 -r
            echo ""
            if [[ $REPLY =~ ^[Nn]$ ]]; then
                update_firestarr_image "$RECOMMENDED_IMAGE"
            else
                print_info "Keeping current FIRESTARR_IMAGE setting"
            fi
        fi
    else
        echo "Available options:"
        echo ""
        echo "    1) Use recommended: $RECOMMENDED_IMAGE"
        echo "    2) Modern x86_64 (AVX2):    ghcr.io/cwfmf/firestarr:dev-${VERSION}"
        echo "    3) Older x86_64 (no AVX2):  ghcr.io/wise-developers/firestarr:${VERSION}-sandybridge"
        echo "    4) ARM64 (Apple Silicon):   ghcr.io/wise-developers/firestarr:${VERSION}-arm64"
        echo "    5) Enter custom image"
        echo ""
        read -p "Select an option [1-5] (default: 1): " choice

        case "${choice:-1}" in
            1)
                update_firestarr_image "$RECOMMENDED_IMAGE"
                ;;
            2)
                update_firestarr_image "ghcr.io/cwfmf/firestarr:dev-${VERSION}"
                ;;
            3)
                update_firestarr_image "ghcr.io/wise-developers/firestarr:${VERSION}-sandybridge"
                ;;
            4)
                update_firestarr_image "ghcr.io/wise-developers/firestarr:${VERSION}-arm64"
                ;;
            5)
                echo ""
                read -p "Enter custom image: " custom_image
                if [ -n "$custom_image" ]; then
                    update_firestarr_image "$custom_image"
                else
                    print_error "No image specified, using recommended"
                    update_firestarr_image "$RECOMMENDED_IMAGE"
                fi
                ;;
            *)
                print_warning "Invalid option, using recommended"
                update_firestarr_image "$RECOMMENDED_IMAGE"
                ;;
        esac
    fi
}

# Update FIRESTARR_IMAGE in .env file
update_firestarr_image() {
    local new_image="$1"

    # Check if FIRESTARR_IMAGE line exists in .env
    if grep -q "^FIRESTARR_IMAGE=" "$ENV_FILE" 2>/dev/null; then
        # Update existing line
        if [[ "$OSTYPE" == "darwin"* ]]; then
            sed -i '' "s|^FIRESTARR_IMAGE=.*|FIRESTARR_IMAGE=$new_image|" "$ENV_FILE"
        else
            sed -i "s|^FIRESTARR_IMAGE=.*|FIRESTARR_IMAGE=$new_image|" "$ENV_FILE"
        fi
    elif grep -q "^#.*FIRESTARR_IMAGE=" "$ENV_FILE" 2>/dev/null; then
        # There's a commented line, add after it
        if [[ "$OSTYPE" == "darwin"* ]]; then
            sed -i '' "/^#.*FIRESTARR_IMAGE=/a\\
FIRESTARR_IMAGE=$new_image" "$ENV_FILE"
        else
            sed -i "/^#.*FIRESTARR_IMAGE=/a FIRESTARR_IMAGE=$new_image" "$ENV_FILE"
        fi
    else
        # Add new line after VERSION
        if [[ "$OSTYPE" == "darwin"* ]]; then
            sed -i '' "/^VERSION=/a\\
FIRESTARR_IMAGE=$new_image" "$ENV_FILE"
        else
            sed -i "/^VERSION=/a FIRESTARR_IMAGE=$new_image" "$ENV_FILE"
        fi
    fi

    # Update the variable for this session
    export FIRESTARR_IMAGE="$new_image"

    print_success "FIRESTARR_IMAGE set to: $new_image"
}

# Validate .env configuration
validate_env() {
    print_step "Validating configuration..."

    # Check if .env exists
    if [ ! -f "$ENV_FILE" ]; then
        print_error "Configuration file not found: $ENV_FILE"
        echo ""
        if [ -f "$ENV_EXAMPLE" ]; then
            echo "Create your configuration by copying the example:"
            echo ""
            echo "    cp .env.example .env"
            echo ""
            echo "Then edit .env with your settings. Example contents:"
            echo ""
            echo -e "${CYAN}"
            cat "$ENV_EXAMPLE"
            echo -e "${NC}"
        else
            echo "Create a .env file with the required variables:"
            for var in "${REQUIRED_VARS[@]}"; do
                echo "  $var=<value>"
            done
        fi
        return 1
    fi

    # Source the .env file
    set -a
    source "$ENV_FILE"
    set +a

    # Check each required variable
    local missing=()
    for var in "${REQUIRED_VARS[@]}"; do
        if [ -z "${!var}" ]; then
            missing+=("$var")
        fi
    done

    if [ ${#missing[@]} -ne 0 ]; then
        print_error "Missing required variables in $ENV_FILE:"
        for var in "${missing[@]}"; do
            echo "    - $var"
        done
        echo ""
        echo "Check .env.example for reference."
        return 1
    fi

    print_success "Configuration valid"
    echo ""
    echo "    VERSION:                 $VERSION"
    echo "    FIRESTARR_DATASET_PATH:  $FIRESTARR_DATASET_PATH"
    echo ""
    return 0
}

# Check if dataset is installed
check_dataset() {
    if [ -d "$FIRESTARR_DATASET_PATH/generated/grid" ]; then
        return 0
    fi
    return 1
}

# Ensure sims directory exists and is writable
ensure_sims_writable() {
    local sims_dir="$FIRESTARR_DATASET_PATH/sims"

    # Create if doesn't exist
    if [ ! -d "$sims_dir" ]; then
        print_step "Creating sims directory..."
        mkdir -p "$sims_dir"
    fi

    # Ensure world-writable for container access (UID 1000)
    if [ ! -w "$sims_dir" ] || [ "$(stat -c '%a' "$sims_dir" 2>/dev/null || stat -f '%Lp' "$sims_dir" 2>/dev/null)" != "777" ]; then
        print_step "Setting sims directory permissions..."
        chmod 777 "$sims_dir"
        print_success "sims directory is now writable"
    fi
}

# Install dataset using the install script
install_dataset() {
    print_step "Installing FireSTARR dataset..."
    echo ""

    local install_script="$SCRIPT_DIR/install-firestarr-dataset.sh"

    if [ ! -f "$install_script" ]; then
        print_error "Install script not found: $install_script"
        return 1
    fi

    # Run the install script
    if bash "$install_script"; then
        print_success "Dataset installed successfully"
        return 0
    else
        print_error "Dataset installation failed"
        return 1
    fi
}

# Check/pull Docker image
pull_image() {
    print_step "Checking Docker images..."

    # If FIRESTARR_IMAGE is set, handle it specifically
    if [ -n "$FIRESTARR_IMAGE" ]; then
        # Check if image exists locally first
        if docker image inspect "$FIRESTARR_IMAGE" &> /dev/null; then
            print_success "Image found locally: $FIRESTARR_IMAGE"
            return 0
        fi

        # If it looks like a registry image (contains /), try to pull it
        if [[ "$FIRESTARR_IMAGE" == *"/"* ]]; then
            print_step "Pulling $FIRESTARR_IMAGE from registry..."
            if docker pull "$FIRESTARR_IMAGE"; then
                print_success "Image pulled: $FIRESTARR_IMAGE"
                return 0
            else
                print_error "Failed to pull image: $FIRESTARR_IMAGE"
                return 1
            fi
        else
            # Local image name but not found
            print_error "Local image not found: $FIRESTARR_IMAGE"
            echo "Build it with: docker compose build firestarr-app"
            return 1
        fi
    fi

    # Default: try to pull from registry using docker compose
    print_step "Pulling Docker images from registry..."
    if docker compose -f "$PROJECT_DIR/docker-compose.yaml" pull; then
        print_success "Docker images ready"
        return 0
    else
        print_error "Failed to pull Docker images"
        return 1
    fi
}

# Check Docker dependencies
check_docker() {
    print_step "Checking Docker..."

    if ! command -v docker &> /dev/null; then
        print_error "Docker is not installed"
        echo "Please install Docker: https://docs.docker.com/get-docker/"
        return 1
    fi

    if ! docker compose version &> /dev/null; then
        print_error "Docker Compose is not available"
        echo "Please ensure Docker Compose is installed"
        return 1
    fi

    print_success "Docker is available"
    return 0
}

# Run a single test
run_test() {
    local test_num="$1"
    local test_name="$2"
    shift 2
    local cmd=("$@")

    echo ""
    echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
    echo -e "${CYAN}Test $test_num: $test_name${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
    echo ""

    # Run the test
    if "${cmd[@]}"; then
        echo ""
        print_success "Test $test_num PASSED"
        return 0
    else
        echo ""
        print_error "Test $test_num FAILED"
        return 1
    fi
}

# Test 1: Help check (--help may return non-zero, so check for output instead)
test_help() {
    echo ""
    echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
    echo -e "${CYAN}Test 1: Help Check (basic executable)${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
    echo ""

    local output
    output=$(docker compose -f "$PROJECT_DIR/docker-compose.yaml" run --rm firestarr-app \
        /appl/firestarr/firestarr --help 2>&1) || true

    echo "$output"

    if echo "$output" | grep -q "Usage:"; then
        echo ""
        print_success "Test 1 PASSED"
        return 0
    else
        echo ""
        print_error "Test 1 FAILED"
        return 1
    fi
}

# Test 2: Test function help (--help may return non-zero, so check for output instead)
test_function_help() {
    echo ""
    echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
    echo -e "${CYAN}Test 2: Test Function Help (multi-argument support)${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
    echo ""

    local output
    output=$(docker compose -f "$PROJECT_DIR/docker-compose.yaml" run --rm firestarr-app \
        /appl/firestarr/firestarr test --help 2>&1) || true

    echo "$output"

    if echo "$output" | grep -q "Usage:"; then
        echo ""
        print_success "Test 2 PASSED"
        return 0
    else
        echo ""
        print_error "Test 2 FAILED"
        return 1
    fi
}

# Test 3: Simple 1hr test
test_simple() {
    run_test 3 "Simple 1hr Test (synthetic model run)" \
        docker compose -f "$PROJECT_DIR/docker-compose.yaml" run --rm firestarr-app \
        /appl/firestarr/firestarr test /appl/data/sims/smallTest --hours 1
}

# Test 4: External dataset test
test_external() {
    run_test 4 "External Dataset Test (10N_50651 real fire)" \
        docker compose -f "$PROJECT_DIR/docker-compose.yaml" run --rm firestarr-app \
        /appl/firestarr/firestarr \
        /appl/data/sims/bigTest \
        2024-06-03 \
        58.81228184403946 \
        -122.9117103995713 \
        01:00 \
        --ffmc 89.9 \
        --dmc 59.5 \
        --dc 450.9 \
        --apcp_prev 0 \
        -v \
        --wx /appl/data/10N_50651/firestarr_10N_50651_wx.csv \
        --output_date_offsets "[1]" \
        --perim /appl/data/10N_50651/10N_50651.tif
}

# Run all tests
run_all_tests() {
    local passed=0
    local failed=0

    echo ""
    echo -e "${BLUE}Running all tests...${NC}"

    if test_help; then ((passed++)) || true; else ((failed++)) || true; fi
    if test_function_help; then ((passed++)) || true; else ((failed++)) || true; fi
    if test_simple; then ((passed++)) || true; else ((failed++)) || true; fi
    if test_external; then ((passed++)) || true; else ((failed++)) || true; fi

    echo ""
    echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
    echo -e "${CYAN}Test Summary${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
    echo ""
    echo -e "    Passed: ${GREEN}$passed${NC}"
    echo -e "    Failed: ${RED}$failed${NC}"
    echo ""

    if [ $failed -eq 0 ]; then
        print_success "All tests passed!"
        return 0
    else
        print_error "$failed test(s) failed"
        return 1
    fi
}

# Test menu
test_menu() {
    while true; do
        echo ""
        echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
        echo -e "${CYAN}                    Test Menu${NC}"
        echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
        echo ""
        echo "    1) Help check (basic executable test)"
        echo "    2) Test function help (multi-argument support)"
        echo "    3) Simple 1hr test (synthetic model run)"
        echo "    4) External dataset test (10N_50651 real fire)"
        echo "    5) Run all tests"
        echo "    6) Skip tests / Exit"
        echo ""
        read -p "Select an option [1-6]: " choice

        case $choice in
            1) test_help ;;
            2) test_function_help ;;
            3) test_simple ;;
            4) test_external ;;
            5) run_all_tests ;;
            6)
                echo ""
                print_info "Skipping tests"
                break
                ;;
            *)
                print_warning "Invalid option. Please select 1-6."
                ;;
        esac
    done
}

# Main function
main() {
    print_header

    # Change to project directory
    cd "$PROJECT_DIR"

    # Step 1: Validate configuration
    if ! validate_env; then
        exit 1
    fi

    # Step 2: Check Docker
    if ! check_docker; then
        exit 1
    fi

    # Step 3: Check/Install dataset
    print_step "Checking dataset installation..."
    if check_dataset; then
        print_success "Dataset found at $FIRESTARR_DATASET_PATH"
    else
        print_warning "Dataset not found"
        echo ""
        read -p "Install dataset now? [Y/n] " -n 1 -r
        echo ""
        if [[ ! $REPLY =~ ^[Nn]$ ]]; then
            if ! install_dataset; then
                exit 1
            fi
        else
            print_warning "Skipping dataset installation"
            print_warning "Tests requiring external data will fail"
        fi
    fi

    # Step 3b: Ensure sims directory is writable
    ensure_sims_writable

    # Step 4: Configure FireSTARR image based on architecture
    configure_firestarr_image

    # Step 5: Pull Docker image
    if ! pull_image; then
        exit 1
    fi

    # Step 6: Offer test menu
    echo ""
    print_success "Setup complete!"
    echo ""
    read -p "Would you like to run tests? [Y/n] " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Nn]$ ]]; then
        test_menu
    fi

    echo ""
    echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
    print_success "Project Nomad is ready!"
    echo ""
    echo "To run FireSTARR manually:"
    echo ""
    echo "    docker compose run --rm firestarr-app /appl/firestarr/firestarr --help"
    echo ""
    echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
}

# Run main function
main "$@"
