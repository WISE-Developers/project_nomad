/**
 * SpatialInputStep Component
 *
 * First wizard step for selecting/drawing fire ignition geometry.
 */

import React, { useState, useCallback, useEffect } from 'react';
import { useWizardData } from '../../Wizard';
import { useDraw } from '../../Map/context/DrawContext';
import { useMap } from '../../Map/context/MapContext';
import { CoordinateInput } from '../components/CoordinateInput';
import { GeometryUpload } from '../components/GeometryUpload';
import { useGeometrySync } from '../hooks/useGeometrySync';
import type { ModelSetupData, SpatialInputMethod } from '../types';
import type { DrawnFeature } from '../../Map/types/geometry';

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
};

const tabStyle: React.CSSProperties = {
  padding: '8px 16px',
  border: 'none',
  backgroundColor: 'transparent',
  cursor: 'pointer',
  fontSize: '14px',
  color: '#666',
  borderRadius: '4px 4px 0 0',
  transition: 'background-color 0.2s',
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
  const { addFeatures, deleteAll } = useDraw();
  const { map, isLoaded } = useMap();
  const { features, clearGeometry, isReady } = useGeometrySync();

  const [activeTab, setActiveTab] = useState<SpatialInputMethod>(data.geometry?.inputMethod ?? 'draw');

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

  // Handle coordinate input
  const handleCoordinateSubmit = useCallback(
    (feature: DrawnFeature) => {
      if (isReady) {
        addFeatures([feature]);
        // useGeometrySync will pick up the change via subscription
      }
    },
    [addFeatures, isReady]
  );

  // Handle file upload
  const handleFileUpload = useCallback(
    (uploadedFeatures: DrawnFeature[]) => {
      if (isReady) {
        // Clear existing features first
        deleteAll();
        // Add uploaded features
        addFeatures(uploadedFeatures);
      }
    },
    [addFeatures, deleteAll, isReady]
  );

  // Handle individual feature deletion
  const handleDeleteFeature = useCallback(
    (featureId: string | number | undefined) => {
      if (!featureId) return;
      const remaining = features.filter((f) => f.id !== featureId);
      deleteAll();
      if (remaining.length > 0) {
        addFeatures(remaining);
      }
    },
    [features, deleteAll, addFeatures]
  );

  // Fly to features when they change
  useEffect(() => {
    if (!map || !isLoaded || !features.length) return;

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
  }, [map, isLoaded, features]);

  return (
    <div style={containerStyle}>
      {/* Tab navigation */}
      <div style={tabsStyle}>
        {tabs.map((tab) => (
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
        {activeTab === 'draw' && (
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

      {/* Feature list */}
      {features.length > 0 && (
        <div style={featureListStyle}>
          <div style={{ fontSize: '12px', color: '#666', marginBottom: '8px' }}>
            {features.length} feature{features.length !== 1 ? 's' : ''} selected:
          </div>
          {features.map((feature, index) => (
            <div key={feature.id ?? index} style={featureItemStyle}>
              <span>
                {formatGeometryType(feature.geometry.type)}
                {feature.properties?.fileName && ` (from ${feature.properties.fileName})`}
              </span>
              <button
                style={deleteButtonStyle}
                onClick={() => handleDeleteFeature(feature.id)}
              >
                Remove
              </button>
            </div>
          ))}
          <button
            style={{ ...deleteButtonStyle, marginTop: '8px', width: '100%' }}
            onClick={clearGeometry}
          >
            Clear All
          </button>
        </div>
      )}
    </div>
  );
}
