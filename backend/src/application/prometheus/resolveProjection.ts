/**
 * Answer the projection question with a CRS the operator supplied (refs #294).
 *
 * extractIgnitions detects that coordinates are projected and refuses to guess.
 * This is the other half: given a CRS, reproject to WGS84 and clear that
 * blocker. Nothing here invents a CRS — it only uses one it was handed.
 *
 * THE AXIS-ORDER TRAP, which deserves more care than the reprojection.
 *
 * GDAL 3 honours the authority axis order, and EPSG:4326 declares latitude
 * first. gdal-async is not self-consistent about this:
 *
 *   fromEPSG(4326) + transformPoint   ->  x=60.2698   y=-116.7706  (lat, lon)
 *   proj4 longlat  + transformPoint   ->  x=-116.7706 y=60.2698    (lon, lat)
 *   geom.transform() + toObject()     ->  lon, lat  (GeoJSON order)
 *
 * This module uses transformPoint, the one that inherits the authority order,
 * so the target is built from an explicit `+proj=longlat` definition rather
 * than from the EPSG code. Read the wrong way round, a reprojection yields a
 * plausible pair of numbers that puts the fire in the wrong hemisphere.
 */

import type { ScenarioImportPlan } from './planFgmjImport.js';

/**
 * Target for every reprojection. Explicit longlat rather than EPSG:4326, so
 * the axis order is stated here instead of inherited from the authority.
 */
const WGS84_LONLAT = '+proj=longlat +datum=WGS84 +no_defs';

interface SpatialRefLike {
  toWKT(): string;
}

interface GdalLike {
  SpatialReference: {
    fromEPSG(epsg: number): SpatialRefLike;
    fromProj4(proj4: string): SpatialRefLike;
    fromWKT(wkt: string): SpatialRefLike;
  };
  CoordinateTransformation: new (
    from: SpatialRefLike,
    to: SpatialRefLike,
  ) => { transformPoint(x: number, y: number): { x: number; y: number } };
}

/**
 * Build a spatial reference from whatever the operator typed.
 *
 * Accepts a proj4 string, an EPSG code with or without the prefix, or WKT.
 * Anything it cannot build is an error naming the input — a CRS we cannot
 * construct must not quietly become "no reprojection".
 */
function buildSourceSrs(gdal: GdalLike, crs: string): SpatialRefLike {
  const trimmed = crs.trim();
  if (trimmed.length === 0) {
    throw new Error(
      'No coordinate reference system supplied. The .fgmj does not record one, ' +
        'so it has to come from the operator.',
    );
  }

  try {
    if (trimmed.startsWith('+')) {
      return gdal.SpatialReference.fromProj4(trimmed);
    }

    const epsg = /^(?:EPSG:)?(\d+)$/i.exec(trimmed);
    if (epsg) {
      return gdal.SpatialReference.fromEPSG(Number(epsg[1]));
    }

    return gdal.SpatialReference.fromWKT(trimmed);
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new Error(
      `Could not build a coordinate reference system from "${trimmed}" — ${reason}. ` +
        'Give an EPSG code (e.g. EPSG:3978), a proj4 string, or WKT.',
    );
  }
}

export async function resolveProjection(
  plan: ScenarioImportPlan,
  crs: string,
): Promise<ScenarioImportPlan> {
  // Validate the CRS even when there is nothing to reproject, so a typo is
  // reported rather than silently accepted on a plan that did not need it.
  const gdalModule = await import('gdal-async');
  const gdal = gdalModule.default as unknown as GdalLike;
  const source = buildSourceSrs(gdal, crs);

  if (!plan.ignitions.some((ignition) => ignition.requiresCrs)) {
    return plan;
  }

  const transform = new gdal.CoordinateTransformation(
    source,
    gdal.SpatialReference.fromProj4(WGS84_LONLAT),
  );

  const ignitions = plan.ignitions.map((ignition) => {
    if (!ignition.requiresCrs) return ignition;

    const latLonPoints = ignition.points.map((point) => {
      const projected = transform.transformPoint(point.x, point.y);
      // x is longitude and y is latitude, because the target above says so.
      return { lon: projected.x, lat: projected.y };
    });

    return {
      ...ignition,
      coordinateSystem: 'latLon' as const,
      requiresCrs: false,
      // Recorded so the answer is traceable to what the operator gave, rather
      // than appearing as though the file had carried it all along.
      crs,
      latLonPoints,
    };
  });

  // blockers and blockerDetail are pushed in lockstep, one detail per blocker,
  // so the same index addresses both.
  const crsIndex = plan.blockers.indexOf('crs');
  const blockers = plan.blockers.filter((_, i) => i !== crsIndex);
  const blockerDetail = plan.blockerDetail.filter((_, i) => i !== crsIndex);

  const first = ignitions[0]?.latLonPoints?.[0];

  return {
    ...plan,
    ignitions,
    ...(first ? { latitude: first.lat, longitude: first.lon } : {}),
    blockers,
    blockerDetail,
    runnable: blockers.length === 0,
  };
}
