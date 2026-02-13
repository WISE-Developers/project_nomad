# FireSTARR Minimum System Requirements

Minimum requirements for the FireSTARR fire modeling engine used by Project Nomad.

## Overview

FireSTARR is an open-source probabilistic fire spread simulation system implementing the Canadian Forest Fire Behavior Prediction (FBP) System. It uses Monte Carlo methods to generate burn probability maps from point ignitions.

## Documentation

- [FireSTARR Science Paper (PDF)](https://pubs.cif-ifc.org/doi/suppl/10.5558/tfc2025-015/suppl_file/tfc2025-015supp5.pdf)
- [FireSTARR Source Repository](https://github.com/cwfmf/firestarr-cpp)

## Hardware

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| CPU | 2 cores | 4+ cores |
| RAM | 8 GB | 16 GB+ |
| Disk | 50 GB (dataset) | 100 GB+ |

## Platform Support

- **x86_64**: Supported.
- **ARM64**: Supported via dedicated container image.

### Dataset

The national dataset is required for Canadian fire modeling:

| Component | Description | Size |
|-----------|-------------|------|
| Fuel grids | 100m resolution fuel type rasters | ~40 GB |
| DEM | Digital elevation model | included |
| Fuel lookup | `fuel.lut` classification table | < 1 MB |
| **Total** | | **~50 GB** |

### Container Image

| Architecture | Image |
|-------------|-------|
| x86_64 | `ghcr.io/cwfmf/firestarr-cpp/firestarr:v0.9.7` |
| ARM64 | `ghcr.io/cwfmf/firestarr-cpp/firestarr:v0.9.7` |

### Bare Metal

Build dependencies:
- C++ compiler with C++20 support
- CMake >= 3.31.6

## See Also

- [Nomad Requirements](NOMAD_REQUIREMENTS.md) - Nomad application requirements
- [README](README.md) - Project overview and quick start
