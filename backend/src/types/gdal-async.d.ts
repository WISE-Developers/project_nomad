/**
 * Type declarations for gdal-async
 *
 * This is a minimal type declaration for the parts of gdal-async we use.
 * gdal-async is an optional dependency for perimeter rasterization.
 *
 * When using ESM dynamic import, access via: gdalModule.default
 */

declare module 'gdal-async' {
  // SpatialReference
  export class SpatialReference {
    static fromWKT(wkt: string): SpatialReference;
    static fromEPSG(epsg: number): SpatialReference;
    static fromProj4(proj4: string): SpatialReference;
    toWKT(): string;
  }

  // CoordinateTransformation
  export class CoordinateTransformation {
    constructor(source: SpatialReference, target: SpatialReference);
    transformPoint(x: number, y: number): { x: number; y: number };
  }

  // Point Geometry
  export class Point extends Geometry {
    constructor(x: number, y: number);
    x: number;
    y: number;
  }

  // Geometry
  export class Geometry {
    static fromWKT(wkt: string): Geometry;
    transform(transformation: CoordinateTransformation): void;
    /** GeoJSON-style plain-object representation of the geometry */
    toObject(): unknown;
    /** wkbXxx constant identifying the concrete geometry type */
    wkbType: number;
  }

  // LinearRing (subset of LineString used to build Polygon rings)
  export class LinearRing extends Geometry {
    constructor();
    points: {
      add(x: number, y: number, z?: number): void;
    };
  }

  // Polygon (extends Geometry; built from one or more LinearRings)
  export class Polygon extends Geometry {
    constructor();
    rings: {
      add(ring: LinearRing): void;
    };
  }

  // Feature
  export class Feature {
    constructor(layer: Layer);
    setGeometry(geometry: Geometry): void;
    getGeometry(): Geometry | null;
  }

  // Layer
  export interface Layer {
    name: string;
    srs: SpatialReference | null;
    geomType: number;
    features: {
      add(feature: Feature): void;
      count(): number;
      forEach(callback: (feature: Feature) => void): void;
    };
  }

  // Band
  export interface Band {
    noDataValue: number | null;
    fill(value: number): void;
    pixels: {
      read(x: number, y: number, width: number, height: number): Uint8Array | Int16Array | Float32Array;
      write(x: number, y: number, width: number, height: number, data: Uint8Array | Int16Array | Float32Array): void;
    };
  }

  // Bands collection
  export interface Bands {
    get(index: number): Band;
    count(): number;
  }

  // Layers collection
  export interface Layers {
    create(name: string, srs: SpatialReference | null, geometryType: number): Layer;
    count(): number;
    get(index: number): Layer;
  }

  // Dataset
  export interface Dataset {
    geoTransform: number[] | null;
    srs: SpatialReference | null;
    rasterSize: { x: number; y: number };
    bands: Bands;
    layers: Layers;
    flush(): void;
    close(): void;
  }

  // Driver
  export interface Driver {
    create(path: string, width?: number, height?: number, bands?: number, dataType?: number): Dataset;
  }

  // Drivers collection
  export interface Drivers {
    get(name: string): Driver;
    getNames(): string[];
  }

  // GDAL API interface
  interface GDALApi {
    // Constants
    GDT_Byte: number;
    GDT_Int16: number;
    GDT_UInt16: number;
    GDT_Int32: number;
    GDT_Float32: number;
    GDT_Float64: number;
    GDT_Unknown: number;
    wkbPoint: number;
    wkbPolygon: number;
    wkbMultiPolygon: number;

    // Collections
    drivers: Drivers;

    // Classes
    SpatialReference: typeof SpatialReference;
    CoordinateTransformation: typeof CoordinateTransformation;
    Point: typeof Point;
    Geometry: typeof Geometry;
    LinearRing: typeof LinearRing;
    Polygon: typeof Polygon;
    Feature: typeof Feature;

    // Functions
    open(path: string): Dataset;
    openAsync(path: string): Promise<Dataset>;
    rasterizeAsync(
      dataset: Dataset,
      sourceDataset: Dataset,
      layerNames: string[],
      options?: {
        bands?: number[];
        burnValues?: number[];
      }
    ): Promise<void>;
    // CLI-style overload (gdal_rasterize command-line args)
    rasterizeAsync(
      outputPath: string,
      sourceDataset: Dataset,
      args: string[]
    ): Promise<void>;
  }

  // ESM default export
  const _default: GDALApi;
  export default _default;

  // Also export directly for CommonJS compatibility
  export const GDT_Byte: number;
  export const GDT_Int16: number;
  export const GDT_UInt16: number;
  export const GDT_Int32: number;
  export const GDT_Float32: number;
  export const GDT_Float64: number;
  export const GDT_Unknown: number;
  export const wkbPoint: number;
  export const wkbPolygon: number;
  export const wkbMultiPolygon: number;
  export const drivers: Drivers;
  export function open(path: string): Dataset;
  export function openAsync(path: string): Promise<Dataset>;
  export function rasterizeAsync(
    dataset: Dataset,
    sourceDataset: Dataset,
    layerNames: string[],
    options?: {
      bands?: number[];
      burnValues?: number[];
    }
  ): Promise<void>;
  // CLI-style overload (gdal_rasterize command-line args)
  export function rasterizeAsync(
    outputPath: string,
    sourceDataset: Dataset,
    args: string[]
  ): Promise<void>;
}
