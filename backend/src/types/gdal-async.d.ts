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
  export class Point {
    constructor(x: number, y: number);
    x: number;
    y: number;
    transform(transformation: CoordinateTransformation): void;
  }

  // Geometry
  export class Geometry {
    static fromWKT(wkt: string): Geometry;
    transform(transformation: CoordinateTransformation): void;
  }

  // Feature
  export class Feature {
    constructor(layer: Layer);
    setGeometry(geometry: Geometry): void;
  }

  // Layer
  export interface Layer {
    name: string;
    features: {
      add(feature: Feature): void;
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
    wkbPolygon: number;

    // Collections
    drivers: Drivers;

    // Classes
    SpatialReference: typeof SpatialReference;
    CoordinateTransformation: typeof CoordinateTransformation;
    Point: typeof Point;
    Geometry: typeof Geometry;
    Feature: typeof Feature;

    // Functions
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
  export const wkbPolygon: number;
  export const drivers: Drivers;
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
