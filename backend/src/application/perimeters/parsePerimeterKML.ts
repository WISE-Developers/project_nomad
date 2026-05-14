import { XMLParser, XMLValidator } from 'fast-xml-parser';
import type { Feature, LineString, Point, Polygon, Position } from 'geojson';
import { ValidationError } from '../../domain/errors/ValidationError.js';
import type { PerimeterFeatureCollection } from './parsePerimeterGeoJSON.js';

const xmlParser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,
  // Force these tags to always be arrays so we can iterate uniformly
  isArray: (name) => ['Placemark', 'Point', 'LineString', 'Polygon'].includes(name),
});

function parseCoords(coordStr: string): Position[] {
  return coordStr
    .trim()
    .split(/\s+/)
    .map((coord) => {
      const parts = coord.split(',').map(Number);
      return [parts[0], parts[1]] as Position;
    })
    .filter((c) => Number.isFinite(c[0]) && Number.isFinite(c[1]));
}

function collect<T>(node: unknown, tag: string, acc: T[], visit: (n: any) => T | undefined): void {
  if (node === null || typeof node !== 'object') return;
  const obj = node as Record<string, unknown>;
  if (Array.isArray(obj[tag])) {
    for (const child of obj[tag] as unknown[]) {
      const result = visit(child as any);
      if (result !== undefined) acc.push(result);
    }
  }
  for (const key of Object.keys(obj)) {
    if (key === tag) continue;
    const v = obj[key];
    if (Array.isArray(v)) {
      for (const item of v) collect(item, tag, acc, visit);
    } else if (typeof v === 'object' && v !== null) {
      collect(v, tag, acc, visit);
    }
  }
}

export function parsePerimeterKML(input: string): PerimeterFeatureCollection {
  const validation = XMLValidator.validate(input);
  if (validation !== true) {
    const e = validation.err;
    const where = e && typeof e.line === 'number' ? ` (line ${e.line}, col ${e.col})` : '';
    const reason = e?.msg ?? 'unknown XML error';
    throw ValidationError.forField('content', `must be valid XML — ${reason}${where}`);
  }
  const doc = xmlParser.parse(input);
  const features: Feature[] = [];

  let pointIdx = 0;
  collect<Feature | undefined>(doc, 'Point', features as never[], (point) => {
    const coordStr = String(point?.coordinates ?? '');
    const coords = parseCoords(coordStr);
    if (coords.length === 0) return undefined;
    const feature: Feature<Point> = {
      type: 'Feature',
      id: `kml-point-${pointIdx++}`,
      properties: { source: 'kml' },
      geometry: { type: 'Point', coordinates: coords[0] },
    };
    return feature;
  });

  let lineIdx = 0;
  collect<Feature | undefined>(doc, 'LineString', features as never[], (line) => {
    const coordStr = String(line?.coordinates ?? '');
    const coords = parseCoords(coordStr);
    if (coords.length < 2) return undefined;
    const feature: Feature<LineString> = {
      type: 'Feature',
      id: `kml-line-${lineIdx++}`,
      properties: { source: 'kml' },
      geometry: { type: 'LineString', coordinates: coords },
    };
    return feature;
  });

  let polyIdx = 0;
  collect<Feature | undefined>(doc, 'Polygon', features as never[], (poly) => {
    const outer = poly?.outerBoundaryIs;
    const ring = outer?.LinearRing;
    const coordStr = String(ring?.coordinates ?? '');
    const coords = parseCoords(coordStr);
    if (coords.length < 3) return undefined;
    const feature: Feature<Polygon> = {
      type: 'Feature',
      id: `kml-polygon-${polyIdx++}`,
      properties: { source: 'kml' },
      geometry: { type: 'Polygon', coordinates: [coords] },
    };
    return feature;
  });

  if (features.length === 0) {
    throw ValidationError.forField('content', 'no valid geometries found in KML');
  }
  return { type: 'FeatureCollection', features };
}
