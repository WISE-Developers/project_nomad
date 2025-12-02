#!/usr/bin/env npx ts-node
/**
 * FWI Recalculation Script
 *
 * Uses the official cffdrs library to properly calculate FWI indices
 * for all weather.csv files in the test dataset.
 *
 * The starting codes from metadata.json are used to initialize the
 * progressive calculation of FFMC, DMC, and DC.
 *
 * Usage: npx tsx tools/recalculate-fwi.ts
 */

import * as fs from "fs";
import * as path from "path";
import { ffmc, dmc, dc, isi, bui, fwi } from "cffdrs";

const DATASET_PATH = path.join(__dirname, "..", "firestarr_test_data", "WiseModelData");

interface Metadata {
  jobId: string;
  latitude: number;
  fwi: {
    ffmc: number | null;
    dmc: number | null;
    dc: number | null;
  };
}

interface WeatherRecord {
  scenario: number;
  date: string;
  prec: number;
  temp: number;
  rh: number;
  ws: number;
  wd: number;
}

function parseWeatherCSV(content: string): WeatherRecord[] {
  const lines = content.trim().split("\n");
  const records: WeatherRecord[] = [];

  // Skip header
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(",");
    if (parts.length < 7) continue;

    records.push({
      scenario: parseInt(parts[0], 10),
      date: parts[1],
      prec: parseFloat(parts[2]),
      temp: parseFloat(parts[3]),
      rh: parseFloat(parts[4]),
      ws: parseFloat(parts[5]),
      wd: parseFloat(parts[6]),
    });
  }

  return records;
}

function extractMonth(dateStr: string): number {
  // Format: "2024-06-25 00:00:00"
  const match = dateStr.match(/\d{4}-(\d{2})-\d{2}/);
  return match ? parseInt(match[1], 10) : 6; // Default to June if parsing fails
}

function formatNumber(n: number, decimals: number = 1): string {
  return n.toFixed(decimals);
}

function recalculateWeather(
  records: WeatherRecord[],
  startingFFMC: number,
  startingDMC: number,
  startingDC: number,
  latitude: number
): string {
  const header = "Scenario,Date,PREC,TEMP,RH,WS,WD,FFMC,DMC,DC,ISI,BUI,FWI";
  const lines = [header];

  let prevFFMC = startingFFMC;
  let prevDMC = startingDMC;
  let prevDC = startingDC;

  for (const record of records) {
    const month = extractMonth(record.date);

    // Calculate new moisture codes using cffdrs
    const newFFMC = ffmc(prevFFMC, record.temp, record.rh, record.ws, record.prec);
    const newDMC = dmc(prevDMC, record.temp, record.rh, record.prec, latitude, month);
    const newDC = dc(prevDC, record.temp, record.rh, record.prec, latitude, month);

    // Calculate intermediate indices
    const newISI = isi(newFFMC, record.ws);
    const newBUI = bui(newDMC, newDC);
    const newFWI = fwi(newISI, newBUI);

    // Format line
    lines.push(
      `${record.scenario},${record.date},${formatNumber(record.prec)},${formatNumber(record.temp)},${formatNumber(record.rh)},${formatNumber(record.ws)},${formatNumber(record.wd)},${formatNumber(newFFMC)},${formatNumber(newDMC)},${formatNumber(newDC)},${formatNumber(newISI, 2)},${formatNumber(newBUI, 2)},${formatNumber(newFWI, 2)}`
    );

    // Update previous values for next iteration
    prevFFMC = newFFMC;
    prevDMC = newDMC;
    prevDC = newDC;
  }

  return lines.join("\n");
}

function processJob(jobDir: string): { success: boolean; error?: string } {
  const metadataPath = path.join(jobDir, "metadata.json");
  const weatherPath = path.join(jobDir, "weather.csv");

  // Check files exist
  if (!fs.existsSync(metadataPath)) {
    return { success: false, error: "No metadata.json" };
  }
  if (!fs.existsSync(weatherPath)) {
    return { success: false, error: "No weather.csv" };
  }

  try {
    // Read metadata
    const metadata: Metadata = JSON.parse(fs.readFileSync(metadataPath, "utf-8"));

    // Validate FWI starting codes
    if (
      metadata.fwi.ffmc === null ||
      metadata.fwi.dmc === null ||
      metadata.fwi.dc === null
    ) {
      return { success: false, error: "Missing FWI starting codes" };
    }

    if (metadata.latitude === null) {
      return { success: false, error: "Missing latitude" };
    }

    // Read and parse weather
    const weatherContent = fs.readFileSync(weatherPath, "utf-8");
    const records = parseWeatherCSV(weatherContent);

    if (records.length === 0) {
      return { success: false, error: "No weather records" };
    }

    // Recalculate
    const newWeather = recalculateWeather(
      records,
      metadata.fwi.ffmc,
      metadata.fwi.dmc,
      metadata.fwi.dc,
      metadata.latitude
    );

    // Write updated file
    fs.writeFileSync(weatherPath, newWeather);

    return { success: true };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

function main() {
  console.log("FWI Recalculation Script");
  console.log("========================");
  console.log(`Using cffdrs library for Canadian FWI System calculations\n`);
  console.log(`Dataset: ${DATASET_PATH}\n`);

  // Find all job directories
  const entries = fs.readdirSync(DATASET_PATH, { withFileTypes: true });
  const jobDirs = entries
    .filter((e) => e.isDirectory() && e.name.startsWith("job_"))
    .map((e) => e.name);

  console.log(`Found ${jobDirs.length} job folders\n`);

  let successCount = 0;
  let failCount = 0;

  for (const jobDir of jobDirs) {
    const fullPath = path.join(DATASET_PATH, jobDir);
    const result = processJob(fullPath);

    if (result.success) {
      console.log(`✓ ${jobDir}`);
      successCount++;
    } else {
      console.log(`✗ ${jobDir}: ${result.error}`);
      failCount++;
    }
  }

  console.log("\n========================");
  console.log(`Successfully recalculated: ${successCount}`);
  console.log(`Failed: ${failCount}`);
}

main();
