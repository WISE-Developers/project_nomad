# Generic Configuration

This is the default configuration for Project Nomad. It serves as a baseline for all deployments and as a template for agency-specific configurations.

## Configuration Sections

### agencyId / agencyName
Identifiers for the deployment. Override these in agency-specific configs.

### deploymentMode
- `SAN` - Stand Alone Nomad (self-hosted PWA)
- `ACN` - Agency Centric Nomad (integrated into agency systems)

Note: This value is typically overridden by the `NOMAD_DEPLOYMENT_MODE` environment variable.

### branding
Customize the visual appearance:
- `logoUrl` - URL to agency logo
- `primaryColor` - Main brand color (hex)
- `secondaryColor` - Accent color (hex)
- `displayName` - Name shown in UI

### engines
List of fire modeling engines. Each engine has:
- `engineType` - Engine identifier (`firestarr`, `wise`)
- `enabled` - Whether the engine is available
- `settings` - Engine-specific configuration

### dataSources
Configure data providers for:
- `weather` - Weather data sources (SpotWX, agency APIs)
- `wildfirePoints` - Active fire/hotspot data
- `fuelTypes` - Fuel type classification services

Each source specifies:
- `id` - Unique identifier
- `name` - Display name
- `urls` - Service endpoint(s)
- `type` - `API` or `OWS`
- `kind` - `REST`, `WFS`, or `WCS`
- `isDefault` - Whether this is a default/national source

### roles
Map internal roles to permissions. Internal roles:
- `admin` - Full system access
- `fban` - Fire Behavior Analyst
- `modeler` - Standard modeler
- `user` - Basic user
- `anonymous` - Unauthenticated access

### exportOptions
Configure model export capabilities:
- `allowZipDownload` - Direct ZIP download
- `allowShareableLink` - Generate shareable URLs
- `allowAgencyStorage` - Save to agency storage systems
- `availableFormats` - Export format options

### suppressDefaultSources
When `true`, hides national/default data sources and only shows agency-specific sources.

## Creating Agency Configurations

1. Create a new directory: `/configuration/{agency-id}/`
2. Copy this `config.json` as a starting point
3. Modify values as needed (missing values inherit from defaults)
4. Set `NOMAD_AGENCY_ID={agency-id}` environment variable

Agency configurations are merged with defaults - you only need to specify values that differ.
