import type { Feature, GeoJsonProperties, Point, LineString, Polygon } from 'geojson';

/**
 * Drawing mode types
 */
export type DrawingMode = 'point' | 'line' | 'polygon' | 'none';

/**
 * Draw event types
 */
export type DrawEventType = 'create' | 'update' | 'delete' | 'selectionchange';

/**
 * GeoJSON feature with specific geometry type
 */
export type PointFeature = Feature<Point, GeoJsonProperties>;
export type LineFeature = Feature<LineString, GeoJsonProperties>;
export type PolygonFeature = Feature<Polygon, GeoJsonProperties>;
export type DrawnFeature = PointFeature | LineFeature | PolygonFeature;

/**
 * Draw event payload
 */
export interface DrawEvent {
  type: DrawEventType;
  features: DrawnFeature[];
}

/**
 * Drawing state
 */
export interface DrawingState {
  /** Current drawing mode */
  mode: DrawingMode;
  /** Currently selected feature IDs */
  selectedIds: string[];
  /** All drawn features */
  features: DrawnFeature[];
}

/**
 * Drawing style options
 */
export interface DrawingStyles {
  /** Point radius in pixels */
  pointRadius?: number;
  /** Line width in pixels */
  lineWidth?: number;
  /** Stroke color */
  strokeColor?: string;
  /** Fill color */
  fillColor?: string;
  /** Fill opacity (0-1) */
  fillOpacity?: number;
}

/**
 * Default drawing styles (fire theme)
 */
export const DEFAULT_DRAWING_STYLES: Required<DrawingStyles> = {
  pointRadius: 8,
  lineWidth: 3,
  strokeColor: '#ff6b35',
  fillColor: '#ff6b35',
  fillOpacity: 0.2,
};
