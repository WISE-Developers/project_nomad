/**
 * Prefill the Model Setup wizard from an imported .fgmj scenario (refs #294).
 *
 * The importer deliberately produces a PLAN, not a model. It carries blockers
 * only a person can settle — the CRS a projected file does not record, the
 * polygon weather patch that must be applied globally or ignored — and
 * divergences the operator must SEE: a fuel patch that could not be applied, a
 * WindNinja field that was skipped, a POLYGON_IN that grows inward, a point
 * turned into a circle.
 *
 * Running straight from an import would discard all of that silently. The
 * wizard is where an operator supplies missing input and reviews what they are
 * about to run, so this maps a plan onto the wizard's own shape and leaves the
 * operator in charge.
 *
 * It maps; it does not decide. Anything the wizard cannot faithfully represent
 * is reported in `unsupported` rather than approximated.
 */

import type { Point, LineString, Polygon } from 'geojson';
import type { DrawingMode, DrawnFeature } from '../../Map/types/geometry';
import type { BoundingBox, ModelSetupData, ParsedWeatherCSV } from '../types';
import { buildParsedWeatherCSV, parseCSV } from '../utils/weatherValidation';

/** One scenario of an imported .fgmj, as the import endpoint returns it. */
export interface ImportedScenarioPlan {
  scenarioName: string;
  /** ISO 8601 carrying the offset the file itself declared. */
  startTime: string;
  endTime: string;
  durationHours: number;
  /** The file's own UTC offset, e.g. "-06:00". Not a guessed IANA zone. */
  timezone: string;
  latitude?: number;
  longitude?: number;
  startingCodes: { ffmc: number; dmc: number; dc: number; precipitation?: number };
  ignitions: Array<{
    name: string;
    geometry: { type: string; coordinates: unknown };
    divergence?: string;
  }>;
  /** Observations with no fire-weather index columns. */
  rawWeatherContent?: string;
  weatherRowCount: number;
  appliedPatches: string[];
  skippedFuelPatches: string[];
  skippedWindPatches: string[];
  polygonPatches: string[];
  blockers: string[];
  blockerDetail: string[];
  warnings: string[];
  divergences: string[];
  runnable: boolean;
}

export interface ImportPrefill {
  /** Merged over DEFAULT_MODEL_SETUP_DATA by useModelSetup. */
  initialData: Partial<ModelSetupData>;
  /** Everything the operator must be told before running. */
  notices: string[];
  /**
   * Reasons the wizard cannot faithfully represent this scenario. Empty means
   * it can. Never silently worked around.
   */
  unsupported: string[];
}

/** GeoJSON geometry type -> the wizard's drawing mode. */
const DRAWING_MODES: Record<string, DrawingMode> = {
  Point: 'point',
  LineString: 'line',
  Polygon: 'polygon',
};

/**
 * The wall clock the file wrote, taken from the string rather than through
 * Date.
 *
 * The ISO string already carries its own offset, so slicing gives the local
 * time the author meant. Parsing it and reading it back in the browser's zone
 * is the #402 class of bug: an evening start west of UTC rolls to the next day.
 */
function localWallClock(iso: string): { date: string; time: string } {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(iso);
  if (!match) {
    throw new Error(
      `Imported scenario has an unreadable start time "${iso}". Refusing to ` +
        'guess when the fire started.',
    );
  }
  const [, date, hh, mm] = match;
  return { date, time: `${hh}:${mm}` };
}

function boundsOf(features: DrawnFeature[]): BoundingBox | undefined {
  const positions: number[][] = [];
  for (const feature of features) {
    const { type, coordinates } = feature.geometry;
    if (type === 'Point') positions.push(coordinates as number[]);
    else if (type === 'LineString') positions.push(...(coordinates as number[][]));
    else if (type === 'Polygon') {
      for (const ring of coordinates as number[][][]) positions.push(...ring);
    }
  }
  if (positions.length === 0) return undefined;
  const lons = positions.map((p) => p[0]);
  const lats = positions.map((p) => p[1]);
  return [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];
}

/**
 * One ignition as a feature the map and the spatial step can carry.
 *
 * Built per geometry type rather than cast: DrawnFeature is a UNION of
 * Feature<Point> | Feature<LineString> | Feature<Polygon>, not a Feature of a
 * union, so a single cast would compile only by lying about the narrowing.
 *
 * `properties.mode` is required by TerraDraw, which ignores a feature without
 * it — so an imported ignition would simply not appear on the map.
 */
function toDrawnFeature(
  name: string,
  geometry: { type: string; coordinates: unknown },
): DrawnFeature | undefined {
  const properties = { name, mode: DRAWING_MODES[geometry.type] };
  switch (geometry.type) {
    case 'Point':
      return {
        type: 'Feature',
        properties,
        geometry: { type: 'Point', coordinates: geometry.coordinates as Point['coordinates'] },
      };
    case 'LineString':
      return {
        type: 'Feature',
        properties,
        geometry: {
          type: 'LineString',
          coordinates: geometry.coordinates as LineString['coordinates'],
        },
      };
    case 'Polygon':
      return {
        type: 'Feature',
        properties,
        geometry: {
          type: 'Polygon',
          coordinates: geometry.coordinates as Polygon['coordinates'],
        },
      };
    default:
      // Reported in `unsupported` by the caller; nothing is invented here.
      return undefined;
  }
}

export function prefillFromImportPlan(plan: ImportedScenarioPlan): ImportPrefill {
  const unsupported: string[] = [];

  // Divergences first: they describe how the imported run differs from the one
  // the .fgmj recorded, which is the comparison the import exists for.
  const notices = [...plan.divergences, ...plan.warnings];
  for (const ignition of plan.ignitions) {
    if (ignition.divergence) notices.push(ignition.divergence);
  }

  if (!plan.runnable) {
    unsupported.push(
      `Scenario "${plan.scenarioName}" cannot be imported as it stands — ` +
        `${plan.blockers.join(', ')}. ${plan.blockerDetail.join(' ')}`.trim(),
    );
  }

  // Every ignition is prefilled, not just the first.
  //
  // This used to refuse any plan with more than one, because the submit path
  // read `features[0]` and the run request could not carry a MultiPolygon.
  // Both were fixed in the #294 merge: App.tsx sends EVERY drawn feature, and
  // the backend merges N ignitions through mergeIgnitions. Hand-drawn
  // multi-ignition already runs end to end, which is the proof the wizard
  // carries several features perfectly well.
  //
  // They are deliberately NOT merged here. Merging is the backend's job, and
  // collapsing them client-side would take away the operator's chance to see,
  // on the map, what the file actually declared before anything combined them.
  const features: DrawnFeature[] = plan.ignitions.flatMap((ignition) => {
    const feature = toDrawnFeature(ignition.name, ignition.geometry);
    return feature ? [feature] : [];
  });

  // Checked across EVERY ignition, not just the first.
  //
  // While multi-ignition plans were refused outright, inspecting `ignitions[0]`
  // was sufficient — nothing got past the refusal. Supporting several opens the
  // hole: an undrawable SECOND ignition would otherwise reach the map
  // unexamined, which is the silent drop this guard exists to prevent.
  for (const ignition of plan.ignitions) {
    if (!DRAWING_MODES[ignition.geometry.type]) {
      unsupported.push(
        `Ignition "${ignition.name}" is a ${ignition.geometry.type}, which the setup form ` +
          'cannot draw or carry.',
      );
    }
  }

  // The drawing mode follows the first DRAWABLE ignition. A mixed plan is
  // already reported above, so this only decides which tool the map opens with.
  const firstDrawable = plan.ignitions.find((i) => DRAWING_MODES[i.geometry.type]);
  const mode: DrawingMode = firstDrawable
    ? (DRAWING_MODES[firstDrawable.geometry.type] ?? 'none')
    : 'none';

  const { date, time } = localWallClock(plan.startTime);

  const initialData: Partial<ModelSetupData> = {
    geometry: {
      type: mode,
      features,
      bounds: boundsOf(features),
      // It came from a file, not from drawing or typed coordinates.
      inputMethod: 'upload',
    },
    temporal: {
      startDate: date,
      startTime: time,
      durationHours: plan.durationHours,
      // The offset the file declared. Accepted by Intl, unlike "UTC-6".
      timezone: plan.timezone,
      // Recorded in the file — neither a device guess nor this operator's
      // choice. Marking it 'inferred' made the wizard say it "was detected
      // from this device", which is false, and made the operator confirm
      // recorded data.
      timezoneSource: 'imported',
      isForecast: false,
    },
    weather: {
      // Observations plus starting codes, so the backend steps the codes
      // forward with cffdrs. NEVER firestarr_csv: that carries index columns,
      // and a zero in a CFFDRS column tells FireSTARR not to burn that hour.
      source: 'raw_weather',
      startingCodes: {
        ffmc: plan.startingCodes.ffmc,
        dmc: plan.startingCodes.dmc,
        dc: plan.startingCodes.dc,
      },
      ...weatherFileOf(plan),
    },
  };

  return { initialData, notices, unsupported };
}

/**
 * The weather step reads an uploaded file, so the imported observations are
 * presented as one — named after the scenario, parsed the same way, so the
 * step shows the record count and the operator can see it is already there.
 */
function weatherFileOf(plan: ImportedScenarioPlan): {
  rawWeatherFile?: File;
  rawWeatherFileName?: string;
  rawWeatherParsed?: ParsedWeatherCSV;
} {
  if (!plan.rawWeatherContent) return {};
  const name = `${plan.scenarioName.replace(/[^\w.-]+/g, '_')}-weather.csv`;
  const { headers, rows } = parseCSV(plan.rawWeatherContent);
  return {
    rawWeatherFileName: name,
    rawWeatherFile: new File([plan.rawWeatherContent], name, { type: 'text/csv' }),
    // RawWeatherUpload decides a file is attached with
    // `!!fileName && !!parsed` — it needs BOTH, so without this the step shows
    // an empty dropzone for weather that is already there.
    //
    // Parsed with the same shared helpers the real upload path uses, so an
    // imported file is summarised identically to an uploaded one.
    rawWeatherParsed: buildParsedWeatherCSV(headers, rows),
  };
}
