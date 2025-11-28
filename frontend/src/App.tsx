import { useState, useCallback, useRef } from 'react';
import {
  MapProvider,
  MapContainer,
  DrawingToolbar,
  LayerPanel,
  BasemapSwitcher,
  MeasurementTool,
  TerrainControl,
  useDraw,
  useMap,
} from './features/Map';
import type { OutputItem } from './features/ModelReview/types';
import { ModelSetupWizard } from './features/ModelSetup';
import type { ModelSetupData } from './features/ModelSetup';
import { ModelReviewPanel } from './features/ModelReview';
import {
  useJobNotifications,
  JobStatusToast,
  NotificationPermissionBanner,
} from './features/Notifications';
import { createModel, executeModel } from './services/api';

const newModelButtonStyle: React.CSSProperties = {
  position: 'absolute',
  top: '16px',
  left: '50%',
  transform: 'translateX(-50%)',
  padding: '12px 24px',
  fontSize: '16px',
  fontWeight: 'bold',
  backgroundColor: '#ff6b35',
  color: 'white',
  border: 'none',
  borderRadius: '8px',
  cursor: 'pointer',
  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.2)',
  zIndex: 1000,
};

/**
 * Inner component that has access to DrawContext
 */
function AppContent() {
  const [showWizard, setShowWizard] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [reviewModelId, setReviewModelId] = useState<string | null>(null);
  const { deleteAll } = useDraw();
  const { map, isLoaded } = useMap();
  const layerCounter = useRef(0);

  // Job notifications
  const {
    status: jobStatus,
    watchJob,
    stopWatching,
    requestPermission,
  } = useJobNotifications({
    onComplete: (status) => {
      console.log('Model completed:', status);
    },
    onError: (status) => {
      console.error('Model failed:', status);
    },
  });

  const handleNewModel = useCallback(() => {
    setShowWizard(true);
    setSubmitError(null);
  }, []);

  const handleWizardComplete = useCallback(async (data: ModelSetupData) => {
    console.log('Model setup complete:', data);
    setIsSubmitting(true);
    setSubmitError(null);

    try {
      // Request notification permission
      await requestPermission();

      // 1. Create the model
      const modelName = `Fire Model - ${data.temporal.startDate}`;
      const createResult = await createModel({
        name: modelName,
        engineType: data.model.engine,
      });

      console.log('Model created:', createResult);

      // 2. Extract coordinates from geometry
      let coordinates: [number, number] | [number, number][] = [0, 0];
      let ignitionType: 'point' | 'polygon' = 'point';

      if (data.geometry.features.length > 0) {
        const feature = data.geometry.features[0];
        if (feature.geometry.type === 'Point') {
          coordinates = feature.geometry.coordinates as [number, number];
          ignitionType = 'point';
        } else if (feature.geometry.type === 'Polygon') {
          coordinates = feature.geometry.coordinates[0] as [number, number][];
          ignitionType = 'polygon';
        }
      }

      // 3. Build time range
      const startDateTime = new Date(`${data.temporal.startDate}T${data.temporal.startTime}`);
      const endDateTime = new Date(startDateTime.getTime() + data.temporal.durationHours * 60 * 60 * 1000);

      // 4. Execute the model
      const executeResult = await executeModel(createResult.id, {
        ignition: {
          type: ignitionType,
          coordinates,
        },
        timeRange: {
          start: startDateTime.toISOString(),
          end: endDateTime.toISOString(),
        },
        weather: {
          source: data.weather.source === 'manual' ? 'manual' : 'spotwx',
          manual: data.weather.fwi ? {
            ffmc: data.weather.fwi.ffmc,
            dmc: data.weather.fwi.dmc,
            dc: data.weather.fwi.dc,
            windSpeed: 15, // Default values - TODO: add to UI
            windDirection: 270,
            temperature: 20,
            humidity: 40,
          } : undefined,
        },
        scenarios: data.model.runType === 'probabilistic' ? 100 : 1,
      });

      console.log('Execution started:', executeResult);

      // 5. Start watching job status
      watchJob(executeResult.jobId);

      setShowWizard(false);
    } catch (error) {
      console.error('Failed to submit model:', error);
      setSubmitError(error instanceof Error ? error.message : 'Failed to submit model');
    } finally {
      setIsSubmitting(false);
    }
  }, [requestPermission, watchJob]);

  const handleWizardCancel = useCallback(() => {
    deleteAll(); // Clear drawn geometry on cancel
    setShowWizard(false);
    setSubmitError(null);
  }, [deleteAll]);

  const handleDismissToast = useCallback(() => {
    stopWatching();
  }, [stopWatching]);

  const handleViewResults = useCallback(() => {
    if (jobStatus?.modelId) {
      console.log('View results for model:', jobStatus.modelId);
      setReviewModelId(jobStatus.modelId);
    }
    stopWatching();
  }, [jobStatus, stopWatching]);

  const handleCloseReview = useCallback(() => {
    setReviewModelId(null);
  }, []);

  const handleAddToMap = useCallback((output: OutputItem, geoJson: GeoJSON.GeoJSON) => {
    if (!map || !isLoaded) {
      console.warn('Map not ready');
      return;
    }

    const layerId = `model-output-${++layerCounter.current}`;
    const sourceId = `${layerId}-source`;

    // Add source
    map.addSource(sourceId, {
      type: 'geojson',
      data: geoJson,
    });

    // Determine layer type based on geometry
    const geomType = (geoJson as GeoJSON.FeatureCollection).features?.[0]?.geometry?.type
      || (geoJson as GeoJSON.Feature).geometry?.type;

    if (geomType === 'Polygon' || geomType === 'MultiPolygon') {
      // Add fill layer
      map.addLayer({
        id: `${layerId}-fill`,
        type: 'fill',
        source: sourceId,
        paint: {
          'fill-color': '#ff6b35',
          'fill-opacity': 0.4,
        },
      });
      // Add outline
      map.addLayer({
        id: `${layerId}-outline`,
        type: 'line',
        source: sourceId,
        paint: {
          'line-color': '#ff6b35',
          'line-width': 2,
        },
      });
    } else if (geomType === 'Point' || geomType === 'MultiPoint') {
      map.addLayer({
        id: layerId,
        type: 'circle',
        source: sourceId,
        paint: {
          'circle-radius': 6,
          'circle-color': '#ff6b35',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
        },
      });
    } else if (geomType === 'LineString' || geomType === 'MultiLineString') {
      map.addLayer({
        id: layerId,
        type: 'line',
        source: sourceId,
        paint: {
          'line-color': '#ff6b35',
          'line-width': 3,
        },
      });
    }

    console.log(`Added layer ${layerId} for output ${output.name}`);
  }, [map, isLoaded]);

  return (
    <>
      {/* Notification permission banner */}
      <NotificationPermissionBanner />

      {/* Job status toast */}
      <JobStatusToast
        status={jobStatus}
        onDismiss={handleDismissToast}
        onViewResults={handleViewResults}
      />

      {/* New Model button */}
      {!showWizard && (
        <button style={newModelButtonStyle} onClick={handleNewModel}>
          🔥 New Fire Model
        </button>
      )}

      {/* Model Setup Wizard */}
      {showWizard && (
        <>
          <ModelSetupWizard
            onComplete={handleWizardComplete}
            onCancel={handleWizardCancel}
          />
          {/* Drawing toolbar on bottom-left when wizard is open (out of the way) */}
          <DrawingToolbar position="bottom-left" />

          {/* Submission overlay */}
          {isSubmitting && (
            <div
              style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: 'rgba(0, 0, 0, 0.5)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 10000,
              }}
            >
              <div
                style={{
                  backgroundColor: '#1f2937',
                  padding: '24px 48px',
                  borderRadius: '8px',
                  color: 'white',
                  textAlign: 'center',
                }}
              >
                <div style={{ fontSize: '24px', marginBottom: '8px' }}>🔥</div>
                <div>Submitting model...</div>
              </div>
            </div>
          )}

          {/* Error display */}
          {submitError && (
            <div
              style={{
                position: 'fixed',
                bottom: '20px',
                left: '50%',
                transform: 'translateX(-50%)',
                backgroundColor: '#dc2626',
                color: 'white',
                padding: '12px 24px',
                borderRadius: '8px',
                zIndex: 10000,
              }}
            >
              {submitError}
            </div>
          )}
        </>
      )}

      {/* Map tools (visible when wizard is closed) */}
      {!showWizard && (
        <>
          <DrawingToolbar position="top-left" />
          <MeasurementTool position="bottom-left" />
          <LayerPanel position="top-right" />
          <BasemapSwitcher position="bottom-right" />
          <TerrainControl position="top-right" />
        </>
      )}

      {/* Model Review Panel */}
      {reviewModelId && (
        <ModelReviewPanel
          modelId={reviewModelId}
          onClose={handleCloseReview}
          onAddToMap={handleAddToMap}
        />
      )}
    </>
  );
}

function App() {
  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <MapProvider>
        <MapContainer
          options={{
            center: [-115.5, 54.5], // Alberta
            zoom: 6,
          }}
        >
          <AppContent />
        </MapContainer>
      </MapProvider>
    </div>
  );
}

export default App;
