/**
 * Hand imported weather to Nomad, which already computes the fire weather
 * (refs #294).
 *
 * Every .fgmj carries STARTING CFFDRS codes — ffmc 87, dmc 179, dc 547 in the
 * sample. That is all the importer needs to pass along. Nomad already steps
 * them forward with the real `cffdrs` library, through
 * WeatherService.resolveWeather with source 'raw_weather'.
 *
 * So this emits observations plus those codes and stops there. It computes no
 * fire weather of its own. A third copy of the FWI stepping loop living in the
 * importer would duplicate science already implemented and tested in
 * WeatherService, and tools/extract-wise-jobs.ts shows where that goes: it
 * holds the codes CONSTANT for every hour, under the comment "proper FWI hourly
 * calculation is complex".
 */

import type { WeatherConfig } from '../interfaces/weather.js';
import {
  formatLocalDate,
  formatLocalTime,
} from '../../infrastructure/firestarr/timezoneUtils.js';
import type { ScenarioImportPlan } from './planFgmjImport.js';

/** What the raw-weather parser looks for. Deliberately no FWI columns. */
const HEADER = 'Date,PREC,TEMP,RH,WS,WD';

/**
 * Four decimals, trailing zeros trimmed.
 *
 * The file's values carry float32 noise from the original — 12.100000381469727
 * for what the author entered as 12.1 — and no weather observation is
 * meaningful past four places. Writing the noise through would not be more
 * faithful, only less readable.
 */
function formatValue(value: number): string {
  return String(Number(value.toFixed(4)));
}

/**
 * Build the weather handoff for a plan.
 *
 * @throws if the plan has no latitude. CFFDRS needs it for the day-length
 *         adjustment in DMC and DC — Nomad's own requirement, not this
 *         importer's — so a projected file must have its CRS resolved first.
 */
export function toWeatherConfig(plan: ScenarioImportPlan): WeatherConfig {
  if (plan.latitude === undefined) {
    throw new Error(
      `Scenario "${plan.scenarioName}" has no latitude yet, so its fire weather cannot ` +
        'be computed: CFFDRS needs latitude for the day-length adjustment in DMC and ' +
        'DC. Resolve the CRS first — the coordinates in this .fgmj are projected.',
    );
  }

  if (plan.weather.length === 0) {
    throw new Error(
      `Scenario "${plan.scenarioName}" has no weather rows to hand over.`,
    );
  }

  // Local times with NO offset, which is what the raw parser expects — the
  // offset travels in `timezone` instead. Formatted with the engine's own
  // helpers so the importer cannot drift from how the rest of the system
  // renders local time.
  const rows = plan.weather.map((row) => {
    const date = formatLocalDate(row.date, plan.timezone);
    const time = formatLocalTime(row.date, plan.timezone);
    return [
      `${date} ${time}`,
      formatValue(row.precip),
      formatValue(row.temp),
      formatValue(row.rh),
      formatValue(row.ws),
      formatValue(row.wd),
    ].join(',');
  });

  return {
    source: 'raw_weather',
    rawWeatherContent: [HEADER, ...rows].join('\n'),
    startingCodes: {
      ffmc: plan.startingCodes.ffmc,
      dmc: plan.startingCodes.dmc,
      dc: plan.startingCodes.dc,
    },
    latitude: plan.latitude,
    timezone: plan.timezone,
  };
}
