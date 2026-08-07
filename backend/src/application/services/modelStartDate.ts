/**
 * Reads the date a model was simulated FOR — not when it executed (refs #319).
 *
 * The results view shows which fuel vintage produced a result, and fuel is
 * selected by the modelled year. Using execution time would report a 2023
 * reconstruction as 2026 fuel: the same defect as validating fuel coverage
 * against new Date().getFullYear().
 *
 * Sources, in order of authority:
 *   1. timeRange.start — output-config.json (local runs) or model.json (imports)
 *   2. the first datetime in weather.csv — what FireSTARR actually starts from
 *   3. undefined — deliberately NOT today. An unknown year stays unknown; a
 *      confident wrong year is worse than an absent one.
 */

import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { parseIsoToDate } from '../../shared/dateParsing.js';

const CONFIG_FILES = ['output-config.json', 'model.json'];

/**
 * Parses a stored datetime; undefined when it isn't a real date.
 * Uses the shared strict parser rather than bare `new Date(...)` — a loosely
 * parsed date here would silently mislabel which fuel vintage a result used.
 */
function parseDate(value: unknown, context: string): Date | undefined {
  if (typeof value !== 'string' || value.trim() === '') {
    return undefined;
  }
  try {
    return parseIsoToDate(value, context);
  } catch {
    return undefined;
  }
}

async function fromConfig(simDir: string): Promise<Date | undefined> {
  for (const fileName of CONFIG_FILES) {
    const filePath = join(simDir, fileName);
    if (!existsSync(filePath)) {
      continue;
    }
    try {
      const raw = JSON.parse(await readFile(filePath, 'utf8')) as {
        timeRange?: { start?: string };
      };
      const parsed = parseDate(raw.timeRange?.start, `modelStartDate ${fileName} timeRange.start`);
      if (parsed) {
        return parsed;
      }
    } catch {
      // Malformed config is not fatal — fall through to the next source.
      continue;
    }
  }
  return undefined;
}

async function fromWeather(simDir: string): Promise<Date | undefined> {
  const weatherPath = join(simDir, 'weather.csv');
  if (!existsSync(weatherPath)) {
    return undefined;
  }
  try {
    const contents = await readFile(weatherPath, 'utf8');
    const [, firstRow] = contents.split('\n', 2);
    return parseDate(firstRow?.split(',')[0]?.trim(), 'modelStartDate weather.csv first datetime');
  } catch {
    return undefined;
  }
}

/**
 * The model's simulation start date, or undefined when nothing records it.
 */
export async function readModelStartDate(simDir: string): Promise<Date | undefined> {
  return (await fromConfig(simDir)) ?? (await fromWeather(simDir));
}
