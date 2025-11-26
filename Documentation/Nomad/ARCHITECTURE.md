# Project Nomad Architecture

## Deployment Overview

### Servers
- **Server A**: EasyMap 3 application (existing)
- **Server B**: Project Nomad + FireSTARR (new)

Both servers are in private network (SSH access only).

### Dual Instance Strategy

Run Project Nomad on **both** servers:
- **Instance A** (on EM3 server): Frontend only - receives requests from EasyMap 3
- **Instance B** (on FireSTARR server): Full stack - executes models, stores results

**Communication:** Instance A → HTTP API → Instance B

## Server B Architecture (Primary)

```
┌─────────────────────────────────────────┐
│           Server B (FireSTARR)          │
│                                         │
│  ┌─────────────────────────────────┐   │
│  │   Node.js Backend API           │   │
│  │   - Express/TypeScript          │   │
│  │   - Job queue management        │   │
│  │   - FireSTARR orchestration     │   │
│  │   - PostGIS storage             │   │
│  │   - Output processing (GDAL)    │   │
│  └──────────┬──────────────────────┘   │
│             │                           │
│             │ child_process.spawn       │
│             ▼                           │
│  ┌─────────────────────────────────┐   │
│  │   Docker Compose                │   │
│  │   - firestarr-app container     │   │
│  └──────────┬──────────────────────┘   │
│             │                           │
│             │ Filesystem I/O            │
│             ▼                           │
│  ┌─────────────────────────────────┐   │
│  │   /appl/data/                   │   │
│  │   ├── sims/                     │   │
│  │   │   └── job_XXXXXX/           │   │
│  │   │       ├── weather.csv       │   │
│  │   │       ├── probability*.tif  │   │
│  │   │       └── firestarr.log     │   │
│  │   └── generated/grid/100m/      │   │
│  │       └── default/               │   │
│  │           ├── fuel_*.tif        │   │
│  │           └── dem_*.tif         │   │
│  └─────────────────────────────────┘   │
│                                         │
│  ┌─────────────────────────────────┐   │
│  │   PostGIS Database              │   │
│  │   - Model jobs                  │   │
│  │   - Output geometries           │   │
│  │   - User sessions               │   │
│  └─────────────────────────────────┘   │
└─────────────────────────────────────────┘
```

## Job Execution Flow

### 1. Job Submission
```
User clicks map → Frontend sends:
{
  lat: 62.4540,
  lon: -114.3718,
  startDate: "2024-07-15",
  startTime: "14:00",
  durationDays: 3
}
```

### 2. Backend Processing

**Step 1: Validate Input**
- Check lat/lon is in burnable fuel (sample fuel grid)
- Determine UTM zone
- Verify fuel/DEM grids exist for that zone

**Step 2: Fetch Weather Data**
- Call SpotWX API for location + date range
- Get hourly forecast (temp, RH, wind, precip)
- Fetch previous day FWI from CWFIS (or use defaults)
- Calculate FWI indices for each hour

**Step 3: Prepare FireSTARR Inputs**
```javascript
const jobId = `job_${Date.now()}_${randomId()}`;
const jobDir = `/appl/data/sims/${jobId}`;

// Create directory
fs.mkdirSync(jobDir, { recursive: true });

// Write weather CSV
fs.writeFileSync(`${jobDir}/weather.csv`, weatherCsvContent);

// Store job metadata in PostGIS
await db.query(`
  INSERT INTO model_jobs (job_id, lat, lon, start_date, status, created_at)
  VALUES ($1, $2, $3, $4, 'queued', NOW())
`, [jobId, lat, lon, startDate]);
```

**Step 4: Execute FireSTARR**
```javascript
const command = [
  'docker', 'compose', 'run', '--rm', 'firestarr-app',
  '/appl/firestarr/firestarr',
  `/appl/data/sims/${jobId}`,
  startDate,
  lat.toString(),
  lon.toString(),
  startTime,
  '--wx', `/appl/data/sims/${jobId}/weather.csv`,
  '--ffmc', ffmc.toString(),
  '--dmc', dmc.toString(),
  '--dc', dc.toString(),
  '--output_date_offsets', `[${durationDays}]`,
  '-v'
];

// Execute asynchronously
const child = spawn(command[0], command.slice(1));

// Update status to 'running'
await db.query(`UPDATE model_jobs SET status='running' WHERE job_id=$1`, [jobId]);

// Monitor completion
child.on('exit', async (code) => {
  if (code === 0) {
    await processOutputs(jobId);
  } else {
    await db.query(`UPDATE model_jobs SET status='failed' WHERE job_id=$1`, [jobId]);
  }
});
```

**Step 5: Process Outputs**
```javascript
async function processOutputs(jobId) {
  const jobDir = `/appl/data/sims/${jobId}`;

  // Check success
  const log = fs.readFileSync(`${jobDir}/firestarr.log`, 'utf8');
  if (!log.includes('Total simulation time was')) {
    throw new Error('FireSTARR run failed');
  }

  // Find probability TIFs
  const tifs = fs.readdirSync(jobDir).filter(f => f.startsWith('probability_'));

  for (const tif of tifs) {
    // Convert UTM TIF → WGS84 TIF
    execSync(`gdalwarp -t_srs EPSG:4326 ${jobDir}/${tif} ${jobDir}/${tif.replace('.tif', '_wgs84.tif')}`);

    // Generate 50% probability contour as GeoJSON
    execSync(`gdal_contour -f GeoJSON -fl 0.5 ${jobDir}/${tif.replace('.tif', '_wgs84.tif')} ${jobDir}/contour_50.geojson`);

    // Store in PostGIS
    const geojson = JSON.parse(fs.readFileSync(`${jobDir}/contour_50.geojson`, 'utf8'));
    await db.query(`
      UPDATE model_jobs
      SET status='completed',
          output_geom=ST_GeomFromGeoJSON($1),
          completed_at=NOW()
      WHERE job_id=$2
    `, [JSON.stringify(geojson.features[0].geometry), jobId]);
  }
}
```

### 3. Frontend Polling
```javascript
// Poll status every 5 seconds
const checkStatus = async () => {
  const response = await fetch(`/api/jobs/${jobId}/status`);
  const { status, progress, output } = await response.json();

  if (status === 'completed') {
    // Display fire perimeter on map
    map.addSource('fire-perimeter', {
      type: 'geojson',
      data: output
    });
    map.addLayer({
      id: 'fire-perimeter-layer',
      type: 'fill',
      source: 'fire-perimeter',
      paint: { 'fill-color': '#ff0000', 'fill-opacity': 0.3 }
    });
  }
};
```

## EasyMap 3 Integration

### Cross-Server Communication

**Option 1: HTTP API (Recommended for MVP)**

EasyMap 3 (Server A) → HTTP POST → Nomad (Server B)

```javascript
// On Server B (Nomad backend)
app.post('/api/jobs/submit', async (req, res) => {
  const { lat, lon, startDate, startTime, durationDays, userId } = req.body;

  const jobId = await submitJob({ lat, lon, startDate, startTime, durationDays });

  res.json({
    jobId,
    statusUrl: `/api/jobs/${jobId}/status`,
    resultUrl: `/api/jobs/${jobId}/result`
  });
});
```

**Option 2: Shared Database** (Future consideration)
- Both systems write/read from shared PostGIS
- Job queue table with status polling
- More complex but enables tighter integration

### Launch Flow from EasyMap 3

1. User selects fire point in EasyMap 3
2. EM3 opens Nomad URL with query params:
   ```
   https://nomad-server-b/model?lat=62.45&lon=-114.37&fireId=10N_50651
   ```
3. Nomad loads with pre-populated ignition point
4. User configures date/duration
5. Submit runs model on Server B
6. Results displayed in Nomad interface

## Technology Stack

### Backend
- **Runtime**: Node.js 20+ with TypeScript
- **Framework**: Express
- **Database**: PostGIS (PostgreSQL + PostGIS extension)
- **Job Queue**: Simple in-memory queue for MVP (upgrade to Bull/Redis later)
- **Geospatial**: GDAL CLI tools via child_process
- **Process Management**: PM2 for production

### Frontend
- **Framework**: React 18 with TypeScript
- **Map**: MapBox GL JS
- **Build Tool**: Vite
- **UI**: Minimal CSS (no framework needed for MVP)
- **HTTP Client**: Fetch API

### Infrastructure
- **Containerization**: Docker Compose
- **Reverse Proxy**: Nginx (for HTTPS, routing)
- **Process Manager**: PM2 or systemd

## Security Considerations

### MVP Security
- Private network (SSH only) - no public exposure initially
- Basic authentication for frontend (if needed)
- Input validation (lat/lon bounds, SQL injection prevention)
- File path sanitization for job directories

### Production Security (Post-MVP)
- HTTPS with proper certificates
- OAuth integration with agency auth systems
- Rate limiting on job submissions
- Disk quota per user
- Job timeout limits
- Output file cleanup cron job

## File Structure

```
project_nomad/
├── backend/
│   ├── src/
│   │   ├── index.ts              # Express app entry point
│   │   ├── routes/
│   │   │   ├── jobs.ts           # Job submission/status endpoints
│   │   │   └── health.ts         # Health check
│   │   ├── services/
│   │   │   ├── firestarr.ts      # FireSTARR execution
│   │   │   ├── weather.ts        # SpotWX integration
│   │   │   ├── fwi.ts            # FWI calculations
│   │   │   └── processing.ts     # Output processing
│   │   ├── db/
│   │   │   ├── connection.ts     # PostGIS connection
│   │   │   └── schema.sql        # Database schema
│   │   └── types/
│   │       └── index.ts          # TypeScript types
│   ├── package.json
│   └── tsconfig.json
├── frontend/
│   ├── src/
│   │   ├── App.tsx               # Main React component
│   │   ├── components/
│   │   │   ├── Map.tsx           # MapBox map
│   │   │   ├── Wizard.tsx        # Input wizard
│   │   │   └── StatusPanel.tsx   # Job status display
│   │   └── main.tsx              # Entry point
│   ├── package.json
│   ├── tsconfig.json
│   └── vite.config.ts
├── firestarr_data/               # Mounted to Docker
├── docker-compose.yaml           # FireSTARR container
└── ARCHITECTURE.md               # This file
```

## MVP Scope Reminder

For January 2026 deadline:
- ✅ Point ignition only (no perimeters)
- ✅ Single duration output (final day only)
- ✅ 50% probability contour (not full raster)
- ✅ Automatic weather (SpotWX + FWI calc)
- ✅ Basic UI (functional, not polished)
- ✅ EasyMap 3 launch via URL params
- ❌ No export workflow
- ❌ No mobile optimization
- ❌ No model history/review
- ❌ No configuration system

## Next Steps

1. Set up Node.js backend project structure
2. Implement FireSTARR orchestration service
3. Build weather integration (SpotWX + FWI)
4. Create output processing pipeline
5. Build React frontend with MapBox
6. Test end-to-end with real FireSTARR runs
7. Deploy to Server B
8. Integrate with EasyMap 3 launch
