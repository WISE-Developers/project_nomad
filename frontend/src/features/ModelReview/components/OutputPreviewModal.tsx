/**
 * Output Preview Modal
 *
 * Displays a map preview of model outputs (GeoJSON contours).
 */

import React, { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { API_BASE_URL } from '../../../services/api';
import type { OutputItem } from '../types';

/**
 * Props for OutputPreviewModal
 */
interface OutputPreviewModalProps {
  /** Output to preview */
  output: OutputItem;
  /** Called when modal is closed */
  onClose: () => void;
  /** Called when "Add to Map" is clicked */
  onAddToMap: (output: OutputItem) => void;
}

/**
 * GeoJSON feature collection type
 */
interface ContourFeatureCollection {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    properties: {
      probability: number;
      color: string;
      label: string;
    };
    geometry: {
      type: string;
      coordinates: unknown;
    };
  }>;
}

/**
 * OutputPreviewModal displays a map preview of output data.
 */
export function OutputPreviewModal({
  output,
  onClose,
  onAddToMap,
}: OutputPreviewModalProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [geoJsonData, setGeoJsonData] = useState<ContourFeatureCollection | null>(null);

  // Fetch GeoJSON preview data
  useEffect(() => {
    async function fetchPreview() {
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch(`${API_BASE_URL}${output.previewUrl}`);
        if (!response.ok) {
          throw new Error(`Failed to fetch preview: ${response.status}`);
        }
        const data = await response.json();
        setGeoJsonData(data);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        setError(message);
      } finally {
        setIsLoading(false);
      }
    }

    fetchPreview();
  }, [output.previewUrl]);

  // Initialize map when GeoJSON is loaded
  useEffect(() => {
    if (!mapContainerRef.current || !geoJsonData || mapRef.current) return;

    const accessToken = import.meta.env.VITE_MAPBOX_TOKEN;
    if (!accessToken) {
      setError('VITE_MAPBOX_TOKEN not configured');
      return;
    }

    mapboxgl.accessToken = accessToken;

    try {
      const map = new mapboxgl.Map({
        container: mapContainerRef.current,
        style: 'mapbox://styles/mapbox/light-v11',
        center: [-115, 55], // Default Alberta center
        zoom: 8,
        attributionControl: true,
      });

      mapRef.current = map;

      map.on('load', () => {
        // Add the GeoJSON source
        map.addSource('contours', {
          type: 'geojson',
          data: geoJsonData as GeoJSON.GeoJSON,
        });

        // Add fill layer for probability contours
        map.addLayer({
          id: 'contours-fill',
          type: 'fill',
          source: 'contours',
          paint: {
            'fill-color': ['get', 'color'],
            'fill-opacity': 0.5,
          },
        });

        // Add outline layer
        map.addLayer({
          id: 'contours-outline',
          type: 'line',
          source: 'contours',
          paint: {
            'line-color': ['get', 'color'],
            'line-width': 2,
          },
        });

        // Fit map to data bounds after source is added
        if (geoJsonData.features.length > 0) {
          const bounds = new mapboxgl.LngLatBounds();
          let hasValidCoords = false;

          geoJsonData.features.forEach((feature) => {
            if (feature.geometry.type === 'Polygon') {
              const coords = feature.geometry.coordinates as [number, number][][];
              if (coords[0] && coords[0].length > 0) {
                coords[0].forEach((coord) => {
                  if (Array.isArray(coord) && coord.length >= 2) {
                    bounds.extend(coord);
                    hasValidCoords = true;
                  }
                });
              }
            } else if (feature.geometry.type === 'MultiPolygon') {
              const coords = feature.geometry.coordinates as [number, number][][][];
              coords.forEach((polygon) => {
                if (polygon[0] && polygon[0].length > 0) {
                  polygon[0].forEach((coord) => {
                    if (Array.isArray(coord) && coord.length >= 2) {
                      bounds.extend(coord);
                      hasValidCoords = true;
                    }
                  });
                }
              });
            }
          });

          if (hasValidCoords && !bounds.isEmpty()) {
            console.log('[Preview] Fitting bounds:', bounds.toArray());
            // Wait for map to be idle before fitting bounds
            map.once('idle', () => {
              map.fitBounds(bounds, { padding: 50, maxZoom: 14 });
            });
          } else {
            console.warn('[Preview] No valid bounds to fit, using default view');
          }
        }

        // Add navigation controls
        map.addControl(new mapboxgl.NavigationControl(), 'top-right');
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Map initialization failed';
      setError(message);
    }

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [geoJsonData]);

  // Handle escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  const handleAddToMap = () => {
    onAddToMap(output);
    onClose();
  };

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={headerStyle}>
          <div style={titleSectionStyle}>
            <h2 style={titleStyle}>{output.name}</h2>
            <span style={subtitleStyle}>Preview</span>
          </div>
          <button style={closeButtonStyle} onClick={onClose}>
            &times;
          </button>
        </div>

        {/* Map container */}
        <div style={mapWrapperStyle}>
          {isLoading && (
            <div style={loadingStyle}>
              <div style={spinnerStyle} />
              <div>Loading preview...</div>
            </div>
          )}
          {error && (
            <div style={errorStyle}>
              <div>Failed to load preview</div>
              <div style={errorDetailStyle}>{error}</div>
            </div>
          )}
          <div ref={mapContainerRef} style={mapContainerStyle} />
        </div>

        {/* Legend */}
        {geoJsonData && !isLoading && !error && (
          <div style={legendStyle}>
            <div style={legendTitleStyle}>Burn Probability</div>
            <div style={legendItemsStyle}>
              {[
                { label: '90%', color: '#ff0000' },
                { label: '75%', color: '#ff8000' },
                { label: '50%', color: '#ffff00' },
                { label: '25%', color: '#80ff00' },
                { label: '10%', color: '#00ff00' },
              ].map((item) => (
                <div key={item.label} style={legendItemStyle}>
                  <span
                    style={{
                      ...legendColorStyle,
                      backgroundColor: item.color,
                    }}
                  />
                  <span>{item.label}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        <div style={actionsStyle}>
          <button style={secondaryButtonStyle} onClick={onClose}>
            Close
          </button>
          <button style={primaryButtonStyle} onClick={handleAddToMap}>
            Add to Map
          </button>
        </div>
      </div>
    </div>
  );
}

// Styles
const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  backgroundColor: 'rgba(0, 0, 0, 0.6)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 9999,
};

const modalStyle: React.CSSProperties = {
  backgroundColor: 'white',
  borderRadius: '12px',
  width: '90%',
  maxWidth: '900px',
  maxHeight: '90vh',
  display: 'flex',
  flexDirection: 'column',
  boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  padding: '20px 24px',
  borderBottom: '1px solid #e0e0e0',
};

const titleSectionStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
};

const titleStyle: React.CSSProperties = {
  fontSize: '20px',
  fontWeight: 600,
  color: '#333',
  margin: 0,
};

const subtitleStyle: React.CSSProperties = {
  fontSize: '14px',
  color: '#666',
};

const closeButtonStyle: React.CSSProperties = {
  padding: '4px 12px',
  fontSize: '24px',
  fontWeight: 300,
  color: '#666',
  backgroundColor: 'transparent',
  border: 'none',
  cursor: 'pointer',
  borderRadius: '4px',
};

const mapWrapperStyle: React.CSSProperties = {
  position: 'relative',
  flex: 1,
  minHeight: '400px',
};

const mapContainerStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  minHeight: '400px',
};

const loadingStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '12px',
  backgroundColor: '#f5f5f5',
  color: '#666',
  zIndex: 10,
};

const spinnerStyle: React.CSSProperties = {
  width: '32px',
  height: '32px',
  border: '3px solid #e0e0e0',
  borderTopColor: '#1976d2',
  borderRadius: '50%',
  animation: 'spin 1s linear infinite',
};

const errorStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '8px',
  backgroundColor: '#ffebee',
  color: '#c62828',
  zIndex: 10,
};

const errorDetailStyle: React.CSSProperties = {
  fontSize: '12px',
  color: '#666',
};

const legendStyle: React.CSSProperties = {
  padding: '12px 24px',
  borderTop: '1px solid #e0e0e0',
  backgroundColor: '#fafafa',
};

const legendTitleStyle: React.CSSProperties = {
  fontSize: '12px',
  fontWeight: 500,
  color: '#666',
  marginBottom: '8px',
};

const legendItemsStyle: React.CSSProperties = {
  display: 'flex',
  gap: '16px',
  flexWrap: 'wrap',
};

const legendItemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  fontSize: '12px',
  color: '#333',
};

const legendColorStyle: React.CSSProperties = {
  width: '16px',
  height: '16px',
  borderRadius: '3px',
  border: '1px solid rgba(0, 0, 0, 0.1)',
};

const actionsStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: '12px',
  padding: '16px 24px',
  borderTop: '1px solid #e0e0e0',
};

const secondaryButtonStyle: React.CSSProperties = {
  padding: '10px 20px',
  fontSize: '14px',
  fontWeight: 500,
  color: '#666',
  backgroundColor: 'white',
  border: '1px solid #e0e0e0',
  borderRadius: '6px',
  cursor: 'pointer',
};

const primaryButtonStyle: React.CSSProperties = {
  padding: '10px 20px',
  fontSize: '14px',
  fontWeight: 500,
  color: 'white',
  backgroundColor: '#1976d2',
  border: 'none',
  borderRadius: '6px',
  cursor: 'pointer',
};
