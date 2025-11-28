import { useState, useCallback } from 'react';
import {
  MapProvider,
  MapContainer,
  DrawingToolbar,
  LayerPanel,
  BasemapSwitcher,
  MeasurementTool,
  TerrainControl,
  DrawProvider,
} from './features/Map';
import { ModelSetupWizard } from './features/ModelSetup';
import type { ModelSetupData } from './features/ModelSetup';

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

function App() {
  const [showWizard, setShowWizard] = useState(false);

  const handleNewModel = useCallback(() => {
    setShowWizard(true);
  }, []);

  const handleWizardComplete = useCallback((data: ModelSetupData) => {
    console.log('Model setup complete:', data);
    // TODO: In Phase 6, submit to backend API
    alert(`Model setup complete!\n\nEngine: ${data.model.engine}\nRun Type: ${data.model.runType}\nDuration: ${data.temporal.durationHours} hours`);
    setShowWizard(false);
  }, []);

  const handleWizardCancel = useCallback(() => {
    setShowWizard(false);
  }, []);

  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <MapProvider>
        <MapContainer
          options={{
            center: [-115.5, 54.5], // Alberta
            zoom: 6,
          }}
        >
          <DrawProvider>
            {/* New Model button */}
            {!showWizard && (
              <button style={newModelButtonStyle} onClick={handleNewModel}>
                🔥 New Fire Model
              </button>
            )}

            {/* Model Setup Wizard */}
            {showWizard && (
              <ModelSetupWizard
                onComplete={handleWizardComplete}
                onCancel={handleWizardCancel}
              />
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
          </DrawProvider>
        </MapContainer>
      </MapProvider>
    </div>
  );
}

export default App;
