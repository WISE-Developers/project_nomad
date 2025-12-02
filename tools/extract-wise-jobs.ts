#!/usr/bin/env npx ts-node
/**
 * WISE Job Data Extractor for FireSTARR Testing
 *
 * Scans WISE job folders and extracts fire modeling data into a consolidated
 * dataset ready for FireSTARR ingestion.
 *
 * Usage: npx ts-node tools/extract-wise-jobs.ts
 */

import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";

// Load .env from project root
dotenv.config({ path: path.join(__dirname, "..", ".env") });

// Types
interface WISEJobMetadata {
  jobId: string;
  sourcePath: string;
  sourceLocation: string;
  startTime: string | null;
  latitude: number | null;
  longitude: number | null;
  durationHours: number | null;
  fwi: {
    ffmc: number | null;
    dmc: number | null;
    dc: number | null;
  };
  ignitionSource: "ignition.json" | "fgmj" | null;
  hasWeather: boolean;
  hasWiseOutputs: boolean;
  extractionStatus: "success" | "partial" | "failed";
  errors: string[];
}

interface ManifestEntry extends WISEJobMetadata {
  outputPath: string;
}

interface Manifest {
  generatedAt: string;
  totalJobsFound: number;
  totalJobsExtracted: number;
  totalJobsFailed: number;
  sources: { path: string; jobCount: number }[];
  jobs: ManifestEntry[];
}

// Canadian FWI System calculations
function calculateISI(ffmc: number, windSpeed: number): number {
  const m = 147.2 * (101 - ffmc) / (59.5 + ffmc);
  const fW = Math.exp(0.05039 * windSpeed);
  const fF = 91.9 * Math.exp(-0.1386 * m) * (1 + Math.pow(m, 5.31) / 4.93e7);
  return 0.208 * fW * fF;
}

function calculateBUI(dmc: number, dc: number): number {
  if (dmc <= 0.4 * dc) {
    return (0.8 * dmc * dc) / (dmc + 0.4 * dc);
  }
  return dmc - (1 - 0.8 * dc / (dmc + 0.4 * dc)) * (0.92 + Math.pow(0.0114 * dmc, 1.7));
}

function calculateFWI(isi: number, bui: number): number {
  const fD = bui <= 80
    ? 0.626 * Math.pow(bui, 0.809) + 2
    : 1000 / (25 + 108.64 * Math.exp(-0.023 * bui));
  const B = 0.1 * isi * fD;
  return B <= 1 ? B : Math.exp(2.72 * Math.pow(0.434 * Math.log(B), 0.647));
}

// Parse SpotWX weather file
interface SpotWXRow {
  date: string;
  hour: number;
  temp: number;
  rh: number;
  wd: number;
  ws: number;
  precip: number;
}

function parseSpotWXWeather(content: string): SpotWXRow[] {
  const lines = content.trim().split("\n");
  const rows: SpotWXRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Format: HOURLY,HOUR,TEMP,RH,WD,WS,PRECIP or date, hour, temp, rh, wd, ws, precip
    const parts = line.split(",").map((p) => p.trim());
    if (parts.length < 6) continue;

    // Handle both formats
    let date: string, hour: number, temp: number, rh: number, wd: number, ws: number, precip: number;

    if (parts[0].includes("-")) {
      // Format: 2024-06-25, 00, 7.4, 53, 169, 1, 0.00
      date = parts[0];
      hour = parseInt(parts[1], 10);
      temp = parseFloat(parts[2]);
      rh = parseFloat(parts[3]);
      wd = parseFloat(parts[4]);
      ws = parseFloat(parts[5]);
      precip = parts.length > 6 ? parseFloat(parts[6]) : 0;
    } else {
      // Skip header row
      continue;
    }

    rows.push({ date, hour, temp, rh, wd, ws, precip });
  }

  return rows;
}

// Convert to FireSTARR weather CSV format
function convertToFireSTARRWeather(
  rows: SpotWXRow[],
  startingFFMC: number,
  startingDMC: number,
  startingDC: number
): string {
  const header = "Scenario,Date,PREC,TEMP,RH,WS,WD,FFMC,DMC,DC,ISI,BUI,FWI";
  const lines = [header];

  // For simplicity, use starting codes throughout (proper FWI hourly calculation is complex)
  const ffmc = startingFFMC;
  const dmc = startingDMC;
  const dc = startingDC;

  for (const row of rows) {
    const dateStr = `${row.date} ${row.hour.toString().padStart(2, "0")}:00:00`;
    const isi = calculateISI(ffmc, row.ws);
    const bui = calculateBUI(dmc, dc);
    const fwi = calculateFWI(isi, bui);

    lines.push(
      `0,${dateStr},${row.precip.toFixed(1)},${row.temp.toFixed(1)},${row.rh.toFixed(1)},${row.ws.toFixed(1)},${row.wd.toFixed(1)},${ffmc.toFixed(1)},${dmc.toFixed(1)},${dc.toFixed(1)},${isi.toFixed(2)},${bui.toFixed(2)},${fwi.toFixed(2)}`
    );
  }

  return lines.join("\n");
}

// Extract ignition from ignition.json
function extractIgnitionFromJSON(content: string): { geojson: object; centroid: [number, number] } | null {
  try {
    const data = JSON.parse(content);
    const features = data.features || [data];
    if (features.length === 0) return null;

    const feature = features[0];
    const coords = feature.geometry.coordinates;

    // Calculate centroid
    let centroid: [number, number];
    if (feature.geometry.type === "Point") {
      centroid = coords as [number, number];
    } else if (feature.geometry.type === "Polygon") {
      const ring = coords[0] as [number, number][];
      const sumLon = ring.reduce((acc, c) => acc + c[0], 0);
      const sumLat = ring.reduce((acc, c) => acc + c[1], 0);
      centroid = [sumLon / ring.length, sumLat / ring.length];
    } else if (feature.geometry.type === "LineString") {
      const line = coords as [number, number][];
      const sumLon = line.reduce((acc, c) => acc + c[0], 0);
      const sumLat = line.reduce((acc, c) => acc + c[1], 0);
      centroid = [sumLon / line.length, sumLat / line.length];
    } else {
      return null;
    }

    return { geojson: data, centroid };
  } catch {
    return null;
  }
}

// Extract ignition from FGMJ
function extractIgnitionFromFGMJ(fgmj: any): { geojson: object; centroid: [number, number] } | null {
  try {
    const ignitions = fgmj?.project?.ignitions?.ignitions;
    if (!ignitions || ignitions.length === 0) return null;

    const ignition = ignitions[0].ignition;
    const ignitionData = ignition?.ignitions?.ignitions?.[0];
    if (!ignitionData) return null;

    const polygon = ignitionData.polygon?.polygon;
    if (!polygon?.points || polygon.points.length === 0) return null;

    const points = polygon.points.map((p: any) => [p.x.value, p.y.value]);

    // Close polygon if needed
    if (
      points.length > 2 &&
      (points[0][0] !== points[points.length - 1][0] ||
        points[0][1] !== points[points.length - 1][1])
    ) {
      points.push([...points[0]]);
    }

    // Calculate centroid
    const sumLon = points.reduce((acc: number, c: number[]) => acc + c[0], 0);
    const sumLat = points.reduce((acc: number, c: number[]) => acc + c[1], 0);
    const centroid: [number, number] = [sumLon / points.length, sumLat / points.length];

    const geojson = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { source: "fgmj" },
          geometry: {
            type: "Polygon",
            coordinates: [points],
          },
        },
      ],
    };

    return { geojson, centroid };
  } catch {
    return null;
  }
}

// Extract FWI starting codes from FGMJ
function extractFWIFromFGMJ(fgmj: any): { ffmc: number | null; dmc: number | null; dc: number | null } {
  try {
    // Navigate to weather streams
    const streams = fgmj?.project?.weatherStreams?.streams;
    if (!streams || streams.length === 0) {
      return { ffmc: null, dmc: null, dc: null };
    }

    const stream = streams[0];
    const startingCodes = stream?.weatherStream?.startingCodes;
    if (!startingCodes) {
      return { ffmc: null, dmc: null, dc: null };
    }

    return {
      ffmc: startingCodes.ffmc?.value ?? null,
      dmc: startingCodes.dmc?.value ?? null,
      dc: startingCodes.dc?.value ?? null,
    };
  } catch {
    return { ffmc: null, dmc: null, dc: null };
  }
}

// Extract start time from FGMJ
function extractStartTimeFromFGMJ(fgmj: any): string | null {
  try {
    const ignitions = fgmj?.project?.ignitions?.ignitions;
    if (!ignitions || ignitions.length === 0) return null;

    const startTime = ignitions[0].ignition?.startTime?.time;
    return startTime || null;
  } catch {
    return null;
  }
}

// Copy WISE outputs if present
function copyWiseOutputs(jobPath: string, outputDir: string): boolean {
  const outputsPath = path.join(jobPath, "Outputs");
  if (!fs.existsSync(outputsPath)) return false;

  const files = fs.readdirSync(outputsPath);
  const relevantFiles = files.filter(
    (f) => f.endsWith(".json") || f.endsWith(".kml") || f.endsWith(".txt")
  );

  if (relevantFiles.length === 0) return false;

  const wiseOutputsDir = path.join(outputDir, "wise_outputs");
  fs.mkdirSync(wiseOutputsDir, { recursive: true });

  for (const file of relevantFiles) {
    // Skip macOS resource fork files
    if (file.startsWith("._")) continue;
    try {
      fs.copyFileSync(path.join(outputsPath, file), path.join(wiseOutputsDir, file));
    } catch {
      // Skip files that can't be copied
    }
  }

  return true;
}

// Process a single job
function processJob(
  jobPath: string,
  sourceLocation: string,
  outputBase: string
): WISEJobMetadata {
  const jobId = path.basename(jobPath);
  const metadata: WISEJobMetadata = {
    jobId,
    sourcePath: jobPath,
    sourceLocation,
    startTime: null,
    latitude: null,
    longitude: null,
    durationHours: null,
    fwi: { ffmc: null, dmc: null, dc: null },
    ignitionSource: null,
    hasWeather: false,
    hasWiseOutputs: false,
    extractionStatus: "failed",
    errors: [],
  };

  const outputDir = path.join(outputBase, jobId);

  try {
    // Parse FGMJ first (needed for FWI and possibly ignition)
    const fgmjPath = path.join(jobPath, "job.fgmj");
    let fgmj: any = null;
    if (fs.existsSync(fgmjPath)) {
      try {
        fgmj = JSON.parse(fs.readFileSync(fgmjPath, "utf-8"));
        metadata.fwi = extractFWIFromFGMJ(fgmj);
        metadata.startTime = extractStartTimeFromFGMJ(fgmj);
      } catch (e) {
        metadata.errors.push(`Failed to parse job.fgmj: ${e}`);
      }
    } else {
      metadata.errors.push("job.fgmj not found");
    }

    // Extract ignition (try ignition.json first, then FGMJ)
    const ignitionJsonPath = path.join(jobPath, "Inputs", "ignition.json");
    let ignitionResult: { geojson: object; centroid: [number, number] } | null = null;

    if (fs.existsSync(ignitionJsonPath)) {
      const content = fs.readFileSync(ignitionJsonPath, "utf-8");
      ignitionResult = extractIgnitionFromJSON(content);
      if (ignitionResult) {
        metadata.ignitionSource = "ignition.json";
      }
    }

    if (!ignitionResult && fgmj) {
      ignitionResult = extractIgnitionFromFGMJ(fgmj);
      if (ignitionResult) {
        metadata.ignitionSource = "fgmj";
      }
    }

    if (ignitionResult) {
      metadata.longitude = ignitionResult.centroid[0];
      metadata.latitude = ignitionResult.centroid[1];
    } else {
      metadata.errors.push("Could not extract ignition geometry");
    }

    // Parse weather
    const weatherPath = path.join(jobPath, "Inputs", "spotwx_forecast.txt");
    let weatherRows: SpotWXRow[] = [];
    if (fs.existsSync(weatherPath)) {
      const content = fs.readFileSync(weatherPath, "utf-8");
      weatherRows = parseSpotWXWeather(content);
      if (weatherRows.length > 0) {
        metadata.hasWeather = true;
        metadata.durationHours = weatherRows.length;
      } else {
        metadata.errors.push("Weather file empty or unparseable");
      }
    } else {
      metadata.errors.push("spotwx_forecast.txt not found");
    }

    // Only create output if we have minimum required data
    if (ignitionResult && weatherRows.length > 0) {
      fs.mkdirSync(outputDir, { recursive: true });

      // Write ignition GeoJSON
      fs.writeFileSync(
        path.join(outputDir, "ignition.geojson"),
        JSON.stringify(ignitionResult.geojson, null, 2)
      );

      // Convert and write weather
      const ffmc = metadata.fwi.ffmc ?? 85; // Default if not found
      const dmc = metadata.fwi.dmc ?? 25;
      const dc = metadata.fwi.dc ?? 200;
      const weatherCSV = convertToFireSTARRWeather(weatherRows, ffmc, dmc, dc);
      fs.writeFileSync(path.join(outputDir, "weather.csv"), weatherCSV);

      // Copy WISE outputs
      metadata.hasWiseOutputs = copyWiseOutputs(jobPath, outputDir);

      // Write metadata
      fs.writeFileSync(
        path.join(outputDir, "metadata.json"),
        JSON.stringify(
          {
            jobId: metadata.jobId,
            sourcePath: metadata.sourcePath,
            startTime: metadata.startTime,
            latitude: metadata.latitude,
            longitude: metadata.longitude,
            durationHours: metadata.durationHours,
            fwi: metadata.fwi,
            ignitionSource: metadata.ignitionSource,
            hasWiseOutputs: metadata.hasWiseOutputs,
          },
          null,
          2
        )
      );

      metadata.extractionStatus = metadata.errors.length > 0 ? "partial" : "success";
    } else {
      metadata.extractionStatus = "failed";
    }
  } catch (e) {
    metadata.errors.push(`Unexpected error: ${e}`);
    metadata.extractionStatus = "failed";
  }

  return metadata;
}

// Main
async function main() {
  const outputBase = path.join(__dirname, "..", "firestarr_test_data", "WiseModelData");

  // Collect source paths from env
  const sourcePaths: { name: string; path: string }[] = [];
  for (let i = 1; i <= 10; i++) {
    const envVar = `LOCAL_SOURCE_DATA${i}`;
    const p = process.env[envVar];
    if (p) {
      sourcePaths.push({ name: envVar, path: p });
    }
  }

  if (sourcePaths.length === 0) {
    console.error("No LOCAL_SOURCE_DATA* paths found in .env");
    process.exit(1);
  }

  console.log("WISE Job Data Extractor");
  console.log("=======================\n");
  console.log(`Output directory: ${outputBase}\n`);

  const manifest: Manifest = {
    generatedAt: new Date().toISOString(),
    totalJobsFound: 0,
    totalJobsExtracted: 0,
    totalJobsFailed: 0,
    sources: [],
    jobs: [],
  };

  // Process each source
  for (const source of sourcePaths) {
    console.log(`\nScanning: ${source.name}`);
    console.log(`  Path: ${source.path}`);

    if (!fs.existsSync(source.path)) {
      console.log(`  ⚠ Path not accessible (drive not mounted?)`);
      continue;
    }

    // Find job_* directories
    const entries = fs.readdirSync(source.path, { withFileTypes: true });
    const jobDirs = entries
      .filter((e) => e.isDirectory() && e.name.startsWith("job_"))
      .map((e) => e.name);

    console.log(`  Found ${jobDirs.length} job folders`);
    manifest.sources.push({ path: source.path, jobCount: jobDirs.length });
    manifest.totalJobsFound += jobDirs.length;

    // Process each job
    for (const jobDir of jobDirs) {
      const jobPath = path.join(source.path, jobDir);
      const result = processJob(jobPath, source.name, outputBase);

      const entry: ManifestEntry = {
        ...result,
        outputPath:
          result.extractionStatus !== "failed"
            ? path.join(outputBase, result.jobId)
            : "",
      };
      manifest.jobs.push(entry);

      if (result.extractionStatus === "success") {
        console.log(`  ✓ ${jobDir}`);
        manifest.totalJobsExtracted++;
      } else if (result.extractionStatus === "partial") {
        console.log(`  ~ ${jobDir} (partial: ${result.errors.join(", ")})`);
        manifest.totalJobsExtracted++;
      } else {
        console.log(`  ✗ ${jobDir} (${result.errors.join(", ")})`);
        manifest.totalJobsFailed++;
      }
    }
  }

  // Write manifest
  fs.writeFileSync(
    path.join(outputBase, "manifest.json"),
    JSON.stringify(manifest, null, 2)
  );

  // Summary
  console.log("\n=======================");
  console.log("Summary:");
  console.log(`  Total jobs found: ${manifest.totalJobsFound}`);
  console.log(`  Successfully extracted: ${manifest.totalJobsExtracted}`);
  console.log(`  Failed: ${manifest.totalJobsFailed}`);
  console.log(`\nManifest written to: ${path.join(outputBase, "manifest.json")}`);
}

main().catch(console.error);
