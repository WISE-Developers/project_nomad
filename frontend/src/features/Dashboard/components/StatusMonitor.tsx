/**
 * Status Monitor Component
 *
 * Displays and monitors active job statuses in the Dashboard.
 *
 * @module features/Dashboard/components
 */

import React, { useCallback } from 'react';
import { useJobs } from '../hooks/useJobs.js';
import type { Job, JobStatus } from '../../../openNomad/api.js';

// =============================================================================
// Types
// =============================================================================

export interface StatusMonitorProps {
  /** Called when user clicks to view job details */
  onViewJob?: (jobId: string) => void;
  /** CSS class */
  className?: string;
}

// =============================================================================
// Helpers
// =============================================================================

function formatDuration(startTime: string | undefined): string {
  if (!startTime) return '--';

  const start = new Date(startTime);
  const now = new Date();
  const diffMs = now.getTime() - start.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffSecs = Math.floor((diffMs % (1000 * 60)) / 1000);

  if (diffMins < 1) return `${diffSecs}s`;
  return `${diffMins}m ${diffSecs}s`;
}

function getStatusColor(status: JobStatus): string {
  switch (status) {
    case 'completed':
      return '#4caf50';
    case 'running':
      return '#2196f3';
    case 'pending':
      return '#ff9800';
    case 'failed':
      return '#f44336';
    case 'cancelled':
      return '#9e9e9e';
    default:
      return '#9e9e9e';
  }
}

function getStatusLabel(status: JobStatus): string {
  switch (status) {
    case 'completed':
      return 'Completed';
    case 'running':
      return 'Running';
    case 'pending':
      return 'Pending';
    case 'failed':
      return 'Failed';
    case 'cancelled':
      return 'Cancelled';
    default:
      return status;
  }
}

// =============================================================================
// Job Card Component
// =============================================================================

interface JobCardProps {
  job: Job;
  onRemove: (jobId: string) => void;
  onView?: (jobId: string) => void;
}

function JobCard({ job, onRemove, onView }: JobCardProps) {
  const statusColor = getStatusColor(job.status);
  const isActive = job.status === 'running' || job.status === 'pending';
  const isComplete = job.status === 'completed';
  const isFailed = job.status === 'failed';

  const handleRemove = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onRemove(job.id);
  }, [job.id, onRemove]);

  const handleView = useCallback(() => {
    onView?.(job.id);
  }, [job.id, onView]);

  return (
    <div
      style={jobCardStyle}
      onClick={onView ? handleView : undefined}
      role={onView ? 'button' : undefined}
    >
      {/* Header */}
      <div style={jobHeaderStyle}>
        <span style={jobIdStyle}>{job.modelId}</span>
        <span
          style={{
            ...statusBadgeStyle,
            backgroundColor: `${statusColor}20`,
            color: statusColor,
          }}
        >
          {job.status === 'running' && <span style={pulseIndicatorStyle} />}
          {getStatusLabel(job.status)}
        </span>
      </div>

      {/* Progress bar */}
      {isActive && (
        <div style={progressContainerStyle}>
          <div
            style={{
              ...progressBarStyle,
              width: `${job.progress}%`,
              backgroundColor: statusColor,
            }}
          />
          <span style={progressTextStyle}>{job.progress}%</span>
        </div>
      )}

      {/* Duration */}
      <div style={jobMetaStyle}>
        {isActive && (
          <span style={durationStyle}>
            Running: {formatDuration(job.startedAt)}
          </span>
        )}
        {isComplete && (
          <span style={successTextStyle}>
            Completed successfully
          </span>
        )}
        {isFailed && job.error && (
          <span style={errorTextStyle}>
            Error: {job.error}
          </span>
        )}
      </div>

      {/* Actions */}
      <div style={jobActionsStyle}>
        {!isActive && (
          <button
            onClick={handleRemove}
            style={removeButtonStyle}
            aria-label="Remove from list"
          >
            Dismiss
          </button>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// Main Component
// =============================================================================

/**
 * StatusMonitor displays all active jobs and their progress.
 *
 * @example
 * ```tsx
 * <StatusMonitor onViewJob={(id) => showJobDetails(id)} />
 * ```
 */
export function StatusMonitor({
  onViewJob,
  className = '',
}: StatusMonitorProps) {
  const {
    jobs,
    runningCount,
    pendingCount,
    removeJob,
  } = useJobs({ autoSubscribeRunning: true });

  const activeCount = runningCount + pendingCount;
  const completedJobs = jobs.filter(j => j.status === 'completed' || j.status === 'failed' || j.status === 'cancelled');
  const activeJobs = jobs.filter(j => j.status === 'running' || j.status === 'pending');

  const handleRemove = useCallback((jobId: string) => {
    removeJob(jobId);
  }, [removeJob]);

  const handleClearCompleted = useCallback(() => {
    completedJobs.forEach(job => removeJob(job.id));
  }, [completedJobs, removeJob]);

  return (
    <div style={containerStyle} className={`status-monitor ${className}`}>
      {/* Header */}
      <div style={headerStyle}>
        <div style={headerLeftStyle}>
          <span style={countStyle}>
            {activeCount > 0 ? (
              <>{activeCount} active job{activeCount !== 1 ? 's' : ''}</>
            ) : (
              'No active jobs'
            )}
          </span>
        </div>
        {completedJobs.length > 0 && (
          <button onClick={handleClearCompleted} style={clearButtonStyle}>
            Clear completed
          </button>
        )}
      </div>

      {/* Empty state */}
      {jobs.length === 0 && (
        <div style={emptyStyle}>
          <div style={emptyIconStyle}>
            <i className="fa-solid fa-check-circle" />
          </div>
          <h3 style={emptyTitleStyle}>All Caught Up</h3>
          <p style={emptyTextStyle}>
            No jobs are currently running.
            <br />
            Start a new model to see progress here.
          </p>
        </div>
      )}

      {/* Active jobs */}
      {activeJobs.length > 0 && (
        <div style={sectionStyle}>
          <h4 style={sectionTitleStyle}>Active</h4>
          <div style={jobListStyle}>
            {activeJobs.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                onRemove={handleRemove}
                onView={onViewJob}
              />
            ))}
          </div>
        </div>
      )}

      {/* Completed jobs */}
      {completedJobs.length > 0 && (
        <div style={sectionStyle}>
          <h4 style={sectionTitleStyle}>Recent</h4>
          <div style={jobListStyle}>
            {completedJobs.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                onRemove={handleRemove}
                onView={onViewJob}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Styles
// =============================================================================

const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '12px 16px',
  borderBottom: '1px solid #f0f0f0',
  backgroundColor: 'white',
};

const headerLeftStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
};

const countStyle: React.CSSProperties = {
  fontSize: '13px',
  color: '#666',
};

const clearButtonStyle: React.CSSProperties = {
  padding: '6px 12px',
  fontSize: '12px',
  color: '#666',
  backgroundColor: 'white',
  border: '1px solid #e0e0e0',
  borderRadius: '4px',
  cursor: 'pointer',
};

const sectionStyle: React.CSSProperties = {
  padding: '12px 16px',
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: '12px',
  fontWeight: 600,
  color: '#999',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  margin: '0 0 12px 0',
};

const jobListStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
};

const jobCardStyle: React.CSSProperties = {
  padding: '12px',
  backgroundColor: 'white',
  border: '1px solid #e0e0e0',
  borderRadius: '8px',
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
};

const jobHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '12px',
};

const jobIdStyle: React.CSSProperties = {
  fontSize: '13px',
  fontWeight: 500,
  color: '#333',
  fontFamily: 'monospace',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const statusBadgeStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  padding: '3px 8px',
  fontSize: '11px',
  fontWeight: 500,
  borderRadius: '10px',
  whiteSpace: 'nowrap',
};

const pulseIndicatorStyle: React.CSSProperties = {
  width: '6px',
  height: '6px',
  borderRadius: '50%',
  backgroundColor: 'currentColor',
  animation: 'pulse 1.5s infinite',
};

const progressContainerStyle: React.CSSProperties = {
  position: 'relative',
  height: '20px',
  backgroundColor: '#f0f0f0',
  borderRadius: '10px',
  overflow: 'hidden',
};

const progressBarStyle: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  height: '100%',
  borderRadius: '10px',
  transition: 'width 0.3s ease',
};

const progressTextStyle: React.CSSProperties = {
  position: 'absolute',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  fontSize: '11px',
  fontWeight: 600,
  color: '#333',
};

const jobMetaStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
};

const durationStyle: React.CSSProperties = {
  fontSize: '12px',
  color: '#888',
};

const successTextStyle: React.CSSProperties = {
  fontSize: '12px',
  color: '#4caf50',
};

const errorTextStyle: React.CSSProperties = {
  fontSize: '12px',
  color: '#d32f2f',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const jobActionsStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
};

const removeButtonStyle: React.CSSProperties = {
  padding: '4px 10px',
  fontSize: '11px',
  color: '#666',
  backgroundColor: 'transparent',
  border: '1px solid #e0e0e0',
  borderRadius: '4px',
  cursor: 'pointer',
};

const emptyStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '48px 24px',
  textAlign: 'center',
};

const emptyIconStyle: React.CSSProperties = {
  fontSize: '48px',
  color: '#4caf50',
  marginBottom: '16px',
};

const emptyTitleStyle: React.CSSProperties = {
  fontSize: '18px',
  fontWeight: 600,
  color: '#333',
  margin: '0 0 8px 0',
};

const emptyTextStyle: React.CSSProperties = {
  fontSize: '14px',
  color: '#666',
  margin: 0,
  lineHeight: 1.5,
};
