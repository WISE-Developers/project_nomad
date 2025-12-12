#!/bin/bash
#
# Architecture Detection Test
# Tests the same detection logic used by install_nomad.sh
#
# Usage:
#   ./scripts/detect_test.sh
#

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Default version for testing (can be overridden)
VERSION="${VERSION:-0.9.5.4}"

# ============================================
# Architecture Detection (same as install_nomad.sh)
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
                RECOMMENDED_IMAGE="ghcr.io/cwfmf/firestarr:${VERSION}-sandybridge"
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

# ============================================
# Main
# ============================================

echo -e "${BLUE}"
echo "╔════════════════════════════════════════════════════════════╗"
echo "║           Architecture Detection Test                      ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

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
echo -e "${CYAN}Raw detection values:${NC}"
echo "    uname -m:           $(uname -m)"
echo "    uname -s:           $(uname -s)"
echo "    VERSION:            $VERSION"

# Show Docker context if available
if command -v docker &> /dev/null; then
    echo "    docker context:     $(docker context show 2>/dev/null || echo 'N/A')"
else
    echo "    docker:             not installed"
fi

echo ""
