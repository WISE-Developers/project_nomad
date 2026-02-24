Summary of Nomad's licensing posture:

| Component | License | Coupling | AGPL Impact |
|-----------|---------|----------|-------------|
| Nomad core | AGPLv3 | — | Source available to network users |
| FireSTARR | AGPLv3 | Process spawn | None (separate program) |
| WISE | AGPLv3 | Process spawn | None (separate program) |
| Agency config | N/A | Config data | None (not code) |

Agencies can keep their connection strings, API keys, and endpoint URLs as internal as they like. AGPL doesn't care.

For detailed analysis, see [Documentation/Nomad/nomad-agplv3-licensing-analysis.md](Documentation/Nomad/nomad-agplv3-licensing-analysis.md).