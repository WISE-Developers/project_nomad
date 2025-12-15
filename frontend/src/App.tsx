import { useState, useCallback, useRef, useEffect } from 'react';
import { SplashScreen } from './components/SplashScreen';
import { DeploymentModeProvider } from './core/deployment';
import {
  MapProvider,
  MapContainer,
  DrawingToolbar,
  LayerPanel,
  BasemapSwitcher,
  MeasurementTool,
  TerrainControl,
  MapInfoControl,
  MapContextMenu,
  useDraw,
  useMap,
  useLayers,
  LayerProvider,
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
import { runModel, getModels, deleteModel } from './services/api';

interface ModelSummary {
  id: string;
  name: string;
  status: string;
  engineType: string;
  createdAt: string;
  userId: string | null;
  outputMode?: string | null;
  confidenceInterval?: number | null;
  durationDays?: number | null;
}

/**
 * Calculate bounding box from GeoJSON
 */
function getBoundsFromGeoJSON(geoJson: GeoJSON.GeoJSON): [[number, number], [number, number]] | null {
  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;

  function processCoords(coords: number[]): void {
    const [lng, lat] = coords;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }

  function processCoordArray(arr: unknown): void {
    if (!Array.isArray(arr)) return;
    if (typeof arr[0] === 'number' && typeof arr[1] === 'number' && arr.length >= 2) {
      processCoords(arr as number[]);
    } else {
      arr.forEach(processCoordArray);
    }
  }

  function processGeometry(geom: GeoJSON.Geometry): void {
    if ('coordinates' in geom) {
      processCoordArray(geom.coordinates);
    } else if (geom.type === 'GeometryCollection') {
      geom.geometries.forEach(processGeometry);
    }
  }

  const geoType = (geoJson as { type: string }).type;
  if (geoType === 'FeatureCollection') {
    (geoJson as GeoJSON.FeatureCollection).features.forEach((f) => {
      if (f.geometry) processGeometry(f.geometry);
    });
  } else if (geoType === 'Feature') {
    const feature = geoJson as GeoJSON.Feature;
    if (feature.geometry) processGeometry(feature.geometry);
  } else {
    // It's a raw geometry
    processGeometry(geoJson as GeoJSON.Geometry);
  }

  if (minLng === Infinity) return null;
  return [[minLng, minLat], [maxLng, maxLat]];
}

const headerButtonStyle: React.CSSProperties = {
  padding: '12px 24px',
  fontSize: '16px',
  fontWeight: 'bold',
  color: 'white',
  border: 'none',
  borderRadius: '8px',
  cursor: 'pointer',
  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.2)',
  textShadow: '1.5px 1.5px 3px rgba(0, 0, 0, 0.6)',
};

const headerContainerStyle: React.CSSProperties = {
  position: 'absolute',
  top: '16px',
  left: '50%',
  transform: 'translateX(-50%)',
  display: 'flex',
  gap: '8px',
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
  const [showModelsList, setShowModelsList] = useState(false);
  const [models, setModels] = useState<ModelSummary[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const { deleteAll } = useDraw();
  const { map, isLoaded } = useMap();
  const { addGeoJSONLayer, addRasterLayer } = useLayers();
  const layerCounter = useRef(0);

  // Fetch models when list is opened
  const fetchModels = useCallback(async () => {
    setModelsLoading(true);
    try {
      const data = await getModels();
      setModels(data.models);
    } catch (error) {
      console.error('Failed to fetch models:', error);
    } finally {
      setModelsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (showModelsList) {
      fetchModels();
    }
  }, [showModelsList, fetchModels]);

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

      // Extract coordinates from geometry
      let coordinates: [number, number] | [number, number][][] = [0, 0];
      let ignitionType: 'point' | 'polygon' = 'point';

      if (data.geometry.features.length > 0) {
        const feature = data.geometry.features[0];
        const geomType = feature.geometry.type;
        console.log('[App] Ignition geometry type:', geomType, 'Feature:', feature);

        if (geomType === 'Point') {
          coordinates = feature.geometry.coordinates as [number, number];
          ignitionType = 'point';
        } else if (geomType === 'Polygon') {
          coordinates = feature.geometry.coordinates as [number, number][][];
          ignitionType = 'polygon';
          console.log('[App] Using polygon ignition with coordinates:', coordinates);
        } else if (geomType === 'LineString') {
          // LineString treated as polygon for fire line ignition
          // Wrap in array to match polygon coordinate structure
          coordinates = [feature.geometry.coordinates as [number, number][]];
          ignitionType = 'polygon';
          console.log('[App] Using line ignition (as polygon) with coordinates:', coordinates);
        }
      }

      // Build time range
      const startDateTime = new Date(`${data.temporal.startDate}T${data.temporal.startTime}`);
      const endDateTime = new Date(startDateTime.getTime() + data.temporal.durationHours * 60 * 60 * 1000);

      // Helper to read file content
      const readFileContent = (file: File): Promise<string> => {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error('Failed to read file'));
          reader.readAsText(file);
        });
      };

      // Build weather configuration based on source
      let weatherConfig: {
        source: 'firestarr_csv' | 'raw_weather' | 'spotwx';
        firestarrCsvContent?: string;
        rawWeatherContent?: string;
        startingCodes?: { ffmc: number; dmc: number; dc: number };
        latitude?: number;
      };

      switch (data.weather.source) {
        case 'firestarr_csv':
          if (!data.weather.firestarrCsvFile) {
            throw new Error('FireSTARR CSV file is required');
          }
          weatherConfig = {
            source: 'firestarr_csv',
            firestarrCsvContent: await readFileContent(data.weather.firestarrCsvFile),
          };
          break;
        case 'raw_weather':
          if (!data.weather.rawWeatherFile) {
            throw new Error('Raw weather file is required');
          }
          if (!data.weather.startingCodes) {
            throw new Error('Starting codes are required');
          }
          weatherConfig = {
            source: 'raw_weather',
            rawWeatherContent: await readFileContent(data.weather.rawWeatherFile),
            startingCodes: data.weather.startingCodes,
            latitude: data.geometry.features[0]?.geometry?.type === 'Point'
              ? (data.geometry.features[0].geometry.coordinates as [number, number])[1]
              : data.geometry.bounds?.[1],
          };
          break;
        case 'spotwx':
        default:
          weatherConfig = {
            source: 'spotwx',
          };
          break;
      }

      // Create and run model in single atomic call (no orphaned drafts)
      const engineName = data.model.engine === 'firestarr' ? 'FireSTARR' : 'WISE';
      const result = await runModel({
        name: `${engineName} - ${data.temporal.startDate}`,
        engineType: data.model.engine,
        ignition: {
          type: ignitionType,
          coordinates,
        },
        timeRange: {
          start: startDateTime.toISOString(),
          end: endDateTime.toISOString(),
        },
        weather: weatherConfig,
        scenarios: data.model.runType === 'probabilistic' ? 100 : 1,
        outputMode: data.model.outputMode,
        // Convert from decimal (0.8) to percentage (80) for backend
        confidenceInterval: data.model.confidenceInterval ? Math.round(data.model.confidenceInterval * 100) : 50,
        smoothPerimeter: data.model.smoothPerimeter,
      });

      console.log('Model created and execution started:', result);

      // Start watching job status
      watchJob(result.jobId);

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

  const handleAddToMap = useCallback((output: OutputItem, geoJson: GeoJSON.GeoJSON, modelInfo?: { modelId: string; modelName: string; engineType: string; breaksMode?: 'static' | 'dynamic' }) => {
    if (!map || !isLoaded) {
      console.warn('Map not ready');
      return;
    }

    const layerId = `model-output-${++layerCounter.current}`;

    // Build layer name with model context
    let layerName = output.name;
    if (modelInfo) {
      const shortId = modelInfo.modelId.slice(0, 8);
      layerName = `${modelInfo.modelName} [${shortId}] - ${output.name}`;
    }

    // Determine if this is ignition (dark red) or model output (use feature colors)
    const isIgnition = output.id.startsWith('ignition-');

    // Use the layer management hook to add the layer
    // This registers it with the LayerPanel
    // Wrap single features in a FeatureCollection if needed
    const featureCollection: GeoJSON.FeatureCollection = 'features' in geoJson
      ? geoJson as GeoJSON.FeatureCollection
      : {
          type: 'FeatureCollection',
          features: [geoJson as GeoJSON.Feature],
        };

    if (isIgnition) {
      // Ignition: dark red, static color
      addGeoJSONLayer({
        id: layerId,
        name: layerName,
        data: featureCollection,
        fillColor: '#8B0000',
        strokeColor: '#8B0000',
        opacity: 1.0,
        fillOpacity: 0.3,
        visible: true,
        zIndex: layerCounter.current,
      });
    } else {
      // Model output: use colors from feature properties (quantile gradient)
      // Include resultId and metadata for layer persistence/reload
      addGeoJSONLayer({
        id: layerId,
        name: layerName,
        data: featureCollection,
        useFeatureColors: true,  // Use 'color' property from each feature
        fillColor: '#FFD700',    // Fallback if no color property
        strokeColor: '#FFD700',
        opacity: 1.0,
        fillOpacity: 0.5,
        visible: true,
        zIndex: layerCounter.current,
        // Persistence metadata
        resultId: modelInfo?.modelId,
        outputType: output.type,
        breaksMode: modelInfo?.breaksMode,
      });
    }

    // Zoom to the added feature
    const bounds = getBoundsFromGeoJSON(geoJson);
    if (bounds) {
      map.fitBounds(bounds, {
        padding: 50,
        maxZoom: 14,
        duration: 1000,
      });
    }

    console.log(`Added layer ${layerId} for output ${layerName}`);
  }, [map, isLoaded, addGeoJSONLayer]);

  const handleAddRasterToMap = useCallback((
    output: OutputItem,
    bounds: [number, number, number, number],
    tileUrl: string,
    modelInfo?: { modelId: string; modelName: string; engineType: string }
  ) => {
    if (!map || !isLoaded) {
      console.warn('Map not ready');
      return;
    }

    const layerId = `raster-output-${++layerCounter.current}`;

    // Build layer name with model context
    let layerName = `${output.name} (Raster)`;
    if (modelInfo) {
      const shortId = modelInfo.modelId.slice(0, 8);
      layerName = `${modelInfo.modelName} [${shortId}] - ${output.name} (Raster)`;
    }

    // Add the raster layer
    addRasterLayer({
      id: layerId,
      name: layerName,
      url: tileUrl,
      bounds,
      tileSize: 256,
      opacity: 0.8,
      visible: true,
      zIndex: layerCounter.current,
      resultId: modelInfo?.modelId,
      outputType: output.type,
    });

    // Zoom to the raster bounds
    map.fitBounds(
      [[bounds[0], bounds[1]], [bounds[2], bounds[3]]],
      {
        padding: 50,
        maxZoom: 14,
        duration: 1000,
      }
    );

    console.log(`Added raster layer ${layerId} for output ${layerName}`);
  }, [map, isLoaded, addRasterLayer]);

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

      {/* Header buttons */}
      {!showWizard && (
        <div style={headerContainerStyle}>
          <button
            style={{ ...headerButtonStyle, backgroundColor: '#ff6b35' }}
            onClick={handleNewModel}
          >
            <i className="fa-solid fa-fire" style={{ marginRight: '8px' }} />New Fire Model
          </button>
          <button
            style={{ ...headerButtonStyle, backgroundColor: '#3b82f6' }}
            onClick={() => setShowModelsList(!showModelsList)}
          >
            <i className="fa-solid fa-clipboard-list" style={{ marginRight: '8px' }} />My Models
          </button>
        </div>
      )}

      {/* Models List Panel */}
      {showModelsList && !showWizard && (
        <div
          style={{
            position: 'absolute',
            top: '80px',
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: '#1f2937',
            borderRadius: '8px',
            padding: '16px',
            minWidth: '400px',
            maxWidth: '600px',
            maxHeight: '60vh',
            overflowY: 'auto',
            zIndex: 1000,
            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3 style={{ margin: 0, color: 'white' }}>My Models</h3>
            <button
              onClick={() => setShowModelsList(false)}
              style={{
                background: 'none',
                border: 'none',
                color: '#9ca3af',
                fontSize: '20px',
                cursor: 'pointer',
              }}
            >
              ✕
            </button>
          </div>
          {modelsLoading ? (
            <div style={{ color: '#9ca3af', textAlign: 'center', padding: '20px' }}>Loading...</div>
          ) : models.length === 0 ? (
            <div style={{ color: '#9ca3af', textAlign: 'center', padding: '20px' }}>No models yet</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {models.map((model) => (
                <div
                  key={model.id}
                  style={{
                    backgroundColor: '#374151',
                    padding: '12px',
                    borderRadius: '6px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div>
                    <div style={{ color: 'white', fontWeight: 500 }}>{model.name}</div>
                    <div style={{ color: '#9ca3af', fontSize: '12px' }}>
                      <span style={{
                        display: 'inline-block',
                        padding: '2px 6px',
                        borderRadius: '3px',
                        backgroundColor: model.status === 'completed' ? '#065f46' :
                                         model.status === 'draft' ? '#4b5563' :
                                         model.status === 'running' ? '#1e40af' : '#7f1d1d',
                        marginRight: '8px',
                      }}>
                        {model.status}
                      </span>
                      {model.userId && (
                        <span style={{ marginRight: '8px', color: '#60a5fa' }}>
                          {model.userId}
                        </span>
                      )}
                      {new Date(model.createdAt).toLocaleString()}
                    </div>
                    {/* Show output mode, confidence, and duration for completed models */}
                    {model.status === 'completed' && (model.outputMode || model.durationDays) && (
                      <div style={{ color: '#9ca3af', fontSize: '11px', marginTop: '4px' }}>
                        {model.outputMode && (
                          <span style={{
                            display: 'inline-block',
                            padding: '1px 5px',
                            borderRadius: '3px',
                            backgroundColor: model.outputMode === 'pseudo-deterministic' ? '#7c3aed' : '#0369a1',
                            color: 'white',
                            marginRight: '6px',
                          }}>
                            {model.outputMode === 'pseudo-deterministic' ? 'Perimeters' : 'Probability'}
                            {model.outputMode === 'pseudo-deterministic' && model.confidenceInterval && ` ${model.confidenceInterval}%`}
                          </span>
                        )}
                        {model.durationDays && (
                          <span style={{ color: '#60a5fa' }}>
                            {model.durationDays} day{model.durationDays !== 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    {model.status === 'completed' && (
                      <button
                        onClick={() => {
                          setReviewModelId(model.id);
                          setShowModelsList(false);
                        }}
                        style={{
                          padding: '6px 12px',
                          backgroundColor: '#10b981',
                          color: 'white',
                          border: 'none',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          fontSize: '12px',
                        }}
                      >
                        View Results
                      </button>
                    )}
                    <button
                      onClick={async () => {
                        if (confirm(`Delete "${model.name}"? This will also delete all results.`)) {
                          try {
                            await deleteModel(model.id);
                            fetchModels();
                          } catch (err) {
                            console.error('Failed to delete model:', err);
                            alert('Failed to delete model');
                          }
                        }
                      }}
                      style={{
                        padding: '6px 12px',
                        backgroundColor: '#dc2626',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontSize: '12px',
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
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
                <div style={{ fontSize: '24px', marginBottom: '8px' }}><i className="fa-solid fa-fire" /></div>
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
          <MapInfoControl />
          <MapContextMenu />
        </>
      )}

      {/* Model Review Panel */}
      {reviewModelId && (
        <ModelReviewPanel
          modelId={reviewModelId}
          onClose={handleCloseReview}
          onAddToMap={handleAddToMap}
          onAddRasterToMap={handleAddRasterToMap}
        />
      )}
    </>
  );
}

function App() {
  const [showSplash, setShowSplash] = useState(true);

  const handleEnter = useCallback(() => {
    setShowSplash(false);
  }, []);

  return (
    <DeploymentModeProvider>
      <div style={{ width: '100vw', height: '100vh' }}>
        {showSplash && <SplashScreen onEnter={handleEnter} />}
        <MapProvider>
        <MapContainer
          options={{
            center: [-115.5, 54.5], // Alberta
            zoom: 6,
          }}
        >
          <LayerProvider>
            <AppContent />
          </LayerProvider>
        </MapContainer>
      </MapProvider>
      </div>
    </DeploymentModeProvider>
  );
}

export default App;
