# FireSTARR Minimum System Requirements

Minimum requirements for the FireSTARR fire modeling engine used by Project Nomad.

## Overview

FireSTARR is an open-source probabilistic fire spread simulation system implementing the Canadian Forest Fire Behavior Prediction (FBP) System. It uses Monte Carlo methods to generate burn probability maps from point ignitions.

## Documentation

- [FireSTARR Science Paper (PDF)](https://pubs.cif-ifc.org/doi/suppl/10.5558/tfc2025-015/suppl_file/tfc2025-015supp5.pdf)
- [FireSTARR Source Repository](https://github.com/cwfmf/firestarr)

## Hardware

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| CPU | 2 cores | 4+ cores |
| RAM | 8 GB | 16 GB+ |
| Disk | 11 GB (dataset, all 4 fuel years) | 30 GB+ |

## Platform Support

- **x86_64**: Supported.
- **ARM64**: Supported via dedicated container image.

### Dataset

The national dataset is required for Canadian fire modeling:

| Component | Description | Size |
|-----------|-------------|------|
| Fuel grids | 100m resolution fuel type rasters, ~3 GB per fuel year | ~11 GB (4 years) |
| DEM | Digital elevation model | included |
| Fuel lookup | `fuel.lut` classification table | < 1 MB |
| **Total** | | **~11 GB** |

### Container Image

The image is configured via the `FIRESTARR_IMAGE` environment variable (set in `.env` or by the installer). The version shown below is the current default; the actual image used is always determined by `FIRESTARR_IMAGE`.

| Architecture | Default Image |
|-------------|---------------|
| x86_64 | `ghcr.io/cwfmf/firestarr/firestarr:main-latest` |
| ARM64 | `ghcr.io/cwfmf/firestarr/firestarr:main-latest` |

`main-latest` is a **moving tag**: it follows the tip of CWFMF's `main` branch, so two
installs on different days can get different builds. It is what the installers use
(`FIRESTARR_IMAGE_TAG`, overridable per-arch via `FIRESTARR_IMAGE_TAG_ARM64`). Pin a
three-part version instead if you need a reproducible deployment.

> **Corrected 2026-11-10.** This table previously named `v0.9.7`, which was wrong twice.
> No tag in the container registry carries a `v` prefix — all 51 are unprefixed, so
> `v0.9.7` returns 404 and an operator following this table got a pull failure. And
> `0.9.7` was never the default; the installers have defaulted to `main-latest`
> throughout. The repository also moved from `cwfmf/firestarr-cpp` to `cwfmf/firestarr`
> (#529); the old package still resolves but is frozen and receives no new builds.
>
> **The two tag namespaces use opposite conventions — do not "fix" one to match the
> other.** Measured the same day:
>
> | namespace | example | `v` prefix |
> |---|---|---|
> | GHCR image tags (`FIRESTARR_IMAGE`) | `firestarr:0.9.7` | **no** — `v0.9.7` is a 404 |
> | GitHub release tags (`FIRESTARR_VERSION`) | `v0.9.20` | **yes** — `0.9.7` is a 404 |
>
> So `scripts/build-offline-bundle.sh`'s `FIRESTARR_VERSION="v0.9.20"` is correct as
> written, and the bare `0.9.7` above is correct as written. They disagree because the
> upstream registry and the upstream release tags disagree, not because one is stale.

### Bare Metal

Build dependencies:
- C++ compiler with C++20 support
- CMake >= 3.31.6

## See Also

- [Nomad Requirements](NOMAD_REQUIREMENTS.md) - Nomad application requirements
- [README](README.md) - Project overview and quick start
