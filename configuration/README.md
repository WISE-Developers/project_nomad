# Agency Configuration

This directory contains configuration files for Project Nomad deployments. Each agency maintains its own configuration in a separate folder, optionally managed as a Git submodule.

## Directory Structure

```
/configuration/
  /generic/           # Default SAN configuration (included in repo)
  /template/          # Starter template for new agencies
  /{agency-id}/       # Agency-specific configurations (submodules)
```

## Quick Start for Agencies

### 1. Create Your Configuration Repository

Create a new Git repository for your agency's configuration:

```bash
# Create repo structure
mkdir nomad-config-{agency-id}
cd nomad-config-{agency-id}
git init

# Copy template
cp -r /path/to/project_nomad/configuration/template/* .

# Customize config.json
# Add your logo to assets/
# Commit and push to your Git host
```

### 2. Add as Submodule to Project Nomad

From the Project Nomad root directory:

```bash
# Add your config repo as a submodule
git submodule add git@github.com:your-org/nomad-config-{agency-id}.git configuration/{agency-id}

# Initialize and update
git submodule update --init --recursive
```

### 3. Configure Environment

Set environment variables in your deployment:

```bash
export NOMAD_AGENCY_ID="{agency-id}"
export NOMAD_DEPLOYMENT_MODE="ACN"
```

The loader will automatically read from `/configuration/{agency-id}/config.json`.

## Configuration Schema Reference

Configuration files must conform to schema version 2.0. Below is a complete reference of all fields.

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `version` | `"2.0"` | Schema version (must be exactly "2.0") |
| `agencyId` | string | Unique identifier (lowercase, alphanumeric, hyphens only) |
| `agencyName` | string | Human-readable agency name |
| `deploymentMode` | `"SAN"` \| `"ACN"` | Deployment mode |
| `environment` | `"development"` \| `"staging"` \| `"production"` | Environment |
| `auth` | object | Authentication configuration |
| `branding` | object | Agency branding (logo, colors) |
| `engines` | array | Fire modeling engines |
| `dataSources` | object | Weather, fire points, fuel data sources |
| `roles` | array | Role definitions and permissions |
| `exportOptions` | object | Export format and delivery options |
| `features` | object | Feature flags and suppressions |
| `suppressDefaultSources` | boolean | Hide default/national data sources |

### Authentication (`auth`)

```json
{
  "auth": {
    "provider": "oidc",
    "oidc": {
      "issuer": "https://login.agency.gov",
      "clientId": "nomad-client",
      "scopes": ["openid", "profile", "email"]
    },
    "roleMappings": [
      { "externalRole": "AGENCY_ADMIN", "internalRole": "admin" },
      { "externalRole": "FIRE_ANALYST", "internalRole": "fban" }
    ],
    "sessionTimeout": 480,
    "allowAnonymous": false
  }
}
```

#### Provider Options

| Provider | Description | Required Fields |
|----------|-------------|-----------------|
| `"none"` | No authentication | - |
| `"simple"` | Built-in username/password (SAN mode) | - |
| `"oidc"` | OpenID Connect (ACN mode — not yet implemented) | `oidc.issuer`, `oidc.clientId`, `oidc.scopes` |
| `"saml"` | SAML 2.0 (ACN mode — not yet implemented) | `saml.idpMetadataUrl`, `saml.spEntityId`, `saml.acsUrl` |

> **Note**: `oidc` and `saml` providers are planned for ACN (Agency Centric Nomad) mode and are not yet implemented. SAN (Stand Alone Nomad) mode uses `simple` auth.

#### OIDC Configuration

| Field | Required | Description |
|-------|----------|-------------|
| `issuer` | Yes | OIDC issuer URL |
| `clientId` | Yes | OAuth client ID |
| `clientSecret` | No | OAuth client secret (store in env var instead) |
| `scopes` | Yes | Requested scopes |
| `authorizationEndpoint` | No | Override authorization endpoint |
| `tokenEndpoint` | No | Override token endpoint |
| `userInfoEndpoint` | No | Override userinfo endpoint |

#### SAML Configuration

| Field | Required | Description |
|-------|----------|-------------|
| `idpMetadataUrl` | Yes | Identity provider metadata URL |
| `spEntityId` | Yes | Service provider entity ID |
| `acsUrl` | Yes | Assertion consumer service URL |
| `sloUrl` | No | Single logout URL |
| `certificate` | No | SP certificate for signing |

#### Role Mappings

Map your agency's roles to Nomad's internal roles:

| Internal Role | Permissions |
|---------------|-------------|
| `admin` | Full system access (`*`) |
| `fban` | Create, view, export, delete models |
| `modeler` | Create, view, export models |
| `user` | View models only |
| `anonymous` | No model access |

### Branding (`branding`)

```json
{
  "branding": {
    "displayName": "NWT Fire Management",
    "logoUrl": "/configuration/nwt/assets/logo.png",
    "primaryColor": "#1a5c3e",
    "secondaryColor": "#0d2e1f"
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `displayName` | string | Name shown in UI header |
| `logoUrl` | string | Path or URL to agency logo |
| `primaryColor` | string | Hex color (e.g., `#2563eb`) |
| `secondaryColor` | string | Hex color for accents |

### Fire Engines (`engines`)

```json
{
  "engines": [
    {
      "engineType": "firestarr",
      "enabled": true,
      "settings": {}
    },
    {
      "engineType": "wise",
      "enabled": true,
      "settings": {
        "serverUrl": "https://wise.agency.gov"
      }
    }
  ]
}
```

| Engine Type | Description |
|-------------|-------------|
| `firestarr` | FireSTARR probabilistic fire modeling |
| `wise` | WISE deterministic fire modeling |

### Data Sources (`dataSources`)

```json
{
  "dataSources": {
    "weather": [
      {
        "id": "agency-wx-stations",
        "name": "Agency Weather Stations",
        "urls": ["https://api.agency.gov/weather"],
        "type": "API",
        "kind": "REST",
        "isDefault": true
      }
    ],
    "wildfirePoints": [
      {
        "id": "agency-hotspots",
        "name": "Agency Hotspot Feed",
        "urls": ["https://gis.agency.gov/wfs"],
        "type": "OWS",
        "kind": "WFS",
        "isDefault": true
      }
    ],
    "fuelTypes": [
      {
        "id": "agency-fuels",
        "name": "Agency Fuel Grid",
        "urls": ["https://gis.agency.gov/wcs"],
        "type": "OWS",
        "kind": "WCS",
        "isDefault": true
      }
    ]
  }
}
```

#### Data Source Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier |
| `name` | string | Display name |
| `urls` | string[] | Service endpoint URLs |
| `type` | `"API"` \| `"OWS"` | API or OGC Web Services |
| `kind` | `"REST"` \| `"WFS"` \| `"WCS"` | Service type |
| `isDefault` | boolean | Pre-selected in UI |

### Export Options (`exportOptions`)

```json
{
  "exportOptions": {
    "allowZipDownload": true,
    "allowShareableLink": true,
    "allowAgencyStorage": true,
    "availableFormats": ["geojson", "kml", "shapefile", "gpkg"]
  }
}
```

| Field | Description |
|-------|-------------|
| `allowZipDownload` | Enable ZIP download of results |
| `allowShareableLink` | Enable shareable result links |
| `allowAgencyStorage` | Enable saving to agency storage |
| `availableFormats` | Export formats to offer |

### Features (`features`)

```json
{
  "features": {
    "enabled": ["model-setup", "model-review", "export"],
    "suppressedEngines": [],
    "suppressedFeatures": []
  }
}
```

| Field | Description |
|-------|-------------|
| `enabled` | Core features to enable |
| `suppressedEngines` | Hide specific engines (`firestarr`, `wise`) |
| `suppressedFeatures` | Hide specific features |

## Environment Variable Overrides

These environment variables override config file values:

| Variable | Overrides | Description |
|----------|-----------|-------------|
| `NOMAD_AGENCY_ID` | `agencyId` | Which config folder to load |
| `NOMAD_DEPLOYMENT_MODE` | `deploymentMode` | `SAN` or `ACN` |

## Submodule Management

### Updating Agency Configuration

From the Project Nomad repository:

```bash
# Pull latest config changes
cd configuration/{agency-id}
git pull origin main
cd ../..
git add configuration/{agency-id}
git commit -m "Update {agency-id} configuration"
```

### Cloning with Submodules

When cloning Project Nomad with agency configs:

```bash
git clone --recurse-submodules git@github.com:WISE-Developers/project_nomad.git
```

Or after cloning:

```bash
git submodule update --init --recursive
```

## Validation

Configuration is validated on load against the JSON Schema. Validation errors are logged but don't prevent startup (lenient mode). Check logs for schema warnings:

```
[ConfigurationValidator] Schema validation warning: /auth/sessionTimeout must be integer
```

## Security Notes

- **Never commit secrets** to configuration files
- Store `clientSecret` in environment variables, not config
- Agency config repos should be private
- Use `.gitignore` to exclude local override files

## Schema Location

The JSON Schema is located at:
```
backend/src/core/config/schema/config.schema.json
```

Reference it in your config for IDE validation:
```json
{
  "$schema": "../../backend/src/core/config/schema/config.schema.json",
  "version": "2.0",
  ...
}
```
