# FireSTARR SME Documentation

## Overview

FireSTARR is a probabilistic fire growth model developed by the Canadian Wildland Fire Modelling Framework (CWFMF). It generates burn probability maps through Monte Carlo simulation under stochastic weather and fire behavior scenarios, making it well-suited for wildfire response decision-making.

This documentation provides authoritative Subject Matter Expert (SME) reference materials for integrators, developers, and operational staff working with FireSTARR within Project Nomad.

## Documentation Structure

### Architecture
System design and component relationships.

- [System Overview](architecture/system_overview.md) - High-level architecture and execution modes
- [Component Map](architecture/component_map.md) - Source code organization and responsibilities
- [Data Flow](architecture/data_flow.md) - Input processing through simulation to outputs

### Algorithms
Fire science implementation details.

- [Fire Spread Model](algorithms/fire_spread_model.md) - Elliptical spread calculations
- [FBP Implementation](algorithms/fbp_implementation.md) - Canadian Fire Behaviour Prediction System
- [FWI Calculations](algorithms/fwi_calculations.md) - Fire Weather Index System
- [Monte Carlo Methodology](algorithms/monte_carlo_methodology.md) - Probabilistic simulation approach

### Integration
Practical guidance for system integration.

- [API Patterns](integration/api_patterns.md) - REST wrapper recommendations
- [Docker Deployment](integration/docker_deployment.md) - Container configuration and execution
- [Nomad Integration Guide](integration/nomad_integration_guide.md) - Project Nomad specific integration

### Reference
Quick-reference materials.

- [CLI Reference](reference/cli_reference.md) - Command-line interface documentation
- [Configuration Reference](reference/configuration_reference.md) - settings.ini parameters
- [Error Codes](reference/error_codes.md) - Error handling and troubleshooting
- [Output Formats](reference/output_formats.md) - Output file specifications

## Key Characteristics

| Aspect | Description |
|--------|-------------|
| **Simulation Type** | Probabilistic (Monte Carlo) |
| **Primary Output** | Burn probability surfaces |
| **Core Language** | C++23 |
| **Orchestration** | Python (optional) |
| **Deployment** | Docker container |
| **Fire Science Basis** | Canadian FBP System (ST-X-3), FWI System |

## Related Documentation

- [FireSTARR I/O Reference](../../Onboarding/firestarr_io.md) - Detailed input/output specifications
- [FireSTARR Tech Summary](../../Onboarding/firestarr_tech_summary.md) - Technical architecture overview
- [WISE Documentation](../../Onboarding/wise_tech_summary.md) - Comparative fire modeling system

## Version Information

- **FireSTARR Version**: dev-0.9.5.4
- **Documentation Version**: 1.0.0
- **Last Updated**: November 2025
