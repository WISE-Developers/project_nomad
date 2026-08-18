import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { SplashScreen } from './components/SplashScreen';
import { DeploymentModeProvider } from './core/deployment';
import {
  MapProvider,
  MapContainer,
  LayerPanel,
  MapInfoControl,
  MapContextMenu,
  RasterLegend,
  MapCapture,
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
import { resolveIgnitionLatitude } from './features/ModelSetup/utils/ignitionLatitude';
import { resolveZonedInstant } from './features/ModelSetup/utils/zonedInstant';
import { runModel } from './services/api';
import { registerServiceWorker } from './services/serviceWorker';
import type { ModelResultsResponse } from './features/ModelReview/types';
import { OpenNomadProvider, createDefaultAdapter, useOpenNomad } from './openNomad';
import { DashboardContainer } from './features/Dashboard';
import { SettingsModal } from './features/Settings/SettingsModal';
import { AboutModal } from './components/AboutModal';
import { ContentSplashGate } from './components/ContentSplashGate';

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
  padding: 'clamp(8px, 2vw, 12px) clamp(12px, 3vw, 24px)',
  fontSize: 'clamp(12px, 2.5vw, 16px)',
  fontWeight: 'bold',
  color: 'white',
  border: 'none',
  borderRadius: '8px',
  cursor: 'pointer',
  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.2)',
  textShadow: '1.5px 1.5px 3px rgba(0, 0, 0, 0.6)',
  whiteSpace: 'nowrap' as const,
};

const headerContainerStyle: React.CSSProperties = {
  position: 'absolute',
  top: '16px',
  left: '50%',
  transform: 'translateX(-50%)',
  display: 'flex',
  gap: 'clamp(4px, 1vw, 8px)',
  zIndex: 1000,
};

/**
 * Inner component that has access to DrawContext
 */
function AppContent() {
  const api = useOpenNomad();
  const [showWizard, setShowWizard] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [reviewModelId, setReviewModelId] = useState<string | null>(null);
  const [showDashboard, setShowDashboard] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const { deleteAll } = useDraw();
  const { map, isLoaded } = useMap();
  const { addGeoJSONLayer, addRasterLayer } = useLayers();
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

      // Extract coordinates from geometry
      let coordinates: [number, number] | [number, number][] | [number, number][][] = [0, 0];
      let ignitionType: 'point' | 'polygon' | 'linestring' = 'point';

      if (data.geometry.features.length > 0) {
        const feature = data.geometry.features[0];
        const geomType = feature.geometry.type;
        console.log('[App] Ignition geometry type:', geomType, 'Feature:', feature);

        if (geomType === 'Point') {
          coordinates = feature.geometry.coordinates as [number, number];
          ignitionType = 'point';
        } else if (geomType === 'Polygon') {
          // Ensure polygon rings are closed (GeoJSON spec: first === last coordinate)
          const rawRings = feature.geometry.coordinates as [number, number][][];
          coordinates = rawRings.map((ring) => {
            const first = ring[0];
            const last = ring[ring.length - 1];
            if (first[0] !== last[0] || first[1] !== last[1]) {
              return [...ring, first];
            }
            return ring;
          });
          ignitionType = 'polygon';
          console.log('[App] Using polygon ignition with coordinates:', coordinates);
        } else if (geomType === 'LineString') {
          // LineString sent as native linestring type for fire line ignition
          coordinates = feature.geometry.coordinates as [number, number][];
          ignitionType = 'linestring';
          console.log('[App] Using line ignition with coordinates:', coordinates);
        }
      }

      // Build time range
      // Resolved in the model's own timezone, never the browser's (#355).
      const startDateTime = resolveZonedInstant(
        data.temporal.startDate,
        data.temporal.startTime,
        data.temporal.timezone,
      );
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
            latitude: resolveIgnitionLatitude(data.geometry),
          };
          break;
        case 'spotwx': {
          if (!data.weather.spotwxFile) {
            throw new Error('SpotWX CSV file is required');
          }
          if (!data.weather.startingCodes) {
            throw new Error('Starting codes are required');
          }
          // Frontend normalizes SpotWX exports into raw_weather shape and
          // submits through the backend's raw_weather pipeline so no SpotWX
          // API key is required for file uploads (refs #244).
          const { normalizeSpotwxToRawWeather } = await import(
            './openNomad/weather/index.js'
          );
          const spotwxRaw = await readFileContent(data.weather.spotwxFile);
          weatherConfig = {
            source: 'raw_weather',
            rawWeatherContent: normalizeSpotwxToRawWeather(spotwxRaw),
            startingCodes: data.weather.startingCodes,
            latitude: resolveIgnitionLatitude(data.geometry),
          };
          break;
        }
        default:
          throw new Error(`Unsupported weather source: ${data.weather.source}`);
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
        timezone: data.temporal.timezone,
        weather: weatherConfig,
        scenarios: data.model.runType === 'probabilistic' ? 100 : 1,
        outputMode: data.model.outputMode,
        modelMode: data.model.modelMode ?? 'probabilistic',
        notes: data.execution?.notes,
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

  const handleAddToMap = useCallback((output: OutputItem, geoJson: GeoJSON.GeoJSON, modelInfo?: { modelId: string; modelName: string; engineType: string }) => {
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
    } else if (output.type === 'perimeter' && output.metadata?.color) {
      // Deterministic perimeter: use assigned color from backend
      const color = output.metadata.color as string;
      addGeoJSONLayer({
        id: layerId,
        name: layerName,
        data: featureCollection,
        fillColor: color,
        strokeColor: color,
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
        fillColor: '#e65100',    // Fallback: orange (not yellow)
        strokeColor: '#e65100',
        opacity: 1.0,
        fillOpacity: 0.5,
        visible: true,
        zIndex: layerCounter.current,
        // Persistence metadata
        resultId: modelInfo?.modelId,
        outputType: output.type,
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

  const handleAddRasterToMap = useCallback(async (
    output: OutputItem,
    bounds: [number, number, number, number],
    tileUrl: string,
    modelInfo?: { modelId: string; modelName: string; engineType: string }
  ): Promise<void> => {
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

    // Zoom to the raster bounds (start zooming while tiles load)
    map.fitBounds(
      [[bounds[0], bounds[1]], [bounds[2], bounds[3]]],
      {
        padding: 50,
        maxZoom: 14,
        duration: 1000,
      }
    );

    // Arrival-time raster (#226) — server-side classified tiles. Default to
    // daily; user can toggle to hourly via the legend, which re-fetches tiles.
    const isArrival = output.type === 'arrival_time';
    const initialTimestep: 'daily' | 'hourly' = 'daily';
    const effectiveUrl = isArrival
      ? `${tileUrl}${tileUrl.includes('?') ? '&' : '?'}t=${initialTimestep}`
      : tileUrl;
    const arrivalMeta = isArrival
      ? {
          offsetDay: Number(output.metadata?.offsetDay ?? 0),
          startJulian: Number(output.metadata?.startJulian ?? 0),
          endJulian: Number(output.metadata?.endJulian ?? 0),
          startDate: String(output.metadata?.startDate ?? new Date().toISOString()),
          timestep: initialTimestep,
        }
      : undefined;

    // Add the raster layer and wait for tiles to load
    await addRasterLayer({
      id: layerId,
      name: layerName,
      url: effectiveUrl,
      bounds,
      tileSize: 256,
      opacity: isArrival ? 0.85 : 0.8,
      visible: true,
      zIndex: layerCounter.current,
      resultId: modelInfo?.modelId,
      outputType: output.type,
      legendType: isArrival ? 'arrival' : 'probability',
      arrivalMeta,
    });

    console.log(`Added raster layer ${layerId} for output ${layerName}`);
  }, [map, isLoaded, addRasterLayer]);

  // Handler for model card "Add to Map" button - fetches results and adds first output
  const handleModelCardAddToMap = useCallback(async (modelId: string) => {
    try {
      // Fetch model results via adapter (supports embedded mode)
      const resultsUrl = api.results.getModelResultsUrl(modelId);
      const response = await api.fetch(resultsUrl);
      if (!response.ok) {
        console.error('Failed to fetch model results:', response.status);
        return;
      }
      const results: ModelResultsResponse = await response.json();

      // Find first output with a preview URL
      const output = results.outputs.find(o => o.previewUrl);
      if (!output) {
        console.warn('No outputs with previewUrl found');
        return;
      }

      // Fetch preview GeoJSON via adapter
      const previewUrl = api.results.getPreviewUrl(output.id);
      const previewResponse = await api.fetch(previewUrl);
      if (!previewResponse.ok) {
        console.error('Failed to fetch preview:', previewResponse.status);
        return;
      }
      const geoJson = await previewResponse.json();

      // Add to map using existing handler
      handleAddToMap(output, geoJson, {
        modelId: results.modelId,
        modelName: results.modelName,
        engineType: results.engineType,
      });
    } catch (err) {
      console.error('Error adding model to map:', err);
    }
  }, [api, handleAddToMap]);

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
          <img
            src="/nomad-logo.png"
            alt="About Project Nomad"
            title="About Project Nomad"
            onClick={() => setShowAbout(true)}
            style={{
              width: '44px',
              height: '44px',
              borderRadius: '8px',
              cursor: 'pointer',
              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
            }}
          />
          <button
            style={{ ...headerButtonStyle, backgroundColor: '#ff6b35' }}
            onClick={handleNewModel}
          >
            <i className="fa-solid fa-fire" style={{ marginRight: '8px' }} />New Fire Model
          </button>
          <button
            style={{ ...headerButtonStyle, backgroundColor: '#3b82f6' }}
            onClick={() => setShowDashboard(!showDashboard)}
          >
            <i className="fa-solid fa-clipboard-list" style={{ marginRight: '8px' }} />Dashboard
          </button>
          <MapCapture />
          <button
            style={{ ...headerButtonStyle, backgroundColor: '#4b5563', padding: '12px 16px' }}
            onClick={() => setShowSettings(true)}
            title="Settings"
          >
            <i className="fa-solid fa-gear" />
          </button>
        </div>
      )}

      {/* Settings Modal */}
      {showAbout && (
        <AboutModal onClose={() => setShowAbout(false)} />
      )}
      {showSettings && (
        <SettingsModal onClose={() => setShowSettings(false)} />
      )}

      {/* Dashboard Panel - now self-contained with internal wizard */}
      {showDashboard && (
        <DashboardContainer
          mode="floating"
          onClose={() => setShowDashboard(false)}
          onWizardComplete={handleWizardComplete}
          onWizardCancel={() => deleteAll()}
          onViewResults={(modelId) => {
            setShowDashboard(false);
            setReviewModelId(modelId);
          }}
          onAddToMap={handleModelCardAddToMap}
          onAddGeoJsonToMap={handleAddToMap}
          onAddRasterToMap={handleAddRasterToMap}
        />
      )}

      {/* Model Setup Wizard */}
      {showWizard && (
        <>
          <ModelSetupWizard
            onComplete={handleWizardComplete}
            onCancel={handleWizardCancel}
          />

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

      {/* Map tools (visible when wizard is closed).
       * Drawing is intentionally NOT here: the free-draw toolbar wrote geometry
       * to DrawContext but had no downstream binding to a model run, so users
       * drew shapes that "did nothing" (#285). Drawing only lives inside the
       * wizard now (see `bottom-left` mount above). */}
      {!showWizard && (
        <>
          <LayerPanel position="top-right" />
          <MapInfoControl />
          <MapContextMenu />
          <RasterLegend />
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

  // Register service worker once on mount for push notification support
  useEffect(() => {
    void registerServiceWorker();
  }, []);

  // Create the openNomad API adapter (memoized to prevent re-creation)
  const openNomadAdapter = useMemo(() => createDefaultAdapter(), []);

  const handleEnter = useCallback(() => {
    setShowSplash(false);
  }, []);

  return (
    <DeploymentModeProvider>
      <OpenNomadProvider adapter={openNomadAdapter}>
        <div style={{ width: '100vw', height: '100vh' }}>
          {showSplash && <SplashScreen onEnter={handleEnter} />}
          {!showSplash && <ContentSplashGate />}
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
      </OpenNomadProvider>
    </DeploymentModeProvider>
  );
}

export default App;
