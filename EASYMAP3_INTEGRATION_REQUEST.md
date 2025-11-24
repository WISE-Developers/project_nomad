# EasyMap 3 Integration Requirements Request

**Project**: Project Nomad Fire Modeling GUI Integration
**Target Date**: End of January 2026
**Purpose**: Functional proof of concept for fire modeling interface integrated into EasyMap 3

## Executive Summary

Project Nomad is developing a MapBox GL-based fire modeling interface that will be integrated as a component into EasyMap 3. We need technical specifications to ensure seamless integration for a working prototype by end of January 2026.

## Critical Integration Questions

### 1. Component Architecture
- **How are third-party components integrated into EasyMap 3?**
  - React component embedding?
  - iFrame with message passing?
  - Web component/custom element?
  - Full page with navigation?

- **What's the component lifecycle?**
  - How is Nomad launched from EasyMap 3?
  - How does Nomad return control to EasyMap 3?
  - Can state be passed back to EasyMap 3 on completion?

### 2. Authentication & Authorization
- **What authentication system does EasyMap 3 use?**
  - Session tokens?
  - JWT?
  - OAuth?
  - Other?

- **How should Nomad validate user identity?**
  - Shared session cookies?
  - Token passed in URL/headers?
  - Backend-to-backend validation?

- **What user information is available?**
  - User ID
  - Username/email
  - Roles/permissions
  - Agency affiliation

### 3. Spatial Data Integration
- **Database access:**
  - Does Nomad get direct PostGIS database access?
  - Or must we use EasyMap 3 APIs/services?
  - Connection details (if direct access): host, database name, schema patterns

- **Spatial data exchange:**
  - When launching Nomad, how is spatial context passed? (GeoJSON? WKT? Database ID?)
  - Expected coordinate system (EPSG code)?
  - Should Nomad store outputs in EasyMap 3 database or separate?

### 4. Launch Context
- **How will users launch Nomad from EasyMap 3?**
  - Right-click context menu on fire point/polygon?
  - Button in toolbar?
  - Menu item?
  - Multiple entry points?

- **What context data can be passed at launch?**
  - Selected fire geometry
  - Fire ID/name from DIP
  - Current map extent/zoom
  - Date/time context
  - Any existing fire metadata

### 5. Data Sources
- **Weather data:**
  - Does EasyMap 3 have existing weather station data/APIs we should use?
  - Format and access method?

- **Fuel types:**
  - NWT fuel type data availability (WCS/WFS endpoints or direct access)?
  - DEM data access?

- **Fire data:**
  - Hotspot data sources (MODIS/VIIRS) - do you already ingest these?
  - Fire polygon/point data from DIP - format and access method?

### 6. Technical Environment
- **Deployment:**
  - Will Nomad be deployed on same infrastructure as EasyMap 3?
  - Or separate server with cross-origin considerations?
  - What's the deployment process?

- **Backend services:**
  - Can Nomad run its own Node.js backend service?
  - Or must it use EasyMap 3's backend exclusively?
  - Where will long-running model execution processes run?

- **Technology constraints:**
  - Browser compatibility requirements?
  - Network/firewall considerations for MapBox API access?
  - Any technology restrictions (specific frameworks, libraries to avoid)?

### 7. Model Output Storage
- **Where should model results be stored?**
  - In EasyMap 3's PostGIS database?
  - Separate database?
  - File storage with database references?

- **Should model outputs be visible in EasyMap 3's main map interface?**
  - As layers users can toggle?
  - In a separate "models" section?

### 8. Notification System
- **Does EasyMap 3 have existing notification infrastructure?**
  - Email service?
  - In-app notifications?
  - Should we integrate with these or build separate?

## Additional Information Needed

- **EasyMap 3 architecture documentation** (if available)
- **Example integration** of another third-party component (if any exist)
- **Development/staging environment access** for integration testing
- **Contact person** for technical questions during development

## Timeline

We're targeting end of January 2026 for a functional proof of concept. Early feedback on these questions (by mid-December if possible) would greatly help ensure successful integration.

## Next Steps

Once we receive answers to these questions, we can:
1. Finalize the integration architecture
2. Set up development environment
3. Begin implementation with correct integration patterns
4. Schedule integration testing with EasyMap 3 team

Please let us know if you need any clarification on these questions or if there are additional integration considerations we should be aware of.

Thank you for your collaboration on this project.
