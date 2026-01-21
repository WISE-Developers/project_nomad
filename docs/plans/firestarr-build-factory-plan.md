# FireSTARR Build Factory Implementation Plan

**Issue:** #122
**Hardware Baseline:** #114

## Objective
Create a GitHub Actions workflow in `project_nomad` that builds self-contained FireSTARR binaries from upstream `CWFMF/firestarr-cpp` and publishes them as release artifacts.

## Source Analysis Summary

**Upstream repo:** https://github.com/CWFMF/firestarr-cpp
- Pure C++20 fire modeling engine
- Dependencies: libgeotiff, tiff, curl, PROJ (all via vcpkg)
- Static linking already works on Windows
- No existing CI/CD - we create from scratch

**Hardware baseline (#114):** AVX required, target `-march=x86-64-v3`

## Implementation Approach

### Phase 1: GitHub Actions Workflow

Create `.github/workflows/build-firestarr.yml` in project_nomad:

```yaml
name: Build FireSTARR
on:
  workflow_dispatch:
    inputs:
      firestarr_ref:
        description: 'FireSTARR branch/tag to build'
        default: 'main'
  release:
    types: [published]

jobs:
  build-linux:
    strategy:
      matrix:
        os: [ubuntu-22.04, ubuntu-24.04]
    runs-on: ${{ matrix.os }}
    steps:
      - name: Checkout Nomad (for workflow)
        uses: actions/checkout@v4

      - name: Clone firestarr-cpp
        run: git clone --depth 1 https://github.com/CWFMF/firestarr-cpp.git firestarr

      - name: Setup vcpkg
        uses: lukka/run-vcpkg@v11
        with:
          vcpkgGitCommitId: <pin-to-stable>

      - name: Install dependencies via vcpkg
        run: vcpkg install libgeotiff tiff curl --triplet x64-linux

      - name: Configure CMake
        run: |
          cmake -S firestarr -B build \
            -DCMAKE_BUILD_TYPE=Release \
            -DCMAKE_CXX_FLAGS="-march=x86-64-v3" \
            -DCMAKE_TOOLCHAIN_FILE=$VCPKG_ROOT/scripts/buildsystems/vcpkg.cmake

      - name: Build
        run: cmake --build build --config Release -j$(nproc)

      - name: Package artifact
        run: |
          mkdir -p dist
          cp build/firestarr dist/
          cp firestarr/fuel.lut dist/
          cp firestarr/settings.ini dist/
          tar -czvf firestarr-linux-${{ matrix.os }}.tar.gz -C dist .

      - name: Upload artifact
        uses: actions/upload-artifact@v4
        with:
          name: firestarr-linux-${{ matrix.os }}
          path: firestarr-linux-${{ matrix.os }}.tar.gz
```

### Phase 2: Static Linking for Linux

The upstream CMake needs minor adjustment for Linux static builds. Options:

**Option A: Overlay CMake** (preferred)
- Create `build-config/firestarr-linux.cmake` in project_nomad
- Override link flags without forking upstream

**Option B: vcpkg static triplet**
- Use `x64-linux-static` or custom triplet
- vcpkg handles static linking automatically

### Phase 3: Release Publishing

Add job to attach artifacts to Nomad releases:

```yaml
  publish:
    needs: [build-linux]
    if: github.event_name == 'release'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@v4
      - name: Attach to release
        uses: softprops/action-gh-release@v1
        with:
          files: |
            firestarr-linux-ubuntu-22.04/firestarr-linux-ubuntu-22.04.tar.gz
            firestarr-linux-ubuntu-24.04/firestarr-linux-ubuntu-24.04.tar.gz
```

## Files to Create

| File | Purpose |
|------|---------|
| `.github/workflows/build-firestarr.yml` | Main workflow |
| `build-config/vcpkg-linux-static.cmake` | Toolchain overlay for static linking |
| `build-config/firestarr-build.md` | Documentation |

## Architecture Decision: Static vs AppImage

**Recommendation: Static linking via vcpkg**

Rationale:
- vcpkg already supports static triplets
- Simpler than AppImage tooling
- Smaller artifact size (~15-20MB vs ~50MB AppImage)
- FireSTARR has minimal deps (no Qt, no complex GUI frameworks)

AppImage remains a fallback if static linking proves problematic.

## Verification Plan

1. **Manual trigger**: Run workflow_dispatch, download artifact
2. **Binary test**: Run `./firestarr --help` on clean Ubuntu 22.04 VM
3. **Dependency check**: `ldd firestarr` should show minimal/no dynamic deps
4. **Model test**: Run with sample data to verify computation works
5. **Hardware check**: Test on AVX-capable and non-AVX hardware (should fail gracefully on non-AVX)

## Decisions Made

- **Data files**: Bundle `fuel.lut` and `settings.ini` in tarball (single distribution unit)
- **vcpkg commit**: Use latest stable at time of implementation
- **Version**: Use FireSTARR's native versioning (from upstream .env)
