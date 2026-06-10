/**
 * MapCapture Component
 *
 * Captures the current map view as a composite image with legend and metadata.
 * Opens in a new tab with Download PDF, Download PNG, and Print options.
 */

import { useCallback } from 'react';
import { useMap } from '../context/MapContext';
import { useLayers } from '../context/LayerContext';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { PROBABILITY_LEGEND } from '../symbology/palettes';

/**
 * Try to get current model info from the page for metadata.
 */

function getModelMetadata(): Record<string, string> {
  const meta: Record<string, string> = {};
  const username = localStorage.getItem('nomad_username');
  if (username) meta['User'] = username;

  // Read model info stored by ModelReviewPanel
  try {
    const stored = localStorage.getItem('nomad_capture_model');
    if (stored) {
      const model = JSON.parse(stored);
      if (model.modelName) meta['Model'] = model.modelName;
      if (model.engineType) meta['Engine'] = model.engineType.toUpperCase();
      if (model.outputMode) meta['Mode'] = model.outputMode === 'deterministic' ? 'Deterministic' : 'Probabilistic';
      if (model.modelId) meta['Run ID'] = model.modelId;
      if (model.userId) meta['User'] = model.userId;
      if (model.notes) meta['Notes'] = model.notes;
    }
  } catch { /* no model context */ }

  return meta;
}

export function MapCapture() {
  const { map, isLoaded } = useMap();
  const { state: layerState } = useLayers();

  const captureMap = useCallback(async () => {
    if (!map || !isLoaded) return;

    // Wait for rendering
    map.triggerRepaint();
    await new Promise<void>((resolve) => { map.once('idle', () => resolve()); });

    const mapCanvas = map.getCanvas();
    const mapContainer = map.getContainer();

    // Step 1: Capture map canvas
    const mapImgData = mapCanvas.toDataURL('image/png');

    // Step 2: Capture DOM overlays
    const domOverlayCanvas = await html2canvas(mapContainer, {
      backgroundColor: null,
      ignoreElements: (el) => {
        if (el.tagName === 'CANVAS') return true;
        if (el.classList?.contains('maplibregl-ctrl')) return true;
        if (el.classList?.contains('drawing-toolbar')) return true;
        if (el.classList?.contains('layer-panel')) return true;
        if (el.classList?.contains('layer-panel-toggle')) return true;
        return false;
      },
      logging: false,
      useCORS: true,
      scale: window.devicePixelRatio || 1,
    });

    // Step 3: Composite
    const compositeCanvas = document.createElement('canvas');
    compositeCanvas.width = mapCanvas.width;
    compositeCanvas.height = mapCanvas.height;
    const compCtx = compositeCanvas.getContext('2d')!;

    const mapImg = new Image();
    mapImg.src = mapImgData;
    await new Promise((r) => { mapImg.onload = r; });
    compCtx.drawImage(mapImg, 0, 0);
    compCtx.drawImage(domOverlayCanvas, 0, 0, domOverlayCanvas.width, domOverlayCanvas.height, 0, 0, mapCanvas.width, mapCanvas.height);

    // Step 4: Build legend data from visible layers
    const legendItems: { color: string; label: string }[] = [];
    let hasRaster = false;
    for (const layer of layerState.layers) {
      if (!layer.visible) continue;
      if (layer.type === 'geojson') {
        const cfg = layer as { fillColor?: string; name: string };
        legendItems.push({ color: cfg.fillColor || '#666', label: layer.name });
      }
      if (layer.type === 'raster') hasRaster = true;
    }

    // Step 5: Build final canvas with legend panel + metadata strip
    const dpr = window.devicePixelRatio || 1;
    const border = 5;
    const legendWidth = 280 * dpr;
    const meta = getModelMetadata();
    const metaLines = Object.entries(meta);
    const metaStripHeight = Math.max(80, 20 + metaLines.length * 18) * dpr;
    const hasLegend = legendItems.length > 0 || hasRaster;

    const finalWidth = compositeCanvas.width + border * 2 + (hasLegend ? legendWidth : 0);
    const finalHeight = compositeCanvas.height + border * 2 + metaStripHeight;

    const final = document.createElement('canvas');
    final.width = finalWidth;
    final.height = finalHeight;
    const ctx = final.getContext('2d')!;

    // Background
    ctx.fillStyle = '#1f2937';
    ctx.fillRect(0, 0, finalWidth, finalHeight);

    // Map image
    ctx.drawImage(compositeCanvas, border, border);

    // Legend panel (right side)
    if (hasLegend) {
      const lx = compositeCanvas.width + border * 2;
      const ly = border;
      const lw = legendWidth - border;
      const lh = compositeCanvas.height;

      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.fillRect(lx, ly, lw, lh);

      let yPos = ly + 20 * dpr;
      const fontSize = 12 * dpr;
      const titleFontSize = 14 * dpr;
      const swatchSize = 14 * dpr;
      const padding = 10 * dpr;

      // Title
      ctx.font = `bold ${titleFontSize}px system-ui, sans-serif`;
      ctx.fillStyle = '#333';
      ctx.fillText('Legend', lx + padding, yPos);
      yPos += 22 * dpr;

      // Burn Probability ramp (when raster layers visible)
      if (hasRaster) {
        ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
        ctx.fillStyle = '#555';
        ctx.fillText('Burn Probability', lx + padding, yPos);
        yPos += 16 * dpr;

        ctx.font = `${11 * dpr}px system-ui, sans-serif`;
        for (const entry of PROBABILITY_LEGEND) {
          ctx.fillStyle = entry.color;
          ctx.fillRect(lx + padding, yPos - swatchSize + 3 * dpr, swatchSize, swatchSize);
          ctx.fillStyle = '#333';
          ctx.fillText(entry.label, lx + padding + swatchSize + 6 * dpr, yPos);
          yPos += 16 * dpr;
        }
        yPos += 8 * dpr;
      }

      // Vector legend items (perimeters, ignition)
      if (legendItems.length > 0) {
        ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
        ctx.fillStyle = '#555';
        ctx.fillText('Layers', lx + padding, yPos);
        yPos += 16 * dpr;

        ctx.font = `${fontSize}px system-ui, sans-serif`;
      }
      for (const item of legendItems) {
        // Color swatch (aligned to first line of text)
        ctx.fillStyle = item.color;
        ctx.globalAlpha = 0.5;
        ctx.fillRect(lx + padding, yPos - swatchSize + 3 * dpr, swatchSize, swatchSize);
        ctx.globalAlpha = 1.0;
        ctx.strokeStyle = item.color;
        ctx.lineWidth = 2 * dpr;
        ctx.strokeRect(lx + padding, yPos - swatchSize + 3 * dpr, swatchSize, swatchSize);

        // Word-wrap label
        ctx.fillStyle = '#333';
        const textX = lx + padding + swatchSize + 6 * dpr;
        const maxLabelWidth = lw - padding * 2 - swatchSize - 8 * dpr;
        const words = item.label.split(/(\s+|-)/);
        let line = '';
        for (const word of words) {
          const test = line + word;
          if (ctx.measureText(test).width > maxLabelWidth && line.length > 0) {
            ctx.fillText(line, textX, yPos);
            yPos += 14 * dpr;
            line = word.trim();
          } else {
            line = test;
          }
        }
        if (line) {
          ctx.fillText(line, textX, yPos);
          yPos += 18 * dpr;
        }

        if (yPos > ly + lh - 20 * dpr) break;
      }
    }

    // Step 6: Metadata strip at bottom
    const zoom = map.getZoom();
    const scale = 40075016.686 / (Math.pow(2, zoom) * 256);
    const timestamp = new Date().toLocaleString();

    const stripY = compositeCanvas.height + border * 2;
    const stripFontSize = Math.max(11, Math.min(13, finalWidth / 120)) * dpr;
    const lineHeight = stripFontSize * 1.5;

    ctx.fillStyle = '#1f2937';
    ctx.fillRect(0, stripY, finalWidth, metaStripHeight);

    ctx.font = `${stripFontSize}px system-ui, sans-serif`;
    ctx.fillStyle = '#e5e7eb';

    // Line 1: Scale + timestamp
    const line1 = `Scale 1:${Math.round(scale).toLocaleString()}  •  Project Nomad  •  ${timestamp}`;
    let lineY = stripY + lineHeight;
    ctx.fillText(line1, border + 8 * dpr, lineY);

    // Line 2+: Model metadata
    ctx.fillStyle = '#9ca3af';
    ctx.font = `${stripFontSize * 0.9}px system-ui, sans-serif`;
    const metaStr = metaLines
      .filter(([k]) => k !== 'Notes')
      .map(([k, v]) => `${k}: ${v}`)
      .join('  •  ');
    if (metaStr) {
      lineY += lineHeight;
      ctx.fillText(metaStr, border + 8 * dpr, lineY);
    }

    // Notes on separate line if present
    const notes = meta['Notes'];
    if (notes) {
      lineY += lineHeight;
      ctx.font = `italic ${stripFontSize * 0.85}px system-ui, sans-serif`;
      ctx.fillStyle = '#6b7280';
      const maxNotesWidth = finalWidth - 20 * dpr;
      let noteText = notes;
      while (ctx.measureText(noteText).width > maxNotesWidth && noteText.length > 20) {
        noteText = noteText.slice(0, -4) + '...';
      }
      ctx.fillText(noteText, border + 8 * dpr, lineY);
    }

    // Step 7: Generate outputs
    const imgData = final.toDataURL('image/png');

    const pdf = new jsPDF({
      orientation: 'landscape',
      unit: 'px',
      format: [final.width / dpr, final.height / dpr],
    });
    pdf.addImage(imgData, 'PNG', 0, 0, final.width / dpr, final.height / dpr);
    const pdfData = pdf.output('datauristring');

    const safeName = `NomadMap_${new Date().toISOString().slice(0, 10)}`;

    const newWindow = window.open();
    if (newWindow) {
      newWindow.document.write(`
        <html>
          <head>
            <title>Project Nomad — Map Capture</title>
            <style>
              body { font-family: system-ui, sans-serif; text-align: center; margin: 0; padding: 20px; background: #f5f5f5; }
              img { max-width: 100%; height: auto; box-shadow: 0 4px 20px rgba(0,0,0,0.2); border-radius: 4px; }
              .actions { margin-top: 16px; display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }
              .btn { padding: 10px 20px; font-size: 14px; font-weight: 600; border-radius: 6px; text-decoration: none; cursor: pointer; border: none; display: inline-block; }
              .btn-primary { background: #ff6b35; color: white; }
              .btn-secondary { background: #1f2937; color: white; }
              .hint { margin-top: 12px; color: #666; font-size: 13px; }
              @media print { .actions, .hint { display: none; } body { padding: 0; } img { box-shadow: none; } }
            </style>
          </head>
          <body>
            <img src="${imgData}" alt="Project Nomad Map Capture" />
            <div class="actions">
              <a href="${pdfData}" download="${safeName}.pdf" class="btn btn-primary">Download PDF</a>
              <a href="${imgData}" download="${safeName}.png" class="btn btn-secondary">Download PNG</a>
              <button class="btn btn-secondary" onclick="window.print()">Print</button>
            </div>
            <p class="hint">You can also right-click the image to copy or save it directly.</p>
          </body>
        </html>
      `);
      newWindow.document.close();
    }
  }, [map, isLoaded, layerState]);

  if (!map || !isLoaded) return null;

  return (
    <button
      onClick={captureMap}
      title="Capture map as image"
      style={{
        padding: 'clamp(8px, 2vw, 12px) clamp(12px, 3vw, 24px)',
        fontSize: 'clamp(12px, 2.5vw, 16px)',
        fontWeight: 'bold',
        color: 'white',
        backgroundColor: '#059669',
        border: 'none',
        borderRadius: '8px',
        cursor: 'pointer',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.2)',
        textShadow: '1.5px 1.5px 3px rgba(0, 0, 0, 0.6)',
        whiteSpace: 'nowrap' as const,
      }}
    >
      <i className="fa-solid fa-camera" style={{ marginRight: '8px' }} />Save Map
    </button>
  );
}
