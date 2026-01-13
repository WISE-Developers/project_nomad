/**
 * Dashboard Container Component
 *
 * Main container for the Dashboard feature with white-label customization support.
 * Supports both floating (SAN mode) and embedded (ACN mode) display.
 *
 * @module features/Dashboard/components
 */

import { useState, useCallback, useMemo, type CSSProperties } from 'react';
import { Rnd } from 'react-rnd';
import { DashboardProvider, useDashboardTabs, useDashboardView, type DashboardTab } from '../context/DashboardContext.js';
import { ModelList } from './ModelList.js';
import { DraftsDashboard } from './DraftsDashboard.js';
import { StatusMonitor } from './StatusMonitor.js';
import { ModelSetupWizard, type ModelSetupData } from '../../ModelSetup/index.js';
import { ModelReviewPanel } from '../../ModelReview/index.js';
import type { Model } from '../../../openNomad/api.js';
import {
  NomadProvider,
  useNomadCustomizationOptional,
  useNomadLabels,
  useNomadFeatures,
  ActionsContainer,
  SlotRenderer,
  type NomadConfig,
  type NomadTheme,
  type NomadLabels as NomadLabelsType,
  type NomadAction,
  type NomadSlots,
  type NomadFeatures as NomadFeaturesType,
} from '../../../openNomad/customization/index.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Display mode for the dashboard
 */
export type DashboardMode = 'floating' | 'embedded';

/**
 * Props for DashboardContainer with white-label customization support.
 */
export interface DashboardContainerProps {
  /** Display mode: floating (SAN) or embedded (ACN) */
  mode?: DashboardMode;
  /** Called when close button is clicked (floating mode only) */
  onClose?: () => void;
  /**
   * Called when wizard completes with model setup data.
   * This is where consuming apps handle model submission (API calls, notifications, etc.)
   * If not provided, the wizard will just return to dashboard on completion.
   */
  onWizardComplete?: (data: ModelSetupData) => void | Promise<void>;
  /** Called when wizard is cancelled (optional, for cleanup) */
  onWizardCancel?: () => void;
  /**
   * @deprecated Use internal view navigation instead. Dashboard now manages wizard internally.
   * Called when user wants to launch the model wizard (legacy callback pattern)
   */
  onLaunchWizard?: (draftId?: string) => void;
  /** Called when user wants to view model results */
  onViewResults?: (modelId: string) => void;
  /** Called when user wants to add a result to the map */
  onAddToMap?: (modelId: string) => void;
  /** Initial tab to show */
  initialTab?: DashboardTab;
  /** CSS class for container */
  className?: string;

  // ==========================================================================
  // White-Label Customization Props
  // ==========================================================================

  /**
   * Dashboard title (shortcut for labels.title).
   * @example "Agency Fire Modeling"
   */
  title?: string;

  /**
   * Theme CSS custom properties for colors, fonts, spacing, etc.
   * @example { '--nomad-primary': '#003366', '--nomad-font-family': 'Inter, sans-serif' }
   */
  theme?: NomadTheme;

  /**
   * Text labels for i18n and agency branding.
   * @example { tabs: { models: 'Simulations' }, buttons: { newModel: 'New Simulation' } }
   */
  labels?: NomadLabelsType;

  /**
   * Custom action buttons with placement control.
   * @example [{ id: 'export', label: 'Export', placement: 'toolbar', onClick: handleExport }]
   */
  actions?: NomadAction[];

  /**
   * Component extension slots using render props pattern.
   * @example { toolbar: (defaults) => <>{defaults}<AgencyTools /></> }
   */
  slots?: NomadSlots;

  /**
   * Feature flags to show/hide capabilities.
   * @example { export: true, compare: false, drafts: true }
   */
  features?: NomadFeaturesType;
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
  const labels = useNomadLabels();
  const features = useNomadFeatures();
  const { theme } = useNomadCustomizationOptional();

  // Build tabs based on features
  const tabs: { id: DashboardTab; label: string; badge?: number; enabled: boolean }[] = [
    { id: 'models', label: labels.tabs.models, enabled: true },
    { id: 'drafts', label: labels.tabs.drafts, enabled: features.drafts },
    { id: 'jobs', label: labels.tabs.jobs, badge: jobCount > 0 ? jobCount : undefined, enabled: features.jobs },
  ];

  const visibleTabs = tabs.filter(tab => tab.enabled);

  // Dynamic styles using theme variables
  const tabButtonDynamic: CSSProperties = {
    ...tabButtonStyle,
    fontFamily: theme['--nomad-font-family'],
    fontSize: theme['--nomad-font-size-base'],
    color: theme['--nomad-text-secondary'],
  };

  const activeTabDynamic: CSSProperties = {
    color: theme['--nomad-primary'],
    borderBottomColor: theme['--nomad-primary'],
  };

  return (
    <SlotRenderer name="toolbar">
      <div
        style={{
          ...tabContainerStyle,
          backgroundColor: theme['--nomad-header-bg'],
          borderBottomColor: theme['--nomad-border-color'],
        }}
      >
        {visibleTabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            style={{
              ...tabButtonDynamic,
              ...(activeTab === tab.id ? activeTabDynamic : {}),
            }}
            aria-selected={activeTab === tab.id}
            role="tab"
          >
            {tab.label}
            {tab.badge !== undefined && (
              <span style={{
                ...badgeStyle,
                backgroundColor: theme['--nomad-error'],
              }}>
                {tab.badge}
              </span>
            )}
          </button>
        ))}
        {/* Custom toolbar actions */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center' }}>
          <ActionsContainer placement="toolbar" />
        </div>
      </div>
    </SlotRenderer>
  );
}

// =============================================================================
// Dashboard Content Component
// =============================================================================

interface DashboardContentProps {
  onViewResults?: (modelId: string) => void;
  onAddToMap?: (modelId: string) => void;
}

function DashboardContent({
  onViewResults,
  onAddToMap,
}: DashboardContentProps) {
  const { activeTab, setActiveTab } = useDashboardTabs();
  const { showWizard, showResults } = useDashboardView();
  const features = useNomadFeatures();
  const { theme } = useNomadCustomizationOptional();

  // TODO: Get actual job count from useJobs hook
  const jobCount = 0;

  const handleResumeDraft = useCallback((draftId: string) => {
    showWizard(draftId);
  }, [showWizard]);

  const handleCreateNew = useCallback(() => {
    showWizard();
  }, [showWizard]);

  const handleViewModel = useCallback((model: Model) => {
    // Use internal results view if no external handler
    if (onViewResults) {
      onViewResults(model.id);
    } else {
      showResults(model.id);
    }
  }, [onViewResults, showResults]);

  return (
    <div style={{
      ...contentContainerStyle,
      backgroundColor: theme['--nomad-background'],
    }}>
      <TabNavigation
        activeTab={activeTab}
        onTabChange={setActiveTab}
        jobCount={jobCount}
      />

      <div style={tabContentStyle}>
        {activeTab === 'models' && (
          <SlotRenderer name="modelListPanel">
            <ModelList
              onViewResults={handleViewModel}
              onAddToMap={features.addToMap && onAddToMap ? (model) => onAddToMap(model.id) : undefined}
              onCreateNew={handleCreateNew}
            />
          </SlotRenderer>
        )}
        {activeTab === 'drafts' && features.drafts && (
          <SlotRenderer name="draftsPanel">
            <DraftsDashboard
              onResume={handleResumeDraft}
              onCreateNew={handleCreateNew}
            />
          </SlotRenderer>
        )}
        {activeTab === 'jobs' && features.jobs && (
          <SlotRenderer name="jobsPanel">
            <StatusMonitor />
          </SlotRenderer>
        )}
      </div>

      {/* Footer slot */}
      <SlotRenderer name="footer">
        <></>
      </SlotRenderer>
    </div>
  );
}

// =============================================================================
// Floating Dashboard
// =============================================================================

interface FloatingDashboardProps extends DashboardContentProps {
  onClose?: () => void;
  onWizardComplete?: (data: ModelSetupData) => void | Promise<void>;
  onWizardCancel?: () => void;
  className?: string;
}

function FloatingDashboard({
  onClose,
  onWizardComplete,
  onWizardCancel,
  onViewResults,
  onAddToMap,
  className = '',
}: FloatingDashboardProps) {
  const [size, setSize] = useState({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT });
  const { activeView, wizardDraftId, resultsModelId, showDashboard } = useDashboardView();
  const labels = useNomadLabels();
  const { theme } = useNomadCustomizationOptional();

  // Calculate initial position (right side of screen)
  const [initialX] = useState(() => Math.max(20, window.innerWidth - DEFAULT_WIDTH - 40));
  const [initialY] = useState(() => 70);

  // Handle wizard completion
  const handleWizardComplete = useCallback(async (data: ModelSetupData) => {
    if (onWizardComplete) {
      await onWizardComplete(data);
    }
    showDashboard();
  }, [onWizardComplete, showDashboard]);

  // Handle wizard cancellation
  const handleWizardCancel = useCallback(() => {
    onWizardCancel?.();
    showDashboard();
  }, [onWizardCancel, showDashboard]);

  // When showing wizard, render it instead of the dashboard panel
  if (activeView === 'wizard') {
    return (
      <ModelSetupWizard
        onComplete={handleWizardComplete}
        onCancel={handleWizardCancel}
        draftId={wizardDraftId ?? undefined}
      />
    );
  }

  // When showing results, render the review panel
  if (activeView === 'results' && resultsModelId) {
    return (
      <ModelReviewPanel
        modelId={resultsModelId}
        onClose={showDashboard}
      />
    );
  }

  // Dynamic panel styles using theme
  const panelDynamic: CSSProperties = {
    ...panelStyle,
    width: size.width,
    height: size.height,
    backgroundColor: theme['--nomad-surface'],
    borderRadius: theme['--nomad-border-radius'],
    boxShadow: theme['--nomad-shadow'],
    fontFamily: theme['--nomad-font-family'],
  };

  const headerDynamic: CSSProperties = {
    ...headerStyle,
    backgroundColor: theme['--nomad-header-bg'],
    borderBottomColor: theme['--nomad-border-color'],
  };

  const titleDynamic: CSSProperties = {
    ...titleStyle,
    color: theme['--nomad-text-primary'],
    fontSize: theme['--nomad-font-size-lg'],
  };

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
      <div style={panelDynamic} className={`dashboard-panel ${className}`}>
        {/* Header - Drag Handle */}
        <SlotRenderer name="header">
          <div style={headerDynamic} className="dashboard-drag-handle">
            <h2 style={titleDynamic}>{labels.title}</h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <ActionsContainer placement="header" />
              <span style={{
                ...dragHintStyle,
                color: theme['--nomad-text-disabled'],
              }}>
                {labels.tooltips.dragToMove}
              </span>
              <button
                style={{
                  ...closeButtonStyle,
                  color: theme['--nomad-text-secondary'],
                }}
                onClick={onClose}
                aria-label={labels.tooltips.closeDashboard}
              >
                &times;
              </button>
            </div>
          </div>
        </SlotRenderer>

        {/* Content */}
        <DashboardContent
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
  onWizardComplete?: (data: ModelSetupData) => void | Promise<void>;
  onWizardCancel?: () => void;
  className?: string;
}

function EmbeddedDashboard({
  onWizardComplete,
  onWizardCancel,
  onViewResults,
  onAddToMap,
  className = '',
}: EmbeddedDashboardProps) {
  const { activeView, wizardDraftId, resultsModelId, showDashboard } = useDashboardView();
  const labels = useNomadLabels();
  const { theme } = useNomadCustomizationOptional();

  // Handle wizard completion
  const handleWizardComplete = useCallback(async (data: ModelSetupData) => {
    if (onWizardComplete) {
      await onWizardComplete(data);
    }
    showDashboard();
  }, [onWizardComplete, showDashboard]);

  // Handle wizard cancellation
  const handleWizardCancel = useCallback(() => {
    onWizardCancel?.();
    showDashboard();
  }, [onWizardCancel, showDashboard]);

  // When showing wizard, render it instead of the dashboard
  if (activeView === 'wizard') {
    return (
      <ModelSetupWizard
        onComplete={handleWizardComplete}
        onCancel={handleWizardCancel}
        draftId={wizardDraftId ?? undefined}
      />
    );
  }

  // When showing results, render the review panel
  if (activeView === 'results' && resultsModelId) {
    return (
      <ModelReviewPanel
        modelId={resultsModelId}
        onClose={showDashboard}
      />
    );
  }

  // Dynamic styles using theme
  const containerDynamic: CSSProperties = {
    ...embeddedContainerStyle,
    backgroundColor: theme['--nomad-surface'],
    borderColor: theme['--nomad-border-color'],
    borderRadius: theme['--nomad-border-radius-sm'],
    fontFamily: theme['--nomad-font-family'],
  };

  const headerDynamic: CSSProperties = {
    ...embeddedHeaderStyle,
    backgroundColor: theme['--nomad-header-bg'],
    borderBottomColor: theme['--nomad-border-color'],
  };

  const titleDynamic: CSSProperties = {
    ...titleStyle,
    color: theme['--nomad-text-primary'],
    fontSize: theme['--nomad-font-size-lg'],
  };

  return (
    <div style={containerDynamic} className={`dashboard-embedded ${className}`}>
      <SlotRenderer name="header">
        <div style={headerDynamic}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h2 style={titleDynamic}>{labels.title}</h2>
            <ActionsContainer placement="header" />
          </div>
        </div>
      </SlotRenderer>
      <DashboardContent
        onViewResults={onViewResults}
        onAddToMap={onAddToMap}
      />
    </div>
  );
}

// =============================================================================
// Inner Dashboard Component (wraps with DashboardProvider)
// =============================================================================

interface InnerDashboardProps extends DashboardContainerProps {
  // All props from DashboardContainerProps
}

function InnerDashboard({
  mode = 'floating',
  onClose,
  onWizardComplete,
  onWizardCancel,
  onLaunchWizard: _onLaunchWizard, // Deprecated, kept for backwards compatibility
  onViewResults,
  onAddToMap,
  initialTab = 'models',
  className,
}: InnerDashboardProps) {
  // Initial state for context
  const initialState = useMemo(() => ({ activeTab: initialTab }), [initialTab]);

  return (
    <DashboardProvider initialState={initialState}>
      {mode === 'floating' ? (
        <FloatingDashboard
          onClose={onClose}
          onWizardComplete={onWizardComplete}
          onWizardCancel={onWizardCancel}
          onViewResults={onViewResults}
          onAddToMap={onAddToMap}
          className={className}
        />
      ) : (
        <EmbeddedDashboard
          onWizardComplete={onWizardComplete}
          onWizardCancel={onWizardCancel}
          onViewResults={onViewResults}
          onAddToMap={onAddToMap}
          className={className}
        />
      )}
    </DashboardProvider>
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
 * The Dashboard is self-contained - clicking "New Model" opens the wizard internally.
 * No external wizard wiring required.
 *
 * ## White-Label Customization
 *
 * The component supports full customization via props or NomadProvider:
 * - **theme**: CSS custom properties for colors, fonts, spacing
 * - **labels**: Text labels for i18n and agency branding
 * - **actions**: Custom action buttons with placement control
 * - **slots**: Component extension points using render props
 * - **features**: Feature flags to show/hide capabilities
 *
 * @example Floating mode (SAN) - self-contained
 * ```tsx
 * <DashboardContainer
 *   mode="floating"
 *   onClose={() => setShowDashboard(false)}
 *   onWizardComplete={async (data) => {
 *     await runModel(data);
 *   }}
 * />
 * ```
 *
 * @example Embedded mode (ACN) - minimal integration
 * ```tsx
 * <DashboardContainer
 *   mode="embedded"
 *   onWizardComplete={handleModelSubmission}
 * />
 * ```
 *
 * @example With white-label customization via props
 * ```tsx
 * <DashboardContainer
 *   mode="embedded"
 *   title="Agency Fire Modeling"
 *   theme={{ '--nomad-primary': '#003366' }}
 *   labels={{ tabs: { models: 'Simulations' } }}
 *   actions={[{ id: 'export', label: 'Export', placement: 'toolbar', onClick: handleExport }]}
 *   features={{ export: true, compare: false }}
 * />
 * ```
 *
 * @example With white-label customization via NomadProvider
 * ```tsx
 * const agencyConfig: NomadConfig = {
 *   title: 'Agency Fire Modeling',
 *   theme: { '--nomad-primary': '#003366' },
 *   labels: { tabs: { models: 'Simulations' } },
 * };
 *
 * <NomadProvider config={agencyConfig}>
 *   <DashboardContainer mode="embedded" />
 * </NomadProvider>
 * ```
 */
export function DashboardContainer({
  // Customization props
  title,
  theme,
  labels,
  actions,
  slots,
  features,
  // Functional props
  ...props
}: DashboardContainerProps) {
  // Check if customization props are provided
  const hasCustomization = title || theme || labels || actions || slots || features;

  // Build config from props
  const config = useMemo<NomadConfig | undefined>(() => {
    if (!hasCustomization) return undefined;
    return {
      title,
      theme,
      labels,
      actions,
      slots,
      features,
    };
  }, [hasCustomization, title, theme, labels, actions, slots, features]);

  // If customization props provided, wrap with NomadProvider
  // Otherwise, allow parent NomadProvider to provide context (or use defaults)
  if (config) {
    return (
      <NomadProvider config={config}>
        <InnerDashboard {...props} />
      </NomadProvider>
    );
  }

  // No customization props - use any parent provider or defaults
  return <InnerDashboard {...props} />;
}

// =============================================================================
// Styles (base styles - theme overrides applied dynamically)
// =============================================================================

const panelStyle: CSSProperties = {
  backgroundColor: 'white',
  borderRadius: '12px',
  boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '12px 16px',
  borderBottom: '1px solid #e0e0e0',
  cursor: 'move',
  userSelect: 'none',
  backgroundColor: '#fafafa',
};

const titleStyle: CSSProperties = {
  fontSize: '16px',
  fontWeight: 600,
  color: '#333',
  margin: 0,
};

const dragHintStyle: CSSProperties = {
  fontSize: '10px',
  color: '#999',
  fontWeight: 'normal',
};

const closeButtonStyle: CSSProperties = {
  padding: '4px 12px',
  fontSize: '24px',
  fontWeight: 300,
  color: '#666',
  backgroundColor: 'transparent',
  border: 'none',
  cursor: 'pointer',
  borderRadius: '4px',
};

const contentContainerStyle: CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};

const tabContainerStyle: CSSProperties = {
  display: 'flex',
  borderBottom: '1px solid #e0e0e0',
  padding: '0 8px',
  backgroundColor: '#fafafa',
};

const tabButtonStyle: CSSProperties = {
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

const badgeStyle: CSSProperties = {
  backgroundColor: '#f44336',
  color: 'white',
  fontSize: '11px',
  fontWeight: 600,
  padding: '2px 6px',
  borderRadius: '10px',
  minWidth: '18px',
  textAlign: 'center',
};

const tabContentStyle: CSSProperties = {
  flex: 1,
  overflow: 'auto',
};

const embeddedContainerStyle: CSSProperties = {
  backgroundColor: 'white',
  border: '1px solid #e0e0e0',
  borderRadius: '8px',
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  overflow: 'hidden',
};

const embeddedHeaderStyle: CSSProperties = {
  padding: '12px 16px',
  borderBottom: '1px solid #e0e0e0',
  backgroundColor: '#fafafa',
};
