/**
 * MCP Knowledge Resource — Canadian FWI System Reference
 *
 * Provides AI agents with reference data on the Fire Weather Index system,
 * its components, calculation dependencies, and operational thresholds.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';

const FWI_COMPONENTS = [
  {
    code: 'FFMC',
    name: 'Fine Fuel Moisture Code',
    description: 'Moisture content of surface litter and other cured fine fuels in a forest stand.',
    scale: { min: 0, max: 101, higherMeans: 'drier' },
    inputs: ['temperature', 'relativeHumidity', 'windSpeed', 'precipitation', 'previousFFMC'],
    notes: 'Scale effectively stops at 101 (physically upper limit). Values above 90 indicate very dry conditions.',
  },
  {
    code: 'DMC',
    name: 'Duff Moisture Code',
    description: 'Moisture content of loosely compacted organic layers of moderate depth.',
    scale: { min: 0, max: null, higherMeans: 'drier' },
    inputs: ['temperature', 'relativeHumidity', 'precipitation', 'previousDMC', 'month'],
    notes: 'No upper limit. Values above 30 indicate moderate drying; above 60 indicate significant drought.',
  },
  {
    code: 'DC',
    name: 'Drought Code',
    description: 'Moisture content of deep compact organic layers. Tracks seasonal drought.',
    scale: { min: 0, max: null, higherMeans: 'drier' },
    inputs: ['temperature', 'precipitation', 'previousDC', 'month'],
    notes: 'No upper limit. Values above 200 indicate significant drought; above 400 indicate extreme drought.',
  },
  {
    code: 'ISI',
    name: 'Initial Spread Index',
    description: 'Expected rate of fire spread, combining the effect of wind and FFMC.',
    scale: { min: 0, max: null, higherMeans: 'faster spread' },
    inputs: ['FFMC', 'windSpeed'],
    notes: 'No upper limit. Combines FFMC and wind speed to estimate spread potential without fuel availability.',
  },
  {
    code: 'BUI',
    name: 'Buildup Index',
    description: 'Total amount of fuel available for combustion. Combines DMC and DC.',
    scale: { min: 0, max: null, higherMeans: 'more fuel available' },
    inputs: ['DMC', 'DC'],
    notes: 'No upper limit. Used as a threshold in some fuel types (D-2). Indicates overall fuel accumulation.',
  },
  {
    code: 'FWI',
    name: 'Fire Weather Index',
    description: 'Numerical rating of fire intensity. The primary index for general fire danger.',
    scale: { min: 0, max: null, higherMeans: 'higher intensity' },
    inputs: ['ISI', 'BUI'],
    notes: 'No upper limit. The main composite index combining spread potential and fuel availability.',
  },
];

const OPERATIONAL_THRESHOLDS = [
  { class: 'Low', fwiRange: '0–4', isiRange: '0–3', description: 'Low probability of spotting. Fires easy to suppress.' },
  { class: 'Moderate', fwiRange: '5–8', isiRange: '4–6', description: 'Moderate fire behavior. Readily controlled with initial attack.' },
  { class: 'High', fwiRange: '9–16', isiRange: '7–10', description: 'Active burning. May exceed initial attack. Spotting possible.' },
  { class: 'Very High', fwiRange: '17–29', isiRange: '11–15', description: 'Aggressive fire behavior. High probability of spotting. Difficult to control.' },
  { class: 'Extreme', fwiRange: '30+', isiRange: '16+', description: 'Extreme fire behavior. Fires likely to blow up or spot extensively. Potentially uncontrollable.' },
];

export function registerFwiSystemResource(server: McpServer): void {
  server.registerResource(
    'fwi-system',
    'nomad://knowledge/fwi-system',
    {
      title: 'Canadian FWI System Reference',
      description: 'Canadian Forest Fire Weather Index (FWI) System: components, calculation dependencies, and operational thresholds.',
      mimeType: 'application/json',
    },
    async (): Promise<ReadResourceResult> => ({
      contents: [{
        uri: 'nomad://knowledge/fwi-system',
        text: JSON.stringify({
          system: 'Canadian Forest Fire Weather Index (FWI) System',
          description: 'A system of six components that provides numerical ratings of relative potential for wildland fire.',
          components: FWI_COMPONENTS,
          calculationOrder: ['FFMC', 'DMC', 'DC', 'ISI', 'BUI', 'FWI'],
          operationalThresholds: OPERATIONAL_THRESHOLDS,
          notes: [
            'FFMC, DMC, and DC are moisture codes derived from daily weather observations.',
            'ISI, BUI, and FWI are derived indices calculated from the moisture codes.',
            'All codes carry over from day to day — startup values are required for the first day of a fire season.',
            'The system assumes midafternoon observations (13:00 LST) for input weather data.',
          ],
        }, null, 2),
        mimeType: 'application/json',
      }],
    })
  );
}
