/**
 * ExportPanel Component
 *
 * Single panel for configuring and initiating exports.
 */

import React, { useState, useCallback } from 'react';
import { useExportGeneration } from '../hooks/useExportGeneration';
import type { DeliveryMethod } from '../types';

export interface ExportPanelProps {
  /** Model ID to export from */
  modelId: string;
  /** Model name for display */
  modelName: string;
  /** Available outputs to export */
  outputs: Array<{
    resultId: string;
    name: string;
    format: string;
    type: string;
  }>;
  /** Pre-selected output IDs */
  preSelectedIds?: string[];
  /** Called when panel should close */
  onClose: () => void;
}

// Styles
const panelStyle: React.CSSProperties = {
  padding: '20px',
  backgroundColor: 'white',
  borderRadius: '8px',
  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
  maxWidth: '500px',
  width: '100%',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: '20px',
  paddingBottom: '12px',
  borderBottom: '1px solid #eee',
};

const titleStyle: React.CSSProperties = {
  fontSize: '18px',
  fontWeight: 'bold',
  color: '#333',
  margin: 0,
};

const closeButtonStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  fontSize: '24px',
  cursor: 'pointer',
  color: '#666',
  padding: '0',
  lineHeight: 1,
};

const sectionStyle: React.CSSProperties = {
  marginBottom: '20px',
};

const labelStyle: React.CSSProperties = {
  fontSize: '14px',
  fontWeight: 'bold',
  color: '#333',
  marginBottom: '8px',
  display: 'block',
};

const checkboxListStyle: React.CSSProperties = {
  maxHeight: '200px',
  overflowY: 'auto',
  border: '1px solid #ddd',
  borderRadius: '4px',
  padding: '8px',
};

const checkboxItemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  padding: '8px',
  borderRadius: '4px',
  cursor: 'pointer',
};

const deliveryToggleStyle: React.CSSProperties = {
  display: 'flex',
  gap: '8px',
};

const toggleButtonStyle: React.CSSProperties = {
  flex: 1,
  padding: '10px',
  border: '2px solid #ddd',
  borderRadius: '6px',
  backgroundColor: 'white',
  cursor: 'pointer',
  fontSize: '14px',
  transition: 'all 0.2s',
};

const toggleButtonActiveStyle: React.CSSProperties = {
  ...toggleButtonStyle,
  border: '2px solid #ff6b35',
  backgroundColor: 'rgba(255, 107, 53, 0.1)',
};

const primaryButtonStyle: React.CSSProperties = {
  width: '100%',
  padding: '12px',
  fontSize: '16px',
  fontWeight: 'bold',
  backgroundColor: '#ff6b35',
  color: 'white',
  border: 'none',
  borderRadius: '6px',
  cursor: 'pointer',
};

const disabledButtonStyle: React.CSSProperties = {
  ...primaryButtonStyle,
  backgroundColor: '#ccc',
  cursor: 'not-allowed',
};

const successBoxStyle: React.CSSProperties = {
  padding: '16px',
  backgroundColor: '#e8f5e9',
  borderRadius: '6px',
  textAlign: 'center',
};

const errorBoxStyle: React.CSSProperties = {
  padding: '12px',
  backgroundColor: '#ffebee',
  borderRadius: '4px',
  color: '#c62828',
  fontSize: '14px',
};

const shareUrlStyle: React.CSSProperties = {
  padding: '8px',
  backgroundColor: 'white',
  border: '1px solid #ddd',
  borderRadius: '4px',
  wordBreak: 'break-all',
  fontSize: '12px',
  fontFamily: 'monospace',
};

/**
 * Export Panel component
 */
export function ExportPanel({
  modelId,
  modelName,
  outputs,
  preSelectedIds = [],
  onClose,
}: ExportPanelProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    new Set(preSelectedIds.length > 0 ? preSelectedIds : outputs.map((o) => o.resultId))
  );
  const [delivery, setDelivery] = useState<DeliveryMethod>('download');

  const { state, shareUrl, error, generate, download, reset } = useExportGeneration();

  // Toggle output selection
  const toggleOutput = useCallback((resultId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(resultId)) {
        next.delete(resultId);
      } else {
        next.add(resultId);
      }
      return next;
    });
  }, []);

  // Select all
  const selectAll = useCallback(() => {
    setSelectedIds(new Set(outputs.map((o) => o.resultId)));
  }, [outputs]);

  // Select none
  const selectNone = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  // Handle export
  const handleExport = useCallback(async () => {
    const items = Array.from(selectedIds).map((resultId) => ({ resultId }));

    await generate(
      {
        modelId,
        modelName,
        items,
      },
      delivery
    );

    // Auto-download if download delivery
    if (delivery === 'download') {
      // Slight delay to ensure state is updated
      setTimeout(() => {
        download();
      }, 500);
    }
  }, [selectedIds, modelId, modelName, delivery, generate, download]);

  // Copy share URL to clipboard
  const copyShareUrl = useCallback(() => {
    if (shareUrl) {
      navigator.clipboard.writeText(shareUrl);
    }
  }, [shareUrl]);

  const canExport = selectedIds.size > 0 && state === 'idle';
  const isGenerating = state === 'generating';
  const isComplete = state === 'complete';
  const hasError = state === 'error';

  return (
    <div style={panelStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <h2 style={titleStyle}>Export Results</h2>
        <button style={closeButtonStyle} onClick={onClose} title="Close">
          ×
        </button>
      </div>

      {/* Idle/Generating State */}
      {(state === 'idle' || state === 'generating') && (
        <>
          {/* Output Selection */}
          <div style={sectionStyle}>
            <label style={labelStyle}>
              Select Outputs ({selectedIds.size} of {outputs.length})
            </label>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
              <button
                onClick={selectAll}
                style={{ fontSize: '12px', padding: '4px 8px', cursor: 'pointer' }}
              >
                Select All
              </button>
              <button
                onClick={selectNone}
                style={{ fontSize: '12px', padding: '4px 8px', cursor: 'pointer' }}
              >
                Select None
              </button>
            </div>
            <div style={checkboxListStyle}>
              {outputs.map((output) => (
                <label
                  key={output.resultId}
                  style={{
                    ...checkboxItemStyle,
                    backgroundColor: selectedIds.has(output.resultId) ? '#fff8f5' : 'transparent',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.has(output.resultId)}
                    onChange={() => toggleOutput(output.resultId)}
                    style={{ marginRight: '8px' }}
                  />
                  <span style={{ flex: 1, color: '#333' }}>{output.name}</span>
                  <span style={{ fontSize: '12px', color: '#888' }}>
                    {output.format.toUpperCase()}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Delivery Method */}
          <div style={sectionStyle}>
            <label style={labelStyle}>Delivery Method</label>
            <div style={deliveryToggleStyle}>
              <button
                style={delivery === 'download' ? toggleButtonActiveStyle : toggleButtonStyle}
                onClick={() => setDelivery('download')}
              >
                📥 Download ZIP
              </button>
              <button
                style={delivery === 'share' ? toggleButtonActiveStyle : toggleButtonStyle}
                onClick={() => setDelivery('share')}
              >
                🔗 Get Share Link
              </button>
            </div>
          </div>

          {/* Export Button */}
          <button
            style={canExport ? primaryButtonStyle : disabledButtonStyle}
            onClick={handleExport}
            disabled={!canExport || isGenerating}
          >
            {isGenerating ? 'Generating...' : 'Export'}
          </button>
        </>
      )}

      {/* Complete State */}
      {isComplete && (
        <div style={successBoxStyle}>
          <div style={{ fontSize: '48px', marginBottom: '12px' }}>✓</div>
          <div style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '12px', color: '#333' }}>
            Export Ready!
          </div>

          {delivery === 'download' && (
            <>
              <p style={{ fontSize: '14px', color: '#666', marginBottom: '16px' }}>
                Your download should start automatically.
              </p>
              <button style={primaryButtonStyle} onClick={download}>
                Download Again
              </button>
            </>
          )}

          {delivery === 'share' && shareUrl && (
            <>
              <p style={{ fontSize: '14px', color: '#666', marginBottom: '12px' }}>
                Share this link (expires in 24 hours):
              </p>
              <div style={shareUrlStyle}>{shareUrl}</div>
              <button
                style={{ ...primaryButtonStyle, marginTop: '12px' }}
                onClick={copyShareUrl}
              >
                Copy Link
              </button>
            </>
          )}

          <button
            style={{
              ...primaryButtonStyle,
              marginTop: '12px',
              backgroundColor: 'transparent',
              color: '#ff6b35',
              border: '2px solid #ff6b35',
            }}
            onClick={reset}
          >
            Export More
          </button>
        </div>
      )}

      {/* Error State */}
      {hasError && (
        <>
          <div style={errorBoxStyle}>{error || 'Export failed'}</div>
          <button style={{ ...primaryButtonStyle, marginTop: '12px' }} onClick={reset}>
            Try Again
          </button>
        </>
      )}
    </div>
  );
}
