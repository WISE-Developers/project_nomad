# Project Nomad: AGPLv3 Licensing Analysis

## Executive Summary

Project Nomad is architecturally designed with clean licensing boundaries. The AGPLv3 license applies to Nomad's source code and requires that users interacting with it over a network can obtain the source. However, due to the loose coupling design, optional fire models and agency configuration submodules have no licensing entanglement with Nomad.

---

## Architecture Overview

**Nomad** is a fire mapping GUI application with two deployment modes:

- **SAN (Stand Alone Nomad):** Default mode with no external dependencies — fully functional without fire models or agency integration
- **ACN (Agency Centric Nomad):** Integrates with agency infrastructure via configuration submodules

**Optional Components:**

- FireSTARR (AGPLv3) — fire modeling engine
- WISE (AGPLv3) — fire modeling engine
- Agency submodules — configuration data for agency integration

---

## Component Licensing Analysis

### Nomad Core

| Aspect | Detail |
|--------|--------|
| License | AGPLv3 |
| Obligation | Source code must be made available to users interacting over a network |
| Trigger | Only triggered when Nomad is **modified** and served over a network |

If Nomad is deployed unmodified, Section 13 obligations are minimal — simply pointing users to the public repository satisfies the requirement.

---

### Fire Models (FireSTARR & WISE)

| Aspect | Detail |
|--------|--------|
| License | AGPLv3 (both) |
| Integration Method | Shell execution — Nomad invokes model binaries via CLI |
| Source Code Mixing | None — completely separate codebases |
| Coupling | Arm's length via stdin/stdout/files |

**AGPL Impact: None**

Shelling out to execute a separate program does not create a "combined work" or "derivative work." This is legally equivalent to a user manually running the command. The three programs are **merely aggregated** — distributed together but remaining independent works.

Even if FireSTARR or WISE were under different licenses (MIT, proprietary, etc.), there would be no license conflict with Nomad. The fact that all three are AGPLv3 is coincidental convenience, not a legal requirement of the architecture.

**Key precedent:** A shell script calling `ffmpeg` (GPL) does not inherit GPL. Same principle applies here.

---

### Agency Submodules

| Aspect | Detail |
|--------|--------|
| Content | Configuration data only |
| Examples | Database connection strings, API endpoints, weather data sources |
| Abstraction Logic | Built into Nomad core, not the submodule |

**AGPL Impact: None**

Configuration data is not code. It is not copyrightable and cannot be a derivative work. Agency submodules are functionally equivalent to:

- nginx configuration files
- docker-compose.yml
- Environment variables

Agencies may keep their configuration data (connection strings, API keys, endpoint URLs) entirely internal. The AGPLv3 license of Nomad has no reach into configuration files.

---

## Summary Table

| Component | License | Coupling to Nomad | AGPL Impact on Component |
|-----------|---------|-------------------|--------------------------|
| Nomad core | AGPLv3 | — | Source available to network users |
| FireSTARR | AGPLv3 | Shell exec (arm's length) | None — separate program |
| WISE | AGPLv3 | Shell exec (arm's length) | None — separate program |
| Agency submodule | N/A | Config data only | None — not code |

---

## Key Takeaways

1. **Clean boundaries by design:** Nomad's architecture maintains clear separation between components, avoiding "combined work" entanglement.

2. **Models are independent:** Installing and invoking FireSTARR/WISE via shell execution preserves their status as separate programs. No source code mixing occurs.

3. **Agency data stays private:** Configuration submodules contain no copyrightable code. Agencies have no obligation to publish connection strings, credentials, or internal endpoint URLs.

4. **AGPLv3 only affects Nomad code:** Modifications to Nomad itself must be shared with network users. Unmodified deployments simply reference the public repository.

5. **Future-proof:** This architecture would remain clean even if fire models changed licenses. The loose coupling protects all parties.

---

## Compliance Checklist for Deployment

- [ ] Nomad source code accessible to network users (link to public repo or local source archive)
- [ ] If Nomad is modified, modified source must be offered to users
- [ ] FireSTARR/WISE installed from public repos — no additional action needed
- [ ] Agency submodule contains only configuration data — no licensing action required

---

*Analysis prepared for Project Nomad — frontend v0.2.7, backend v0.1.0.*
