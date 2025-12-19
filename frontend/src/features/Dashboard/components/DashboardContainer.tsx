/**
 * Dashboard Container Component
 *
 * Main container for the Dashboard feature.
 * Supports both floating (SAN mode) and embedded (ACN mode) display.
 *
 * @module features/Dashboard/components
 */

import React, { useState, useCallback, useMemo } from 'react';
import { Rnd } from 'react-rnd';
import { DashboardProvider, useDashboardTabs, type DashboardTab } from '../context/DashboardContext.js';
import { ModelList } from './ModelList.js';
import { DraftsDashboard } from './DraftsDashboard.js';
import { StatusMonitor } from './StatusMonitor.js';
import type { Model } from '../../../openNomad/api.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Display mode for the dashboard
 */
export type DashboardMode = 'floating' | 'embedded';

/**
 * Props for DashboardContainer
 */
export interface DashboardContainerProps {
  /** Display mode: floating (SAN) or embedded (ACN) */
  mode?: DashboardMode;
  /** Called when close button is clicked (floating mode only) */
  onClose?: () => void;
  /** Called when user wants to launch the model wizard */
  onLaunchWizard?: (draftId?: string) => void;
  /** Called when user wants to view model results */
  onViewResults?: (modelId: string) => void;
  /** Called when user wants to add a result to the map */
  onAddToMap?: (modelId: string) => void;
  /** Initial tab to show */
  initialTab?: DashboardTab;
  /** CSS class for container */
  className?: string;
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_WIDTH = 500;
const DEFAULT_HEIGHT = 600;
const MIN_WIDTH = 380;
const MIN_HEIGHT = 400;

// =============================================================================
// Tab Navigation Component
// =============================================================================

interface TabNavigationProps {
  activeTab: DashboardTab;
  onTabChange: (tab: DashboardTab) => void;
  jobCount?: number;
}

function TabNavigation({ activeTab, onTabChange, jobCount = 0 }: TabNavigationProps) {
  const tabs: { id: DashboardTab; label: string; badge?: number }[] = [
    { id: 'models', label: 'Models' },
    { id: 'drafts', label: 'Drafts' },
    { id: 'jobs', label: 'Active Jobs', badge: jobCount > 0 ? jobCount : undefined },
  ];

  return (
    <div style={tabContainerStyle}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          style={{
            ...tabButtonStyle,
            ...(activeTab === tab.id ? activeTabStyle : {}),
          }}
          aria-selected={activeTab === tab.id}
          role="tab"
        >
          {tab.label}
          {tab.badge !== undefined && (
            <span style={badgeStyle}>{tab.badge}</span>
          )}
        </button>
      ))}
    </div>
  );
}

// =============================================================================
// Dashboard Content Component
// =============================================================================

interface DashboardContentProps {
  onLaunchWizard?: (draftId?: string) => void;
  onViewResults?: (modelId: string) => void;
  onAddToMap?: (modelId: string) => void;
}

function DashboardContent({
  onLaunchWizard,
  onViewResults,
  onAddToMap,
}: DashboardContentProps) {
  const { activeTab, setActiveTab } = useDashboardTabs();

  // TODO: Get actual job count from useJobs hook
  const jobCount = 0;

  const handleResumeDraft = useCallback((draftId: string) => {
    onLaunchWizard?.(draftId);
  }, [onLaunchWizard]);

  const handleCreateNew = useCallback(() => {
    onLaunchWizard?.();
  }, [onLaunchWizard]);

  const handleViewModel = useCallback((model: Model) => {
    onViewResults?.(model.id);
  }, [onViewResults]);

  return (
    <div style={contentContainerStyle}>
      <TabNavigation
        activeTab={activeTab}
        onTabChange={setActiveTab}
        jobCount={jobCount}
      />

      <div style={tabContentStyle}>
        {activeTab === 'models' && (
          <ModelList
            onViewResults={handleViewModel}
            onAddToMap={onAddToMap ? (model) => onAddToMap(model.id) : undefined}
            onCreateNew={handleCreateNew}
          />
        )}
        {activeTab === 'drafts' && (
          <DraftsDashboard
            onResume={handleResumeDraft}
            onCreateNew={handleCreateNew}
          />
        )}
        {activeTab === 'jobs' && (
          <StatusMonitor />
        )}
      </div>
    </div>
  );
}

// =============================================================================
// Floating Dashboard
// =============================================================================

interface FloatingDashboardProps extends DashboardContentProps {
  onClose?: () => void;
  className?: string;
}

function FloatingDashboard({
  onClose,
  onLaunchWizard,
  onViewResults,
  onAddToMap,
  className = '',
}: FloatingDashboardProps) {
  const [size, setSize] = useState({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT });

  // Calculate initial position (right side of screen)
  const [initialX] = useState(() => Math.max(20, window.innerWidth - DEFAULT_WIDTH - 40));
  const [initialY] = useState(() => 70);

  return (
    <Rnd
      default={{
        x: initialX,
        y: initialY,
        width: DEFAULT_WIDTH,
        height: DEFAULT_HEIGHT,
      }}
      minWidth={MIN_WIDTH}
      minHeight={MIN_HEIGHT}
      maxHeight={window.innerHeight - 32}
      bounds="parent"
      dragHandleClassName="dashboard-drag-handle"
      style={{ zIndex: 900 }}
      onResize={(_e, _dir, ref) => {
        setSize({
          width: ref.offsetWidth,
          height: ref.offsetHeight,
        });
      }}
      enableResizing={{
        top: false,
        right: true,
        bottom: true,
        left: true,
        topRight: false,
        bottomRight: true,
        bottomLeft: true,
        topLeft: false,
      }}
    >
      <div
        style={{ ...panelStyle, width: size.width, height: size.height }}
        className={`dashboard-panel ${className}`}
      >
        {/* Header - Drag Handle */}
        <div style={headerStyle} className="dashboard-drag-handle">
          <h2 style={titleStyle}>Dashboard</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={dragHintStyle}>drag to move</span>
            <button style={closeButtonStyle} onClick={onClose} aria-label="Close dashboard">
              &times;
            </button>
          </div>
        </div>

        {/* Content */}
        <DashboardContent
          onLaunchWizard={onLaunchWizard}
          onViewResults={onViewResults}
          onAddToMap={onAddToMap}
        />
      </div>
    </Rnd>
  );
}

// =============================================================================
// Embedded Dashboard
// =============================================================================

interface EmbeddedDashboardProps extends DashboardContentProps {
  className?: string;
}

function EmbeddedDashboard({
  onLaunchWizard,
  onViewResults,
  onAddToMap,
  className = '',
}: EmbeddedDashboardProps) {
  return (
    <div style={embeddedContainerStyle} className={`dashboard-embedded ${className}`}>
      <div style={embeddedHeaderStyle}>
        <h2 style={titleStyle}>Dashboard</h2>
      </div>
      <DashboardContent
        onLaunchWizard={onLaunchWizard}
        onViewResults={onViewResults}
        onAddToMap={onAddToMap}
      />
    </div>
  );
}

// =============================================================================
// Main Component
// =============================================================================

/**
 * DashboardContainer is the main entry point for the Dashboard feature.
 *
 * In floating mode (SAN), it renders as a draggable, resizable panel.
 * In embedded mode (ACN), it renders inline for integration into agency UIs.
 *
 * @example Floating mode (SAN)
 * ```tsx
 * <DashboardContainer
 *   mode="floating"
 *   onClose={() => setShowDashboard(false)}
 *   onLaunchWizard={(id) => launchWizard(id)}
 *   onViewResults={(id) => showResults(id)}
 * />
 * ```
 *
 * @example Embedded mode (ACN)
 * ```tsx
 * <DashboardContainer
 *   mode="embedded"
 *   onLaunchWizard={(id) => launchWizard(id)}
 *   onViewResults={(id) => showResults(id)}
 * />
 * ```
 */
export function DashboardContainer({
  mode = 'floating',
  onClose,
  onLaunchWizard,
  onViewResults,
  onAddToMap,
  initialTab = 'models',
  className,
}: DashboardContainerProps) {
  // Initial state for context
  const initialState = useMemo(() => ({ activeTab: initialTab }), [initialTab]);

  return (
    <DashboardProvider initialState={initialState}>
      {mode === 'floating' ? (
        <FloatingDashboard
          onClose={onClose}
          onLaunchWizard={onLaunchWizard}
          onViewResults={onViewResults}
          onAddToMap={onAddToMap}
          className={className}
        />
      ) : (
        <EmbeddedDashboard
          onLaunchWizard={onLaunchWizard}
          onViewResults={onViewResults}
          onAddToMap={onAddToMap}
          className={className}
        />
      )}
    </DashboardProvider>
  );
}

// =============================================================================
// Styles
// =============================================================================

const panelStyle: React.CSSProperties = {
  backgroundColor: 'white',
  borderRadius: '12px',
  boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '12px 16px',
  borderBottom: '1px solid #e0e0e0',
  cursor: 'move',
  userSelect: 'none',
  backgroundColor: '#fafafa',
};

const titleStyle: React.CSSProperties = {
  fontSize: '16px',
  fontWeight: 600,
  color: '#333',
  margin: 0,
};

const dragHintStyle: React.CSSProperties = {
  fontSize: '10px',
  color: '#999',
  fontWeight: 'normal',
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

const contentContainerStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};

const tabContainerStyle: React.CSSProperties = {
  display: 'flex',
  borderBottom: '1px solid #e0e0e0',
  padding: '0 8px',
  backgroundColor: '#fafafa',
};

const tabButtonStyle: React.CSSProperties = {
  padding: '12px 16px',
  fontSize: '14px',
  fontWeight: 500,
  color: '#666',
  backgroundColor: 'transparent',
  border: 'none',
  borderBottom: '2px solid transparent',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  transition: 'all 0.2s ease',
};

const activeTabStyle: React.CSSProperties = {
  color: '#1976d2',
  borderBottomColor: '#1976d2',
};

const badgeStyle: React.CSSProperties = {
  backgroundColor: '#f44336',
  color: 'white',
  fontSize: '11px',
  fontWeight: 600,
  padding: '2px 6px',
  borderRadius: '10px',
  minWidth: '18px',
  textAlign: 'center',
};

const tabContentStyle: React.CSSProperties = {
  flex: 1,
  overflow: 'auto',
};

const embeddedContainerStyle: React.CSSProperties = {
  backgroundColor: 'white',
  border: '1px solid #e0e0e0',
  borderRadius: '8px',
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  overflow: 'hidden',
};

const embeddedHeaderStyle: React.CSSProperties = {
  padding: '12px 16px',
  borderBottom: '1px solid #e0e0e0',
  backgroundColor: '#fafafa',
};
