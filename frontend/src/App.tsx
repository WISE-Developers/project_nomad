import {
  MapProvider,
  MapContainer,
  DrawingToolbar,
  LayerPanel,
  BasemapSwitcher,
  MeasurementTool,
  TerrainControl,
} from './features/Map';

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
          <DrawingToolbar position="top-left" />
          <MeasurementTool position="bottom-left" />
          <LayerPanel position="top-right" />
          <BasemapSwitcher position="bottom-right" />
          <TerrainControl position="top-right" />
        </MapContainer>
      </MapProvider>
    </div>
  );
}

export default App;
