# Creative Brief: Introducing Project Nomad

## Purpose

This document provides everything needed to produce a marketing video introducing Project Nomad. It assumes zero prior knowledge of the project, the fire modeling domain, or the Canadian wildfire management landscape.

---

## What Is Project Nomad?

Project Nomad is an open-source, web-based fire modeling application for Canadian wildfire management. It gives wildfire professionals a modern, map-driven interface to run fire behavior simulations - predicting where a wildfire will spread, how intense it will be, and the probability of burn across the landscape.

Think of it as **Google Maps meets wildfire science**. A professional draws an ignition point on a 3D terrain map, sets a time window, picks a fire model, and within minutes receives a probabilistic burn map showing where fire is likely to spread.

Before Nomad, this kind of analysis required specialized desktop software, deep technical expertise, and significant setup time. Nomad makes it accessible from a web browser.

**Tagline:** *Democratizing fire modeling to save lives.*

**License:** AGPLv3 (free and open-source)

---

## The Problem Nomad Solves

### Wildfires Are Getting Worse

Canada is experiencing unprecedented wildfire seasons. The 2023 season burned over 18 million hectares - more than double the previous record. Communities are evacuated with hours of warning. Fire managers make life-or-death resource allocation decisions under extreme time pressure.

### Fire Modeling Is Inaccessible

The science to predict fire behavior exists. Canada has world-class fire behavior prediction systems developed over decades. But the tools to run those models are:

- **Complex** - Legacy desktop software requiring specialized training
- **Slow to set up** - Hours of data preparation before a single simulation runs
- **Limited in access** - Installed on specific workstations, not available in the field
- **Single-scenario** - Most tools show one deterministic outcome, not probability distributions

When a fire is approaching a community, the analyst who can predict its path shouldn't need a PhD in software configuration to run a model.

### The Gap

There is no modern, web-based, open-source fire modeling GUI in Canada. Agencies either use legacy tools, build expensive custom solutions, or go without. Nomad fills that gap.

---

## Who Is It For?

### Primary Audience

| Role | What They Do | How Nomad Helps |
|------|-------------|-----------------|
| **Fire Behavior Analyst (FBAN)** | Predicts fire spread to guide strategy | Run probabilistic models from any device, visualize burn probability on a 3D map |
| **Incident Commander** | Makes tactical decisions during wildfires | Faster access to fire predictions for evacuation and resource deployment |
| **Fire Modeler** | Runs simulations for planning and analysis | Streamlined wizard workflow replaces hours of manual data preparation |
| **Agency Decision Maker** | Allocates resources across a jurisdiction | See multiple fire scenarios simultaneously on a shared web platform |

### Secondary Audience

- **Provincial and territorial wildfire agencies** (Government of NWT, Alberta Wildfire, Ontario MNRF)
- **Federal agencies** (Natural Resources Canada, Canadian Forest Service)
- **Emergency management organizations**
- **Researchers and academics** studying fire behavior

### The Human Stakes

These users protect communities. When an FBAN runs a model showing 80% burn probability reaching a town in 36 hours, that prediction triggers evacuation orders. Minutes matter. Accessibility matters. Getting a model running in 5 minutes instead of 5 hours can be the difference between orderly evacuation and crisis.

---

## What Does Nomad Actually Do?

### The Core Workflow (5 Steps)

Nomad uses a guided wizard to take a user from "I see a fire" to "here's what it will do":

1. **Location** - Draw an ignition point, line, or polygon directly on the map, enter coordinates manually, or upload a GeoJSON/KML file
2. **Time Range** - Set simulation start time and duration (1 to 720 hours). Nomad auto-detects whether to use forecast or historical weather data based on the dates
3. **Model Selection** - Choose the fire engine (FireSTARR) and simulation type (deterministic or probabilistic)
4. **Weather** - Enter Fire Weather Index values manually or upload a weather data file
5. **Review & Execute** - Confirm parameters and submit. The model runs on the server and streams real-time progress back to the browser

### What You Get Back

- **Burn probability maps** - Color-coded surfaces showing likelihood of fire reaching each point on the landscape (0-100%)
- **Fire perimeter contours** - Predicted fire boundaries at each time step
- **Time-stepped animation** - Watch the fire grow hour by hour across the terrain
- **Exportable results** - Download in GeoTIFF, GeoJSON, KML, or Shapefile format

### The Map Experience

- **MapBox GL** powered 3D terrain with satellite, street, and physical basemaps
- **Drawing tools** - Point, line, and polygon for spatial input directly on the map
- **Layer controls** - Toggle result layers, adjust opacity, compare scenarios
- **Canada boundary validation** - Ensures inputs fall within supported coverage areas

### Dashboard

- Track all running, completed, and draft models
- Search and organize by date, location, or status
- Resume incomplete model setups

---

## The Science Behind It

### FireSTARR - The Fire Engine

Nomad's fire modeling power comes from **FireSTARR**, an open-source probabilistic fire spread simulation system built in C++23.

**What makes FireSTARR special:**

- **Monte Carlo simulation** - Runs hundreds or thousands of fire spread scenarios with stochastic weather variations, then aggregates results into probability surfaces
- **Canadian FBP System** - Implements the Canadian Fire Behaviour Prediction System (Standard ST-X-3), the national standard for fire behavior calculation
- **FWI System** - Uses the Fire Weather Index system, Canada's standard for rating fire danger
- **National fuel data** - 100-meter resolution fuel type grids covering all of Canada
- **Published science** - Peer-reviewed in MDPI Fire (2020): *Assembling and Customizing Multiple Fire Weather Forecasts for Burn Probability and Other Fire Management Applications in Ontario, Canada*

**How it works in plain language:**

Imagine running 1,000 slightly different versions of a fire, each with small variations in wind, temperature, and humidity. Some simulations burn north, some east, some barely spread at all. Overlay all 1,000 results and you get a heat map: "this area has a 95% chance of burning, this area 40%, this area 5%." That's probabilistic fire modeling. That's what gives decision-makers confidence intervals, not just guesses.

**Performance:** A typical simulation runs 2-45 minutes depending on fire size and duration.

### Scientific Credibility

- Developed under the **Canadian Wildland Fire Modelling Framework (CWFMF)**
- Used operationally by the **Government of Northwest Territories**
- Published: [Burn Probability and Fire Management Applications (MDPI Fire, 2020)](https://www.mdpi.com/2571-6255/3/2/16)
- Open source: [github.com/CWFMF/firestarr-cpp](https://github.com/CWFMF/firestarr-cpp)

---

## How Is It Deployed?

### Two Modes

**SAN (Stand Alone Nomad)** - Currently available
- Self-contained application for individual users or small teams
- Interactive installer handles everything (Node.js, dependencies, database, FireSTARR engine, 50GB national fuel/terrain dataset)
- Runs on Linux, macOS, or Windows (Docker or bare metal)
- SQLite database - no external services required
- Perfect for: field offices, demonstrations, research labs, standalone deployments

**ACN (Agency Centric Nomad)** - Coming post-MVP
- Embeddable component that integrates into existing agency decision support systems
- Agency-owned infrastructure with PostGIS, authentication deferred to host application
- White-label customization (theming, branding, feature toggles)
- openNomad API adapter pattern for backend integration
- Perfect for: provincial agencies integrating fire modeling into existing platforms

### Real-World Deployment

The Government of Northwest Territories is deploying Nomad integrated with their **IntelliFire** decision support system for operational wildfire response. This is not a prototype - it's being used by the people who fight fires.

---

## Technical Stack

| Layer | Technology |
|-------|-----------|
| Frontend | TypeScript, React 18, Vite |
| Map Engine | MapBox GL JS |
| Backend | Node.js 20+, Express, TypeScript |
| Database | SQLite (SAN) / PostGIS (ACN) |
| Fire Engine | FireSTARR (C++23) |
| Spatial Processing | GDAL, GeoTIFF, PROJ |
| Real-time Updates | Server-Sent Events (SSE) |
| Deployment | Docker or bare metal (Linux, macOS, Windows) |
| License | AGPLv3 |

---

## Current Status (February 2026)

**MVP Phase 1 is complete.** This is a working application, not a concept.

### What works today:
- Full 5-step model setup wizard
- Interactive 3D MapBox terrain map with drawing tools
- FireSTARR engine integration with real probabilistic fire simulation
- Real-time job progress streaming via SSE
- Burn probability visualization on map with time-step animation
- Export to GeoTIFF, GeoJSON, KML, Shapefile
- Model dashboard with search and management
- Interactive installer for easy deployment
- Docker and bare metal deployment options
- 50GB national fuel/DEM dataset integration

### Coming next:
- Full Progressive Web App with offline capability
- Push notifications for model completion
- Mobile-responsive UI
- Weather API integration for automated data retrieval

---

## What Makes Nomad Different?

| Traditional Fire Modeling | Project Nomad |
|--------------------------|---------------|
| Desktop software, specific workstations | Web browser, any device |
| Hours of data preparation | 5-step wizard, minutes to execute |
| Single deterministic scenario | Probabilistic burn maps (Monte Carlo) |
| Proprietary, expensive licensing | Open-source, AGPLv3, free |
| Requires specialized training | Guided workflow, intuitive UI |
| Isolated results | Shareable, exportable, embeddable |
| One agency's custom build | National platform, agency-configurable |

---

## Visual Reference

### Screenshot

A screenshot of the MVP is available at: `assets/screenshots/Screenshot_mvp_v0.png`

**What it shows:**
- A 3D terrain map with green forested mountains and blue rivers
- A yellow polygon drawn on the map representing an ignition area
- The "New Fire Model" wizard panel open on the right side, showing Step 2 (Time Range) with date pickers and duration slider
- Drawing tools (Point, Line, Polygon) visible on the left
- Clean, modern, professional UI design

### Color Palette and Visual Identity

- **Map-centric design** - The map dominates the interface, UI panels are secondary
- **Clean, professional aesthetic** - Not flashy, not gamified. This is a tool for professionals making life-or-death decisions
- **Fire-themed accents** - Orange/amber for fire-related actions and highlights
- **High contrast** - Probability maps use intuitive color gradients (cool to hot) against terrain

---

## Messaging Framework

### The One-Liner
> *Project Nomad: Open-source fire modeling for everyone who protects communities from wildfire.*

### The Elevator Pitch
> *Wildfires are getting worse, but the tools to predict them haven't kept up. Project Nomad is an open-source, web-based fire modeling platform that lets wildfire professionals run probabilistic burn simulations from a browser. Draw a point on a map, set a time window, and within minutes see where fire is likely to spread. Built on proven Canadian fire science, deployable anywhere, free for every agency that needs it.*

### The Emotional Core
> *When a fire is approaching a community, the people protecting that community shouldn't need specialized software training to predict where it's going. They need answers, fast. Nomad exists because fire modeling shouldn't be a privilege - it should be a tool as accessible as the map it runs on.*

### Key Phrases
- "Democratizing fire modeling"
- "From ignition to insight in minutes"
- "Probability, not guesswork"
- "Built on decades of Canadian fire science"
- "Open-source, free for every agency"
- "The map is the interface"

---

## Video Tone and Style Guidance

### Tone
- **Authoritative but accessible** - This is serious science made usable, not dumbed down
- **Urgent but hopeful** - The wildfire problem is real and growing, but Nomad is a concrete solution
- **Professional** - This serves government agencies and emergency responders, not casual consumers
- **Human** - Behind every model run is a community that might need to evacuate

### What to avoid
- Disaster porn / gratuitous fire footage without purpose
- Overselling - Nomad is a tool, not a silver bullet
- Technical jargon without explanation
- Making it look like a toy or game

### Visual suggestions
- Aerial footage of Canadian boreal forest and wildfire landscapes
- Screen recordings or animations of the Nomad interface
- The contrast between complex legacy tools and Nomad's clean wizard workflow
- Maps coming alive with burn probability gradients
- The human element: analysts at work, communities being protected

---

## Links and Resources

| Resource | URL |
|----------|-----|
| Project Nomad (GitHub) | [github.com/WISE-Developers/project_nomad](https://github.com/WISE-Developers/project_nomad) |
| FireSTARR Engine (GitHub) | [github.com/CWFMF/firestarr-cpp](https://github.com/CWFMF/firestarr-cpp) |
| FireSTARR Science Paper | [MDPI Fire (2020)](https://www.mdpi.com/2571-6255/3/2/16) |
| Canadian FBP System (ST-X-3) | National fire behavior prediction standard |
| CWFMF | Canadian Wildland Fire Modelling Framework |

---

## Credits

**Project Lead:** Franco Nogarin, Government of Northwest Territories

**Fire Engine:** Jordan Evens (FireSTARR), Canadian Wildland Fire Modelling Framework

**License:** AGPLv3 - Free and open-source for all Canadian agencies and beyond
