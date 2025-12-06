/**
 * ReviewStep Component
 *
 * Fifth (final) wizard step for reviewing settings and starting the model.
 */

import React, { useCallback } from 'react';
import { useWizardData } from '../../Wizard';
import { ModelSummary } from '../components/ModelSummary';
import type { ModelSetupData } from '../types';

const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '24px',
  padding: '16px',
};

const headerStyle: React.CSSProperties = {
  textAlign: 'center',
  padding: '16px',
  backgroundColor: '#e8f5e9',
  borderRadius: '8px',
  border: '1px solid #c8e6c9',
};

const headerTitleStyle: React.CSSProperties = {
  fontSize: '18px',
  fontWeight: 'bold',
  color: '#2e7d32',
  marginBottom: '8px',
};

const headerDescStyle: React.CSSProperties = {
  fontSize: '14px',
  color: '#558b2f',
};

const notificationsStyle: React.CSSProperties = {
  padding: '16px',
  backgroundColor: '#f8f9fa',
  borderRadius: '8px',
  border: '1px solid #e9ecef',
};

const notificationsTitleStyle: React.CSSProperties = {
  fontSize: '14px',
  fontWeight: 'bold',
  color: '#333',
  marginBottom: '12px',
};

const checkboxRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '8px 0',
};

const checkboxStyle: React.CSSProperties = {
  width: '18px',
  height: '18px',
  cursor: 'pointer',
};

const checkboxLabelStyle: React.CSSProperties = {
  fontSize: '14px',
  cursor: 'pointer',
  color: '#333',
};

const notesStyle: React.CSSProperties = {
  padding: '16px',
  backgroundColor: '#f8f9fa',
  borderRadius: '8px',
  border: '1px solid #e9ecef',
};

const textareaStyle: React.CSSProperties = {
  width: '100%',
  minHeight: '80px',
  padding: '10px',
  fontSize: '14px',
  border: '1px solid #ccc',
  borderRadius: '4px',
  resize: 'vertical',
  boxSizing: 'border-box',
};

const warningStyle: React.CSSProperties = {
  padding: '12px',
  backgroundColor: '#fff3cd',
  borderRadius: '4px',
  borderLeft: '4px solid #ffc107',
  fontSize: '13px',
  color: '#333',
};

/**
 * Review Step component
 */
export function ReviewStep() {
  const { data, setField } = useWizardData<ModelSetupData>();

  const execution = data.execution ?? {
    notifyEmail: false,
    notifyPush: false,
    notes: '',
  };

  // Handle notification toggles
  const handleNotifyEmailChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setField('execution', {
        ...execution,
        notifyEmail: e.target.checked,
      });
    },
    [setField, execution]
  );

  const handleNotifyPushChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setField('execution', {
        ...execution,
        notifyPush: e.target.checked,
      });
    },
    [setField, execution]
  );

  // Handle notes change
  const handleNotesChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setField('execution', {
        ...execution,
        notes: e.target.value,
      });
    },
    [setField, execution]
  );

  return (
    <div style={containerStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <div style={headerTitleStyle}><i className="fa-solid fa-circle-check" style={{ marginRight: '8px' }} />Ready to Run</div>
        <div style={headerDescStyle}>
          Review your model configuration below. Click "Start Model" to begin the simulation.
        </div>
      </div>

      {/* Model Summary */}
      <ModelSummary data={data} />

      {/* Notifications */}
      <div style={notificationsStyle}>
        <div style={notificationsTitleStyle}><i className="fa-solid fa-envelope" style={{ marginRight: '8px' }} />Notification Preferences</div>
        <div style={checkboxRowStyle}>
          <input
            type="checkbox"
            id="notifyEmail"
            checked={execution.notifyEmail}
            onChange={handleNotifyEmailChange}
            style={checkboxStyle}
            disabled // Disabled for MVP
          />
          <label htmlFor="notifyEmail" style={{ ...checkboxLabelStyle, opacity: 0.5 }}>
            Email notification when model completes
            <span
              style={{
                marginLeft: '8px',
                fontSize: '10px',
                backgroundColor: '#95a5a6',
                color: 'white',
                padding: '2px 6px',
                borderRadius: '4px',
              }}
            >
              Coming Soon
            </span>
          </label>
        </div>
        <div style={checkboxRowStyle}>
          <input
            type="checkbox"
            id="notifyPush"
            checked={execution.notifyPush}
            onChange={handleNotifyPushChange}
            style={checkboxStyle}
            disabled // Disabled for MVP
          />
          <label htmlFor="notifyPush" style={{ ...checkboxLabelStyle, opacity: 0.5 }}>
            Push notification when model completes
            <span
              style={{
                marginLeft: '8px',
                fontSize: '10px',
                backgroundColor: '#95a5a6',
                color: 'white',
                padding: '2px 6px',
                borderRadius: '4px',
              }}
            >
              Coming Soon
            </span>
          </label>
        </div>
      </div>

      {/* Notes */}
      <div style={notesStyle}>
        <div style={notificationsTitleStyle}><i className="fa-solid fa-note-sticky" style={{ marginRight: '8px' }} />Notes (Optional)</div>
        <textarea
          value={execution.notes ?? ''}
          onChange={handleNotesChange}
          placeholder="Add any notes or comments about this model run..."
          style={textareaStyle}
        />
      </div>

      {/* Warning for probabilistic */}
      {data.model?.runType === 'probabilistic' && (
        <div style={warningStyle}>
          <strong><i className="fa-solid fa-clock" style={{ marginRight: '6px' }} />Probabilistic Run:</strong> This simulation will run multiple iterations to
          generate burn probability maps. Execution time may be significantly longer than a
          deterministic run. You'll receive a notification when it completes.
        </div>
      )}

      {/* Info */}
      <div
        style={{
          fontSize: '12px',
          color: '#555',
          textAlign: 'center',
          padding: '8px',
        }}
      >
        Once started, you can close this window. Your model will continue running on the server.
        <br />
        You'll be able to view results from the Model Review page.
      </div>
    </div>
  );
}
