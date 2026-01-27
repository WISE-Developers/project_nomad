# FireSTARR Binary Upgrade Plan

**Status**: In Progress
**Created**: 2026-01-26
**Author**: Sage (with Papa)

## Objective

Update the FireSTARR build workflow to:
1. Build from the `unstable` branch by default (instead of `main`)
2. Add Linux ARM64 binary build (for Mac Silicon Docker via Colima)
3. Add Docker image building and publishing to GHCR

## Background

The perimeter implementation requires features only available in the FireSTARR `unstable` branch (specifically the `-i` flag for arrival grid output). Our current workflow builds from `main`, which lacks these features.

Additionally, we need Docker images for local development on Mac Silicon (Colima) and deployment on Linux/Windows servers.

## Current Workflow

**File**: `.github/workflows/build-firestarr.yml`

### What It Does Now
- **Trigger**: Manual dispatch or release events
- **Default ref**: `main`
- **Build targets**:
  - Linux x64: Ubuntu 22.04, Ubuntu 24.04
  - macOS ARM64: Native M-series binary (not useful for Docker)
  - Windows x64
- **Output**: Tarballs/zips uploaded to `firestarr-latest` release

### Gap Analysis

| Need | Current State | Action Required |
|------|---------------|-----------------|
| Unstable branch | Builds from `main` | Change default |
| Linux x64 Docker | Binary exists, no image | Add Docker job |
| Linux ARM64 Docker | **No ARM64 Linux binary** | Add QEMU build job |

## Proposed Changes

### Change 1: Default Branch → Unstable

Update all references from `main` to `unstable`:

**Lines to modify:**
- Line 8: `default: 'main'` → `default: 'unstable'`
- Line 28: `|| 'main'` → `|| 'unstable'`
- Line 122: Same (macOS job)
- Line 243: Same (Windows job, PowerShell)

### Change 2: Add Linux ARM64 Build Job

GitHub doesn't have free ARM64 Linux runners, so we use QEMU emulation on an x64 runner. This is slower but works.

```yaml
build-linux-arm64:
  runs-on: ubuntu-24.04

  steps:
    - name: Checkout Nomad (for workflow context)
      uses: actions/checkout@v4

    - name: Set up QEMU
      uses: docker/setup-qemu-action@v3
      with:
        platforms: arm64

    - name: Build in ARM64 container
      run: |
        docker run --rm --platform linux/arm64 \
          -v ${{ github.workspace }}:/workspace \
          -w /workspace \
          ubuntu:24.04 bash -c '
            set -e
            apt-get update
            apt-get install -y git cmake g++ libgeotiff-dev libtiff-dev libcurl4-openssl-dev libproj-dev

            git clone https://github.com/CWFMF/firestarr-cpp.git firestarr
            cd firestarr
            git checkout ${{ github.event.inputs.firestarr_ref || 'unstable' }}
            COMMIT=$(git rev-parse --short HEAD)
            echo "VERSION=dev-$COMMIT" > ../.env

            # Remove post-build copy that fails
            sed -i "128,130d" CMakeLists.txt

            cd ..
            cmake -S firestarr -B build \
              -DCMAKE_BUILD_TYPE=Release \
              -DCMAKE_RUNTIME_OUTPUT_DIRECTORY=/workspace/build/bin

            cmake --build build --config Release -j$(nproc)
          '

    - name: Package artifact
      run: |
        mkdir -p dist
        cp build/bin/firestarr dist/
        [ -f firestarr/fuel.lut ] && cp firestarr/fuel.lut dist/
        [ -f firestarr/settings.ini ] && cp firestarr/settings.ini dist/
        [ -f firestarr/data/fuel.lut ] && cp firestarr/data/fuel.lut dist/
        [ -f firestarr/data/settings.ini ] && cp firestarr/data/settings.ini dist/
        cd firestarr && git rev-parse HEAD > ../dist/VERSION && cd ..
        tar -czvf firestarr-linux-arm64.tar.gz -C dist .

    - name: Upload artifact
      uses: actions/upload-artifact@v4
      with:
        name: firestarr-linux-arm64
        path: firestarr-linux-arm64.tar.gz
        retention-days: 30
```

### Change 3: Add Docker Image Build Jobs

Two separate Docker images:

| Image | Base | Binary Source | Use Case |
|-------|------|---------------|----------|
| `firestarr:unstable-amd64` | `ubuntu:24.04` | Ubuntu 24.04 x64 build | Linux servers, Windows Docker |
| `firestarr:unstable-arm64` | `ubuntu:24.04` | ARM64 build (new) | Mac Silicon via Colima |

#### Docker Job for x64

```yaml
build-docker-amd64:
  needs: [build-linux]
  runs-on: ubuntu-latest
  permissions:
    contents: read
    packages: write

  steps:
    - name: Checkout Nomad (for Dockerfile)
      uses: actions/checkout@v4

    - name: Download Linux x64 binary
      uses: actions/download-artifact@v4
      with:
        name: firestarr-linux-ubuntu-24.04
        path: docker-context/

    - name: Extract binary
      run: |
        cd docker-context
        tar -xzf firestarr-linux-ubuntu-24.04.tar.gz
        chmod +x firestarr
        ls -la

    - name: Set up Docker Buildx
      uses: docker/setup-buildx-action@v3

    - name: Login to GHCR
      uses: docker/login-action@v3
      with:
        registry: ghcr.io
        username: ${{ github.actor }}
        password: ${{ secrets.GITHUB_TOKEN }}

    - name: Build and push
      uses: docker/build-push-action@v6
      with:
        context: docker-context
        file: docker/firestarr/Dockerfile
        push: true
        platforms: linux/amd64
        tags: |
          ghcr.io/wise-developers/firestarr:unstable-amd64
          ghcr.io/wise-developers/firestarr:unstable
```

#### Docker Job for ARM64

```yaml
build-docker-arm64:
  needs: [build-linux-arm64]
  runs-on: ubuntu-latest
  permissions:
    contents: read
    packages: write

  steps:
    - name: Checkout Nomad (for Dockerfile)
      uses: actions/checkout@v4

    - name: Download Linux ARM64 binary
      uses: actions/download-artifact@v4
      with:
        name: firestarr-linux-arm64
        path: docker-context/

    - name: Extract binary
      run: |
        cd docker-context
        tar -xzf firestarr-linux-arm64.tar.gz
        chmod +x firestarr
        ls -la

    - name: Set up QEMU
      uses: docker/setup-qemu-action@v3

    - name: Set up Docker Buildx
      uses: docker/setup-buildx-action@v3

    - name: Login to GHCR
      uses: docker/login-action@v3
      with:
        registry: ghcr.io
        username: ${{ github.actor }}
        password: ${{ secrets.GITHUB_TOKEN }}

    - name: Build and push
      uses: docker/build-push-action@v6
      with:
        context: docker-context
        file: docker/firestarr/Dockerfile
        push: true
        platforms: linux/arm64
        tags: ghcr.io/wise-developers/firestarr:unstable-arm64
```

### Change 4: Create Dockerfile

**File**: `docker/firestarr/Dockerfile`

```dockerfile
FROM ubuntu:24.04

# Install runtime dependencies only (no build tools needed)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgeotiff5 \
    libtiff6 \
    libcurl4t64 \
    libproj25 \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Copy pre-built binary and data files
COPY firestarr /app/
COPY fuel.lut /app/
COPY settings.ini /app/
COPY VERSION /app/

# Make binary executable
RUN chmod +x /app/firestarr

# Default entrypoint
ENTRYPOINT ["/app/firestarr"]
```

**Note**: Runtime library package names for Ubuntu 24.04. May need adjustment based on `ldd` output.

### Change 5: Update Publish Job

Add Docker images to the release notes:

```yaml
- name: Update firestarr-latest release (manual runs)
  if: github.event_name == 'workflow_dispatch'
  uses: softprops/action-gh-release@v2
  with:
    tag_name: firestarr-latest
    name: "FireSTARR Latest Build"
    body: |
      Latest FireSTARR binaries built from upstream.

      **FireSTARR ref:** ${{ github.event.inputs.firestarr_ref || 'unstable' }}
      **Built:** ${{ github.run_id }}

      ## Docker Images
      ```bash
      # Linux/Windows (x64)
      docker pull ghcr.io/wise-developers/firestarr:unstable

      # Mac Silicon (ARM64 via Colima)
      docker pull ghcr.io/wise-developers/firestarr:unstable-arm64
      ```

      **Workflow run:** https://github.com/${{ github.repository }}/actions/runs/${{ github.run_id }}
    prerelease: true
    make_latest: false
    files: |
      firestarr-linux-ubuntu-22.04/firestarr-linux-ubuntu-22.04.tar.gz
      firestarr-linux-ubuntu-24.04/firestarr-linux-ubuntu-24.04.tar.gz
      firestarr-linux-arm64/firestarr-linux-arm64.tar.gz
      firestarr-macos-arm64/firestarr-macos-arm64.tar.gz
      firestarr-windows-x64/firestarr-windows-x64.zip
```

## Final Workflow Structure

```
jobs:
  build-linux:          # Existing - Ubuntu 22.04, 24.04 (x64)
  build-linux-arm64:    # NEW - Ubuntu 24.04 ARM64 via QEMU
  build-macos:          # Existing - macOS ARM64 native
  build-windows:        # Existing - Windows x64
  build-docker-amd64:   # NEW - needs build-linux
  build-docker-arm64:   # NEW - needs build-linux-arm64
  publish:              # Existing - needs all builds
```

## Implementation Steps

1. [x] Create `docker/firestarr/Dockerfile`
2. [x] Update workflow default from `main` to `unstable` (4 locations)
3. [x] Add `build-linux-arm64` job
4. [x] Add `build-docker-amd64` job
5. [x] Add `build-docker-arm64` job
6. [x] Update `publish` job with new artifacts and Docker info
7. [ ] Test with manual workflow dispatch
8. [ ] Verify x64 image runs on Kirk
9. [ ] Verify ARM64 image runs on Mac via Colima
10. [ ] Update Nomad demo deployment to use new image

## Testing

```bash
# Trigger manual build
gh workflow run build-firestarr.yml -f firestarr_ref=unstable

# Test x64 on Kirk
ssh root@kirk.spyd.com
docker pull ghcr.io/wise-developers/firestarr:unstable
docker run --rm ghcr.io/wise-developers/firestarr:unstable --help

# Test ARM64 on Mac (via Colima)
colima start
docker pull ghcr.io/wise-developers/firestarr:unstable-arm64
docker run --rm ghcr.io/wise-developers/firestarr:unstable-arm64 --help
```

## Risk: ARM64 Build Time

QEMU emulation is slow. The ARM64 build may take significantly longer than native builds. If this becomes a problem, options:
1. Accept longer build times (it's automated, who cares)
2. Use a paid ARM64 runner
3. Cross-compile (complex)

Recommendation: Start with QEMU, optimize later if needed.

## Related Documents

- `perimeter_implementation_plan.md` - Why we need unstable branch
- `.github/workflows/build-firestarr.yml` - Current workflow
