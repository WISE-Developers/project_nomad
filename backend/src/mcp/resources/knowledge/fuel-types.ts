/**
 * MCP Knowledge Resource — FBP Fuel Type Catalog
 *
 * Provides AI agents with reference data on all Canadian FBP fuel types.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';

const FUEL_TYPE_CATALOG = [
  { code: 'C-1', name: 'Spruce–Lichen Woodland', group: 'Coniferous', description: 'Open, sparse canopy of black spruce over reindeer lichen ground cover. Low to moderate fire intensity.' },
  { code: 'C-2', name: 'Boreal Spruce', group: 'Coniferous', description: 'Dense black spruce with feather moss and sphagnum ground cover. High crown fire potential.' },
  { code: 'C-3', name: 'Mature Jack or Lodgepole Pine', group: 'Coniferous', description: 'Mature, fully stocked jack pine or lodgepole pine stands.' },
  { code: 'C-4', name: 'Immature Jack or Lodgepole Pine', group: 'Coniferous', description: 'Dense immature jack pine or lodgepole pine with dead branches to ground level.' },
  { code: 'C-5', name: 'Red and White Pine', group: 'Coniferous', description: 'Red pine and eastern white pine stands with little understory.' },
  { code: 'C-6', name: 'Conifer Plantation', group: 'Coniferous', description: 'Planted conifer stands, usually spruce or pine, with uniform spacing.' },
  { code: 'C-7', name: 'Ponderosa Pine / Douglas-Fir', group: 'Coniferous', description: 'Open stands of ponderosa pine or Douglas-fir with grass understory.' },
  { code: 'D-1', name: 'Leafless Aspen', group: 'Deciduous', description: 'Pure aspen stands before leaf-out in spring.' },
  { code: 'D-2', name: 'Green Aspen', group: 'Deciduous', description: 'Aspen with full green canopy. Uses BUI threshold.' },
  { code: 'M-1', name: 'Boreal Mixedwood — Leafless', group: 'Mixedwood', description: 'Boreal mixedwood before deciduous leaf-out. Requires percent conifer (PC) parameter.' },
  { code: 'M-2', name: 'Boreal Mixedwood — Green', group: 'Mixedwood', description: 'Boreal mixedwood with green deciduous canopy. Requires percent conifer (PC) parameter.' },
  { code: 'M-3', name: 'Dead Balsam Fir Mixedwood — Leafless', group: 'Mixedwood', description: 'Balsam fir killed by spruce budworm, before leaf-out. Requires percent dead fir (PDF) parameter.' },
  { code: 'M-4', name: 'Dead Balsam Fir Mixedwood — Green', group: 'Mixedwood', description: 'Balsam fir killed by spruce budworm, green canopy. Requires percent dead fir (PDF) parameter.' },
  { code: 'O-1a', name: 'Matted Grass', group: 'Open', description: 'Matted or dead grass from previous season.' },
  { code: 'O-1b', name: 'Standing Grass', group: 'Open', description: 'Standing dead grass or cured grass.' },
  { code: 'S-1', name: 'Jack or Lodgepole Pine Slash', group: 'Slash', description: 'Logging slash from jack pine or lodgepole pine harvest.' },
  { code: 'S-2', name: 'White Spruce / Balsam Slash', group: 'Slash', description: 'Logging slash from white spruce or balsam fir harvest.' },
  { code: 'S-3', name: 'Coastal Cedar / Hemlock / Douglas-Fir Slash', group: 'Slash', description: 'Logging slash from coastal species harvest.' },
  { code: 'NF', name: 'Non-fuel', group: 'Non-fuel', description: 'Areas that do not carry fire (rock, urban, agriculture).' },
  { code: 'WA', name: 'Water', group: 'Non-fuel', description: 'Water bodies.' },
];

export function registerFuelTypesResource(server: McpServer): void {
  server.registerResource(
    'fuel-types',
    'nomad://knowledge/fuel-types',
    {
      title: 'FBP Fuel Type Catalog',
      description: 'Complete catalog of Canadian Forest Fire Behavior Prediction (FBP) System fuel types with descriptions.',
      mimeType: 'application/json',
    },
    async (): Promise<ReadResourceResult> => ({
      contents: [{
        uri: 'nomad://knowledge/fuel-types',
        text: JSON.stringify({
          system: 'Canadian Forest Fire Behavior Prediction (FBP) System',
          fuelTypeCount: FUEL_TYPE_CATALOG.length,
          fuelTypes: FUEL_TYPE_CATALOG,
          notes: [
            'M-1/M-2 fuel types require a percent conifer (PC) parameter (0-100).',
            'M-3/M-4 fuel types require a percent dead fir (PDF) parameter (0-100).',
            'D-2 fuel type uses a BUI threshold to transition between no-spread and spread conditions.',
            'Fuel type at ignition location is determined from raster data, not set as a parameter.',
          ],
        }, null, 2),
        mimeType: 'application/json',
      }],
    })
  );
}
