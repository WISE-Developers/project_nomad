/**
 * Weather Service
 *
 * Handles weather data resolution from CSV uploads or external APIs.
 * Uses the cffdrs library for proper FWI calculation from raw weather data.
 */

import { ffmc, dmc, dc, isi, bui, fwi } from 'cffdrs';
import { DateTime, IANAZone } from 'luxon';
import { localDayKey, localMonth, pickDailyDriverIndices } from './localCalendar.js';
import type {
  WeatherConfig,
  FWIStartingCodes,
  WeatherDataPoint,
  WeatherLocation,
  WeatherDateRange,
} from './types.js';

/**
 * Parses a bare-timestamp string (FireSTARR "YYYY-MM-DD HH:mm:ss" or ISO-ish
 * "YYYY-MM-DDTHH:mm:ss") against an explicit IANA timezone. The CSV format
 * carries no offset, so the zone MUST be supplied externally.
 */
/**
 * Reads a naive weather timestamp as LOCAL time in the model's timezone.
 *
 * This is the timezone contract for uploaded weather (#354): the Date column of
 * a FireSTARR CSV carries local time in the zone the model declares, never UTC.
 * The upload UI states it, and this is where it is enforced —
 * DateTime.fromSQL(raw, { zone }) interprets the naive string IN that zone.
 *
 * A consequence worth knowing when reasoning about detection: a naive timestamp
 * parsed in zone Z always reads back as the same wall-clock hour in Z, so the
 * declared zone cannot shift a row's local hour. A file whose daily CFFDRS rows
 * do not land at local noon is therefore telling you its timestamps are on a
 * different clock than declared — see describeDailyRhythm in dailyCffdrs.ts,
 * which measures exactly that and is surfaced by the pre-flight check.
 */
function parseTimestampInZone(raw: string, zone: string): Date {
  const sql = DateTime.fromSQL(raw, { zone });
  if (sql.isValid) return sql.toJSDate();
  const iso = DateTime.fromISO(raw, { zone });
  if (iso.isValid) return iso.toJSDate();
  throw new Error(`Unparseable weather timestamp "${raw}" (zone: ${zone})`);
}

/**
 * Raw weather record parsed from CSV (without FWI columns)
 */
interface RawWeatherRecord {
  scenario: number;
  datetime: Date;
  prec: number;
  temp: number;
  rh: number;
  ws: number;
  wd: number;
}

/**
 * FireSTARR weather record parsed from CSV (with FWI columns)
 */
interface FirestarrWeatherRecord extends RawWeatherRecord {
  ffmc: number;
  dmc: number;
  dc: number;
  isi: number;
  bui: number;
  fwi: number;
}

/**
 * Weather service for resolving weather data.
 *
 * Supports:
 * - FireSTARR CSV: Pre-calculated weather with all FWI columns
 * - Raw Weather CSV: Weather without FWI + starting codes -> calculates using cffdrs
 * - SpotWX API integration (future)
 */
export class WeatherService {
  /**
   * Resolves weather data based on configuration.
   *
   * @param config - Weather source configuration
   * @param location - Location for weather query (provides latitude for raw_weather)
   * @param dateRange - Date range for weather data (used for SpotWX)
   * @returns Array of hourly weather data points
   */
  async resolveWeather(
    config: WeatherConfig,
    location: WeatherLocation,
    dateRange: WeatherDateRange
  ): Promise<WeatherDataPoint[]> {
    if (config.source === 'firestarr_csv') {
      if (!config.firestarrCsvContent) {
        throw new Error('FireSTARR CSV content required when source is "firestarr_csv"');
      }
      if (typeof config.timezone !== 'string' || config.timezone.length === 0) {
        throw new Error(
          'WeatherService: IANA timezone is required for source "firestarr_csv" ' +
          '(CSV timestamps carry no offset; caller must pass options.timezone).',
        );
      }
      if (!IANAZone.isValidZone(config.timezone)) {
        throw new Error(
          `WeatherService: invalid IANA timezone "${config.timezone}". ` +
          'Use a valid IANA zone (e.g. "America/Vancouver").',
        );
      }
      return this.parseFirestarrCsv(config.firestarrCsvContent, config.timezone);
    }

    if (config.source === 'raw_weather') {
      if (!config.rawWeatherContent) {
        throw new Error('Raw weather CSV content required when source is "raw_weather"');
      }
      if (!config.startingCodes) {
        throw new Error('Starting codes required when source is "raw_weather"');
      }
      const latitude = config.latitude ?? location.latitude;
      if (!latitude) {
        throw new Error('Latitude required for CFFDRS calculation');
      }
      if (typeof config.timezone !== 'string' || config.timezone.length === 0 || !IANAZone.isValidZone(config.timezone)) {
        throw new Error(
          'WeatherService: valid IANA timezone is required for source "raw_weather" ' +
          '(CSV timestamps carry no offset; caller must pass options.timezone).',
        );
      }
      return this.processRawWeather(config.rawWeatherContent, config.startingCodes, latitude, config.timezone);
    }

    if (config.source === 'spotwx') {
      // SpotWX integration - use API key from config or env
      const apiKey = config.spotwx?.apiKey ?? process.env.SPOTWX_API_KEY;
      if (!apiKey) {
        throw new Error('SpotWX API key required (set SPOTWX_API_KEY or provide in request)');
      }
      if (typeof config.timezone !== 'string' || config.timezone.length === 0 || !IANAZone.isValidZone(config.timezone)) {
        throw new Error(
          'WeatherService: valid IANA timezone is required for source "spotwx" ' +
          '(SpotWX response timestamps must be parsed against the sim zone).',
        );
      }
      return this.fetchFromSpotWX(apiKey, location, dateRange, config.timezone);
    }

    throw new Error(`Unknown weather source: ${config.source}`);
  }

  /**
   * Parses a FireSTARR-ready CSV file.
   * Expected format: Scenario,Date,PREC,TEMP,RH,WS,WD,FFMC,DMC,DC,ISI,BUI,FWI
   *
   * @param content - CSV file content
   * @returns Array of weather data points
   */
  private parseFirestarrCsv(content: string, timezone: string): WeatherDataPoint[] {
    const lines = content.trim().split('\n');
    if (lines.length < 2) {
      throw new Error('FireSTARR CSV must have header and at least one data row');
    }

    const header = lines[0].toLowerCase().split(',').map((h) => h.trim());
    const records = this.parseFirestarrRecords(lines.slice(1), header, timezone);

    console.log(`[WeatherService] Parsed ${records.length} records from FireSTARR CSV`);

    return records.map((r) => ({
      datetime: r.datetime,
      temperature: r.temp,
      humidity: r.rh,
      windSpeed: r.ws,
      windDirection: r.wd,
      precipitation: r.prec,
      ffmc: r.ffmc,
      dmc: r.dmc,
      dc: r.dc,
      isi: r.isi,
      bui: r.bui,
      fwi: r.fwi,
    }));
  }

  /**
   * Parses FireSTARR CSV records
   */
  private parseFirestarrRecords(
    lines: string[],
    header: string[],
    timezone: string,
  ): FirestarrWeatherRecord[] {
    const getIndex = (name: string): number => {
      const idx = header.indexOf(name.toLowerCase());
      if (idx === -1) {
        throw new Error(`Required column "${name}" not found in CSV`);
      }
      return idx;
    };

    // Get column indices (handle optional Scenario column)
    const hasScenario = header.includes('scenario');
    const scenarioIdx = hasScenario ? getIndex('scenario') : -1;
    const dateIdx = getIndex('date');
    const precIdx = getIndex('prec');
    const tempIdx = getIndex('temp');
    const rhIdx = getIndex('rh');
    const wsIdx = getIndex('ws');
    const wdIdx = getIndex('wd');
    const ffmcIdx = getIndex('ffmc');
    const dmcIdx = getIndex('dmc');
    const dcIdx = getIndex('dc');
    const isiIdx = getIndex('isi');
    const buiIdx = getIndex('bui');
    const fwiIdx = getIndex('fwi');

    return lines.map((line, lineNum) => {
      const parts = line.split(',').map((p) => p.trim());
      try {
        return {
          scenario: hasScenario ? parseInt(parts[scenarioIdx], 10) : 0,
          datetime: parseTimestampInZone(parts[dateIdx], timezone),
          prec: parseFloat(parts[precIdx]),
          temp: parseFloat(parts[tempIdx]),
          rh: parseFloat(parts[rhIdx]),
          ws: parseFloat(parts[wsIdx]),
          wd: parseFloat(parts[wdIdx]),
          ffmc: parseFloat(parts[ffmcIdx]),
          dmc: parseFloat(parts[dmcIdx]),
          dc: parseFloat(parts[dcIdx]),
          isi: parseFloat(parts[isiIdx]),
          bui: parseFloat(parts[buiIdx]),
          fwi: parseFloat(parts[fwiIdx]),
        };
      } catch (e) {
        throw new Error(`Error parsing line ${lineNum + 2}: ${e}`);
      }
    });
  }

  /**
   * Processes raw weather CSV and calculates FWI using cffdrs library.
   *
   * @param content - Raw weather CSV content
   * @param startingCodes - Initial FFMC, DMC, DC values
   * @param latitude - Location latitude for DMC/DC calculation
   * @returns Array of weather data points with calculated FWI
   */
  private processRawWeather(
    content: string,
    startingCodes: FWIStartingCodes,
    latitude: number,
    timezone: string,
  ): WeatherDataPoint[] {
    const lines = content.trim().split('\n');
    if (lines.length < 2) {
      throw new Error('Raw weather CSV must have header and at least one data row');
    }

    const header = lines[0].toLowerCase().split(',').map((h) => h.trim());
    const rawRecords = this.parseRawWeatherRecords(lines.slice(1), header, timezone);

    console.log(`[WeatherService] Processing ${rawRecords.length} raw weather records with cffdrs`);

    // FFMC is an hourly code and steps forward every row.
    //
    // DMC and DC are DAILY codes. #234 stopped them recomputing every hour;
    // #352 puts the once-a-day update on the right day and the right row:
    // the LOCAL day (UTC midnight is 18:00 the previous local day in Edmonton,
    // which was splitting single days in two) and the observation nearest
    // local NOON, which is what CFFDRS defines them against. Driving them from
    // whichever row came first meant the evening observation — cooler and
    // damper than the afternoon peak — and biased both codes low for the whole
    // run.
    const dayKeys = rawRecords.map((r) => localDayKey(r.datetime, timezone));
    const drivers = pickDailyDriverIndices(
      rawRecords.map((r) => r.datetime),
      timezone,
    );

    // Walk the days in order, each starting from the previous day's codes.
    // Day keys are yyyy-MM-dd, so lexical order is chronological order even if
    // the file itself is not sorted.
    const dailyCodes = new Map<string, { dmc: number; dc: number }>();
    let prevDMC = startingCodes.dmc;
    let prevDC = startingCodes.dc;

    for (const day of [...drivers.keys()].sort()) {
      const driver = rawRecords[drivers.get(day) as number];
      const month = localMonth(driver.datetime, timezone);

      prevDMC = dmc(prevDMC, driver.temp, driver.rh, driver.prec, latitude, month);
      prevDC = dc(prevDC, driver.temp, driver.rh, driver.prec, latitude, month);
      dailyCodes.set(day, { dmc: prevDMC, dc: prevDC });
    }

    let prevFFMC = startingCodes.ffmc;

    return rawRecords.map((record, index) => {
      // FFMC updates every hour
      const newFFMC = ffmc(prevFFMC, record.temp, record.rh, record.ws, record.prec);

      // Every hour of a local day carries that day's daily codes.
      const daily = dailyCodes.get(dayKeys[index]) as { dmc: number; dc: number };
      const newDMC = daily.dmc;
      const newDC = daily.dc;

      // Calculate derived indices
      const newISI = isi(newFFMC, record.ws);
      const newBUI = bui(newDMC, newDC);
      const newFWI = fwi(newISI, newBUI);

      prevFFMC = newFFMC;

      return {
        datetime: record.datetime,
        temperature: record.temp,
        humidity: record.rh,
        windSpeed: record.ws,
        windDirection: record.wd,
        precipitation: record.prec,
        ffmc: Math.round(newFFMC * 10) / 10,
        dmc: Math.round(newDMC * 10) / 10,
        dc: Math.round(newDC * 10) / 10,
        isi: Math.round(newISI * 100) / 100,
        bui: Math.round(newBUI * 100) / 100,
        fwi: Math.round(newFWI * 100) / 100,
      };
    });
  }

  /**
   * Parses raw weather CSV records (without FWI columns)
   */
  private parseRawWeatherRecords(lines: string[], header: string[], timezone: string): RawWeatherRecord[] {
    const getIndex = (name: string): number => {
      const idx = header.indexOf(name.toLowerCase());
      if (idx === -1) {
        throw new Error(`Required column "${name}" not found in CSV`);
      }
      return idx;
    };

    // Get column indices
    const hasScenario = header.includes('scenario');
    const scenarioIdx = hasScenario ? getIndex('scenario') : -1;
    const dateIdx = getIndex('date');
    const hourIdx = header.indexOf('hour');
    const precIdx = getIndex('prec');
    const tempIdx = getIndex('temp');
    const rhIdx = getIndex('rh');
    const wsIdx = getIndex('ws');
    const wdIdx = getIndex('wd');

    return lines.map((line, lineNum) => {
      const parts = line.split(',').map((p) => p.trim());
      try {
        // Build datetime: combine Date + Hour columns if Hour exists and Date has no time
        let datetime: Date;
        const dateStr = parts[dateIdx];
        const dateHasTime = /\d{4}-\d{2}-\d{2}[\sT]\d{1,2}:\d{2}/.test(dateStr);

        if (dateHasTime) {
          datetime = parseTimestampInZone(dateStr, timezone);
        } else if (hourIdx !== -1) {
          const hour = parseInt(parts[hourIdx], 10);
          datetime = parseTimestampInZone(`${dateStr} ${String(hour).padStart(2, '0')}:00:00`, timezone);
        } else {
          // Bare date — anchor at local midnight in the sim's zone.
          datetime = parseTimestampInZone(`${dateStr} 00:00:00`, timezone);
        }

        return {
          scenario: hasScenario ? parseInt(parts[scenarioIdx], 10) : 0,
          datetime,
          prec: parseFloat(parts[precIdx]),
          temp: parseFloat(parts[tempIdx]),
          rh: parseFloat(parts[rhIdx]),
          ws: parseFloat(parts[wsIdx]),
          wd: parseFloat(parts[wdIdx]),
        };
      } catch (e) {
        throw new Error(`Error parsing line ${lineNum + 2}: ${e}`);
      }
    });
  }

  /**
   * Fetches weather data from SpotWX API.
   *
   * @param apiKey - SpotWX API key
   * @param location - Location coordinates
   * @param dateRange - Date range for forecast
   * @returns Array of hourly weather points
   */
  private async fetchFromSpotWX(
    apiKey: string,
    location: WeatherLocation,
    dateRange: WeatherDateRange,
    timezone: string,
  ): Promise<WeatherDataPoint[]> {
    console.log(`[WeatherService] SpotWX fetch requested for ${location.latitude}, ${location.longitude}`);
    console.log(`[WeatherService] Date range: ${dateRange.start.toISOString()} to ${dateRange.end.toISOString()}`);

    // SpotWX API endpoint
    const baseUrl = 'https://spotwx.io/api.php';

    // Use HRDPS for Canada (high resolution), fallback to RDPS
    const model = 'HRDPS';

    const url = new URL(baseUrl);
    url.searchParams.set('key', apiKey);
    url.searchParams.set('lat', location.latitude.toFixed(6));
    url.searchParams.set('lon', location.longitude.toFixed(6));
    url.searchParams.set('model', model);

    console.log(`[WeatherService] Fetching from SpotWX: ${url.toString().replace(apiKey, '***')}`);

    const response = await fetch(url.toString());

    if (!response.ok) {
      throw new Error(`SpotWX API error: ${response.status} ${response.statusText}`);
    }

    const csvContent = await response.text();

    // Check for API error responses
    if (csvContent.includes('Error') || csvContent.includes('Invalid')) {
      throw new Error(`SpotWX API error: ${csvContent.substring(0, 200)}`);
    }

    // Parse SpotWX CSV response
    const rawRecords = this.parseSpotWXCsv(csvContent, timezone);

    if (rawRecords.length === 0) {
      throw new Error('SpotWX returned no weather data');
    }

    // Filter to requested date range
    const filteredRecords = rawRecords.filter(
      r => r.datetime >= dateRange.start && r.datetime <= dateRange.end
    );

    if (filteredRecords.length === 0) {
      console.warn(`[WeatherService] No records in date range, using all ${rawRecords.length} records`);
      // Use all records if filter returned nothing (forecast may not cover exact range)
    }

    const recordsToProcess = filteredRecords.length > 0 ? filteredRecords : rawRecords;

    console.log(`[WeatherService] Processing ${recordsToProcess.length} SpotWX records with cffdrs`);

    // Calculate FWI using cffdrs (use default starting codes for forecast)
    // Default starting codes for spring/early fire season
    const defaultStartingCodes = { ffmc: 85.0, dmc: 6.0, dc: 15.0 };

    return this.calculateFWIFromRawRecords(recordsToProcess, defaultStartingCodes, location.latitude);
  }

  /**
   * Parses SpotWX CSV response into raw weather records.
   * SpotWX returns CSV with columns including: DateTime, TMP, RH, WIND, WDIR, APCP
   */
  private parseSpotWXCsv(content: string, timezone: string): RawWeatherRecord[] {
    const lines = content.trim().split('\n');
    if (lines.length < 2) {
      throw new Error('SpotWX CSV must have header and at least one data row');
    }

    const header = lines[0].toLowerCase().split(',').map(h => h.trim());

    // Find column indices (SpotWX uses different names)
    const findIndex = (names: string[]): number => {
      for (const name of names) {
        const idx = header.findIndex(h => h.includes(name.toLowerCase()));
        if (idx !== -1) return idx;
      }
      return -1;
    };

    // SpotWX column mappings (may vary by model)
    const dateIdx = findIndex(['datetime', 'date', 'time', 'valid']);
    const tempIdx = findIndex(['tmp', 'temp', 'temperature', 't2m']);
    const rhIdx = findIndex(['rh', 'humidity', 'relh']);
    const wsIdx = findIndex(['wind', 'ws', 'wspd', 'windspd']);
    const wdIdx = findIndex(['wdir', 'wd', 'winddir']);
    const precIdx = findIndex(['apcp', 'prec', 'precip', 'precipitation']);

    if (dateIdx === -1 || tempIdx === -1 || rhIdx === -1 || wsIdx === -1) {
      console.error('[WeatherService] SpotWX header columns:', header);
      throw new Error('SpotWX CSV missing required columns (DateTime, TMP, RH, WIND)');
    }

    const records: RawWeatherRecord[] = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const parts = line.split(',').map(p => p.trim());

      try {
        let datetime: Date;
        try {
          datetime = parseTimestampInZone(parts[dateIdx], timezone);
        } catch {
          continue;
        }

        records.push({
          scenario: 0,
          datetime,
          temp: parseFloat(parts[tempIdx]) || 0,
          rh: parseFloat(parts[rhIdx]) || 0,
          ws: parseFloat(parts[wsIdx]) || 0,
          wd: wdIdx !== -1 ? parseFloat(parts[wdIdx]) || 0 : 0,
          prec: precIdx !== -1 ? parseFloat(parts[precIdx]) || 0 : 0,
        });
      } catch (e) {
        console.warn(`[WeatherService] Skipping SpotWX line ${i}: ${e}`);
      }
    }

    return records;
  }

  /**
   * Calculates FWI indices from raw weather records using cffdrs.
   */
  private calculateFWIFromRawRecords(
    records: RawWeatherRecord[],
    startingCodes: FWIStartingCodes,
    latitude: number
  ): WeatherDataPoint[] {
    // Same daily-code logic as processRawWeather — DMC/DC update once per day only (#234)
    let prevFFMC = startingCodes.ffmc;
    let prevDMC = startingCodes.dmc;
    let prevDC = startingCodes.dc;
    let lastDMCUpdateDay = -1;

    return records.map(record => {
      const month = record.datetime.getUTCMonth() + 1;
      const dayOfYear = Math.floor(
        (record.datetime.getTime() - Date.UTC(record.datetime.getUTCFullYear(), 0, 0))
        / (1000 * 60 * 60 * 24)
      );

      // FFMC updates every hour
      const newFFMC = ffmc(prevFFMC, record.temp, record.rh, record.ws, record.prec);

      // DMC/DC update once per calendar day only
      let newDMC = prevDMC;
      let newDC = prevDC;
      if (dayOfYear !== lastDMCUpdateDay) {
        newDMC = dmc(prevDMC, record.temp, record.rh, record.prec, latitude, month);
        newDC = dc(prevDC, record.temp, record.rh, record.prec, latitude, month);
        lastDMCUpdateDay = dayOfYear;
        prevDMC = newDMC;
        prevDC = newDC;
      }

      const newISI = isi(newFFMC, record.ws);
      const newBUI = bui(newDMC, newDC);
      const newFWI = fwi(newISI, newBUI);

      prevFFMC = newFFMC;

      return {
        datetime: record.datetime,
        temperature: record.temp,
        humidity: record.rh,
        windSpeed: record.ws,
        windDirection: record.wd,
        precipitation: record.prec,
        ffmc: Math.round(newFFMC * 10) / 10,
        dmc: Math.round(newDMC * 10) / 10,
        dc: Math.round(newDC * 10) / 10,
        isi: Math.round(newISI * 100) / 100,
        bui: Math.round(newBUI * 100) / 100,
        fwi: Math.round(newFWI * 100) / 100,
      };
    });
  }

  /**
   * Converts weather data points to FireSTARR CSV format.
   *
   * @param points - Array of weather data points
   * @returns CSV string in FireSTARR format
   */
  toFirestarrCsv(points: WeatherDataPoint[]): string {
    const header = 'Scenario,Date,PREC,TEMP,RH,WS,WD,FFMC,DMC,DC,ISI,BUI,FWI';
    const lines = [header];

    for (const point of points) {
      const dateStr = this.formatDate(point.datetime);
      lines.push(
        `0,${dateStr},${point.precipitation.toFixed(1)},${point.temperature.toFixed(1)},` +
        `${point.humidity.toFixed(1)},${point.windSpeed.toFixed(1)},${point.windDirection.toFixed(1)},` +
        `${point.ffmc.toFixed(1)},${point.dmc.toFixed(1)},${point.dc.toFixed(1)},` +
        `${(point.isi ?? 0).toFixed(2)},${(point.bui ?? 0).toFixed(2)},${(point.fwi ?? 0).toFixed(2)}`
      );
    }

    return lines.join('\n');
  }

  /**
   * Format date for FireSTARR CSV
   */
  private formatDate(date: Date): string {
    const pad = (n: number): string => n.toString().padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
      `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }
}

/**
 * Singleton instance
 */
let instance: WeatherService | null = null;

export function getWeatherService(): WeatherService {
  if (!instance) {
    instance = new WeatherService();
  }
  return instance;
}

export function resetWeatherService(): void {
  instance = null;
}
