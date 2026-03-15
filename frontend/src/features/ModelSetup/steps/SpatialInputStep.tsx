/**
 * SpatialInputStep Component
 *
 * First wizard step for selecting/drawing fire ignition geometry.
 *
 * Supports two modes:
 * - **SAN mode**: Uses internal DrawContext/MapContext for drawing on Nomad's map
 * - **Embedded mode**: Uses openNomad adapter's spatial methods for drawing on host's map
 */

import React, { useState, useCallback, useEffect } from 'react';
import { useWizardData } from '../../Wizard';
import { useDrawOptional } from '../../Map/context/DrawContext';
import { useMapOptional } from '../../Map/context/MapContext';
import { useOpenNomad } from '../../../openNomad';
import { CoordinateInput } from '../components/CoordinateInput';
import { GeometryUpload } from '../components/GeometryUpload';
import { useGeometrySync } from '../hooks/useGeometrySync';
import type { ModelSetupData, SpatialInputMethod } from '../types';
import type { DrawnFeature } from '../../Map/types/geometry';
import type { GeoJSONGeometry } from '../../../openNomad/api';

const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '16px',
  height: '100%',
};

const tabsStyle: React.CSSProperties = {
  display: 'flex',
  gap: '4px',
  borderBottom: '1px solid #ddd',
  paddingBottom: '8px',
  overflowX: 'auto',
  WebkitOverflowScrolling: 'touch',
  scrollbarWidth: 'none',
};

const tabStyle: React.CSSProperties = {
  padding: '8px 12px',
  border: 'none',
  backgroundColor: 'transparent',
  cursor: 'pointer',
  fontSize: '13px',
  color: '#666',
  borderRadius: '4px 4px 0 0',
  transition: 'background-color 0.2s',
  whiteSpace: 'nowrap',
  flexShrink: 0,
};

const activeTabStyle: React.CSSProperties = {
  ...tabStyle,
  backgroundColor: '#ff6b35',
  color: 'white',
};

const contentStyle: React.CSSProperties = {
  flex: 1,
  minHeight: '200px',
  position: 'relative',
};

const drawInstructionStyle: React.CSSProperties = {
  padding: '16px',
  backgroundColor: '#fff8f5',
  border: '1px solid #ffccbb',
  borderRadius: '4px',
  fontSize: '14px',
  color: '#333',
};

const featureListStyle: React.CSSProperties = {
  marginTop: '16px',
  padding: '12px',
  backgroundColor: '#f5f5f5',
  borderRadius: '4px',
};

const featureItemStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '8px',
  backgroundColor: 'white',
  borderRadius: '4px',
  marginBottom: '4px',
};

const deleteButtonStyle: React.CSSProperties = {
  padding: '4px 8px',
  fontSize: '12px',
  backgroundColor: '#e74c3c',
  color: 'white',
  border: 'none',
  borderRadius: '4px',
  cursor: 'pointer',
};

const drawButtonContainerStyle: React.CSSProperties = {
  padding: '16px',
  backgroundColor: '#f5f5f5',
  borderRadius: '4px',
  marginTop: '16px',
};

const drawButtonStyle: React.CSSProperties = {
  padding: '8px 16px',
  backgroundColor: '#ff6b35',
  color: 'white',
  border: 'none',
  borderRadius: '4px',
  cursor: 'pointer',
  fontSize: '14px',
};

const tabs: { id: SpatialInputMethod; label: string; icon: string }[] = [
  { id: 'draw', label: 'Draw on Map', icon: 'pen' },
  { id: 'coordinates', label: 'Enter Coordinates', icon: 'location-dot' },
  { id: 'upload', label: 'Upload File', icon: 'folder' },
];

/**
 * Format geometry type for display
 */
function formatGeometryType(type: string): string {
  switch (type) {
    case 'Point':
      return 'Point';
    case 'LineString':
      return 'Line';
    case 'Polygon':
      return 'Polygon';
    default:
      return type;
  }
}

/**
 * Spatial Input Step component
 */
export function SpatialInputStep() {
  const { data, setField } = useWizardData<ModelSetupData>();
  const api = useOpenNomad();

  // Optional internal hooks - will be null in embedded mode
  const drawContext = useDrawOptional();
  const mapContext = useMapOptional();

  // Determine if we're in embedded mode (no internal map/draw providers)
  const isEmbeddedMode = !drawContext || !mapContext;

  // For SAN mode, use internal hooks via useGeometrySync
  // For embedded mode, we'll manage geometry differently
  const geometrySync = useGeometrySync();

  // SAN mode: get values from internal context
  const addFeatures = drawContext?.addFeatures;
  const deleteAll = drawContext?.deleteAll;
  const map = mapContext?.map;
  const isLoaded = mapContext?.isLoaded ?? false;

  // Features and readiness depend on mode
  const features = isEmbeddedMode ? [] : geometrySync.features;
  const isReady = isEmbeddedMode ? true : geometrySync.isReady;

  // Embedded mode: track drawn geometry locally
  const [embeddedGeometry, setEmbeddedGeometry] = useState<GeoJSONGeometry | null>(null);

  // Determine available tabs based on mode
  const availableTabs = isEmbeddedMode
    ? tabs.filter((t) => t.id !== 'draw') // No "draw on map" in embedded mode (host handles that)
    : tabs;

  const defaultTab = isEmbeddedMode ? 'coordinates' : 'draw';
  const [activeTab, setActiveTab] = useState<SpatialInputMethod>(data.geometry?.inputMethod ?? defaultTab);

  // Update input method when tab changes
  const handleTabChange = useCallback(
    (method: SpatialInputMethod) => {
      setActiveTab(method);
      setField('geometry', {
        ...data.geometry,
        inputMethod: method,
      });
    },
    [setField, data.geometry]
  );

  // Handle draw button click (embedded mode - calls adapter)
  const handleDrawOnHostMap = useCallback(
    async (geometryType: 'point' | 'line' | 'polygon') => {
      try {
        let geometry: GeoJSON.Point | GeoJSON.LineString | GeoJSON.Polygon;
        switch (geometryType) {
          case 'point':
            geometry = await api.spatial.drawPoint();
            break;
          case 'line':
            geometry = await api.spatial.drawLine();
            break;
          case 'polygon':
            geometry = await api.spatial.drawPolygon();
            break;
        }
        setEmbeddedGeometry(geometry);
        setField('geometry', {
          ...data.geometry,
          features: [{ type: 'Feature', geometry, properties: {} } as DrawnFeature],
        });
      } catch (error) {
        // User cancelled or error occurred
        console.warn('Drawing cancelled or failed:', error);
      }
    },
    [api.spatial, setField, data.geometry]
  );

  // Handle coordinate input
  const handleCoordinateSubmit = useCallback(
    (feature: DrawnFeature) => {
      if (isEmbeddedMode) {
        // In embedded mode, store geometry in wizard data
        setEmbeddedGeometry(feature.geometry);
        setField('geometry', {
          ...data.geometry,
          features: [feature],
        });
      } else if (isReady && addFeatures) {
        // SAN mode: add to internal draw context
        addFeatures([feature]);
        // useGeometrySync will pick up the change via subscription
      }
    },
    [isEmbeddedMode, isReady, addFeatures, setField, data.geometry]
  );

  // Handle file upload
  const handleFileUpload = useCallback(
    (uploadedFeatures: DrawnFeature[]) => {
      if (isEmbeddedMode) {
        // In embedded mode, store first feature in wizard data
        if (uploadedFeatures.length > 0) {
          setEmbeddedGeometry(uploadedFeatures[0].geometry);
          setField('geometry', {
            ...data.geometry,
            features: uploadedFeatures,
          });
        }
      } else if (isReady && addFeatures && deleteAll) {
        // SAN mode: clear existing and add to internal draw context
        deleteAll();
        addFeatures(uploadedFeatures);
      }
    },
    [isEmbeddedMode, isReady, addFeatures, deleteAll, setField, data.geometry]
  );

  // Handle individual feature deletion (SAN mode only)
  const handleDeleteFeature = useCallback(
    (featureId: string | number | undefined) => {
      if (!featureId || !addFeatures || !deleteAll) return;
      const remaining = features.filter((f) => f.id !== featureId);
      deleteAll();
      if (remaining.length > 0) {
        addFeatures(remaining);
      }
    },
    [features, deleteAll, addFeatures]
  );

  // Handle clear in embedded mode
  const handleClearEmbedded = useCallback(() => {
    setEmbeddedGeometry(null);
    setField('geometry', {
      ...data.geometry,
      features: [],
    });
  }, [setField, data.geometry]);

  // Fly to features when they change (SAN mode only)
  useEffect(() => {
    if (isEmbeddedMode || !map || !isLoaded || !features.length) return;

    // Calculate bounds
    const allCoords: [number, number][] = [];
    for (const feature of features) {
      const geom = feature.geometry;
      if (geom.type === 'Point') {
        allCoords.push(geom.coordinates as [number, number]);
      } else if (geom.type === 'LineString') {
        allCoords.push(...(geom.coordinates as [number, number][]));
      } else if (geom.type === 'Polygon') {
        for (const ring of geom.coordinates) {
          allCoords.push(...(ring as [number, number][]));
        }
      }
    }

    if (allCoords.length === 0) return;

    if (allCoords.length === 1) {
      // Single point - center on it
      map.flyTo({ center: allCoords[0], zoom: 10 });
    } else {
      // Multiple coords - fit bounds
      const lngs = allCoords.map((c) => c[0]);
      const lats = allCoords.map((c) => c[1]);
      const bounds: [[number, number], [number, number]] = [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ];
      map.fitBounds(bounds, { padding: 50 });
    }
  }, [isEmbeddedMode, map, isLoaded, features]);

  // For display purposes, combine internal features with embedded geometry
  const displayFeatures: DrawnFeature[] = isEmbeddedMode
    ? embeddedGeometry
      ? [{ id: 'embedded', geometry: embeddedGeometry, properties: {} } as DrawnFeature]
      : []
    : features;

  return (
    <div style={containerStyle}>
      {/* Tab navigation */}
      <div style={tabsStyle}>
        {availableTabs.map((tab) => (
          <button
            key={tab.id}
            style={activeTab === tab.id ? activeTabStyle : tabStyle}
            onClick={() => handleTabChange(tab.id)}
          >
            <i className={`fa-solid fa-${tab.icon}`} style={{ marginRight: '6px' }} />{tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={contentStyle}>
        {activeTab === 'draw' && !isEmbeddedMode && (
          <div style={drawInstructionStyle}>
            <strong>Draw on the map:</strong>
            <ul style={{ margin: '8px 0 0 0', paddingLeft: '20px' }}>
              <li>Use the drawing tools on the left side of the map</li>
              <li>Draw a <strong>point</strong> for an ignition location</li>
              <li>Draw a <strong>line</strong> for a fire front</li>
              <li>Draw a <strong>polygon</strong> for a fire perimeter</li>
            </ul>
          </div>
        )}

        {activeTab === 'coordinates' && <CoordinateInput onSubmit={handleCoordinateSubmit} />}

        {activeTab === 'upload' && <GeometryUpload onUpload={handleFileUpload} />}
      </div>

      {/* Embedded mode: Draw buttons to trigger host map drawing */}
      {isEmbeddedMode && (
        <div style={drawButtonContainerStyle}>
          <div style={{ fontSize: '14px', color: '#333', marginBottom: '8px' }}>
            Or draw geometry on the map:
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              style={drawButtonStyle}
              onClick={() => handleDrawOnHostMap('point')}
            >
              <i className="fa-solid fa-location-dot" style={{ marginRight: '4px' }} />
              Point
            </button>
            <button
              style={drawButtonStyle}
              onClick={() => handleDrawOnHostMap('line')}
            >
              <i className="fa-solid fa-minus" style={{ marginRight: '4px' }} />
              Line
            </button>
            <button
              style={drawButtonStyle}
              onClick={() => handleDrawOnHostMap('polygon')}
            >
              <i className="fa-solid fa-draw-polygon" style={{ marginRight: '4px' }} />
              Polygon
            </button>
          </div>
        </div>
      )}

      {/* Feature list */}
      {displayFeatures.length > 0 && (
        <div style={featureListStyle}>
          <div style={{ fontSize: '12px', color: '#666', marginBottom: '8px' }}>
            {displayFeatures.length} feature{displayFeatures.length !== 1 ? 's' : ''} selected:
          </div>
          {displayFeatures.map((feature, index) => (
            <div key={feature.id ?? index} style={featureItemStyle}>
              <span style={{ color: '#333' }}>
                {formatGeometryType(feature.geometry.type)}
                {feature.properties?.fileName && ` (from ${feature.properties.fileName})`}
              </span>
              {!isEmbeddedMode && (
                <button
                  style={deleteButtonStyle}
                  onClick={() => handleDeleteFeature(feature.id)}
                >
                  Remove
                </button>
              )}
            </div>
          ))}
          <button
            style={{ ...deleteButtonStyle, marginTop: '8px', width: '100%' }}
            onClick={isEmbeddedMode ? handleClearEmbedded : geometrySync.clearGeometry}
          >
            Clear All
          </button>
        </div>
      )}
    </div>
  );
}
