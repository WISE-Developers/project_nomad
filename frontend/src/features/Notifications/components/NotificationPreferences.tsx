/**
 * Notification Preferences Component
 *
 * Renders toggle switches for each event type × channel (toast, browser).
 * Fetches current preferences on mount and saves on change.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  getNotificationPreferences,
  updateNotificationPreferences,
  type NotificationPreference,
  type NotificationEventType,
} from '../../../services/api';

const EVENT_LABELS: Record<NotificationEventType, string> = {
  model_completed: 'Model Completed',
  model_failed: 'Model Failed',
  import_completed: 'Import Completed',
  import_failed: 'Import Failed',
};

const EVENT_TYPES: NotificationEventType[] = [
  'model_completed',
  'model_failed',
  'import_completed',
  'import_failed',
];

// ─── Toggle Switch ────────────────────────────────────────────────

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label: string;
}

function Toggle({ checked, onChange, disabled = false, label }: ToggleProps): React.ReactElement {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      style={{
        width: '40px',
        height: '22px',
        borderRadius: '11px',
        border: 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        backgroundColor: checked ? '#10b981' : '#4b5563',
        position: 'relative',
        transition: 'background-color 0.2s',
        opacity: disabled ? 0.5 : 1,
        flexShrink: 0,
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: '2px',
          left: checked ? '20px' : '2px',
          width: '18px',
          height: '18px',
          borderRadius: '50%',
          backgroundColor: 'white',
          transition: 'left 0.2s',
        }}
      />
    </button>
  );
}

// ─── NotificationPreferences ──────────────────────────────────────

interface NotificationPreferencesProps {
  onClose?: () => void;
}

export function NotificationPreferences({
  onClose,
}: NotificationPreferencesProps): React.ReactElement {
  const [preferences, setPreferences] = useState<NotificationPreference[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [browserPermission, setBrowserPermission] = useState<NotificationPermission>(
    typeof Notification !== 'undefined' ? Notification.permission : 'denied'
  );

  // Fetch preferences on mount
  useEffect(() => {
    getNotificationPreferences()
      .then(({ preferences: prefs }) => {
        setPreferences(prefs);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load preferences');
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, []);

  // Request browser notification permission
  const handleRequestPermission = useCallback(async () => {
    if (typeof Notification === 'undefined') return;
    const result = await Notification.requestPermission();
    setBrowserPermission(result);
  }, []);

  // Update a single preference field
  const handleToggle = useCallback(
    async (
      eventType: NotificationEventType,
      field: 'toastEnabled' | 'browserEnabled',
      value: boolean
    ) => {
      // Optimistic update
      const updated = preferences.map((p) =>
        p.eventType === eventType ? { ...p, [field]: value } : p
      );
      setPreferences(updated);
      setIsSaving(true);

      try {
        const toSave = updated.map(({ eventType: et, toastEnabled, browserEnabled }) => ({
          eventType: et,
          toastEnabled,
          browserEnabled,
        }));

        const { preferences: saved } = await updateNotificationPreferences({ preferences: toSave });
        setPreferences(saved);
      } catch (err) {
        // Rollback on failure
        setPreferences(preferences);
        setError(err instanceof Error ? err.message : 'Failed to save preferences');
      } finally {
        setIsSaving(false);
      }
    },
    [preferences]
  );

  const prefMap = new Map(preferences.map((p) => [p.eventType, p]));

  return (
    <div
      style={{
        backgroundColor: '#1f2937',
        border: '1px solid #374151',
        borderRadius: '8px',
        padding: '20px',
        minWidth: '380px',
        color: '#f3f4f6',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '16px',
        }}
      >
        <div style={{ fontWeight: 600, fontSize: '16px' }}>Notification Preferences</div>
        {onClose && (
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: '#6b7280',
              cursor: 'pointer',
              fontSize: '18px',
              lineHeight: 1,
            }}
          >
            ×
          </button>
        )}
      </div>

      {/* Browser permission prompt */}
      {browserPermission !== 'granted' && (
        <div
          style={{
            backgroundColor: '#374151',
            borderRadius: '6px',
            padding: '12px',
            marginBottom: '16px',
            fontSize: '13px',
            color: '#9ca3af',
          }}
        >
          <div style={{ marginBottom: '8px' }}>
            Browser notifications require permission.
          </div>
          {browserPermission === 'denied' ? (
            <div style={{ color: '#ef4444', fontSize: '12px' }}>
              Permission denied. Enable notifications in browser settings.
            </div>
          ) : (
            <button
              onClick={handleRequestPermission}
              style={{
                padding: '6px 12px',
                backgroundColor: '#ff6b35',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '12px',
                fontWeight: 500,
              }}
            >
              Enable Browser Notifications
            </button>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div
          style={{
            color: '#ef4444',
            fontSize: '13px',
            marginBottom: '12px',
            padding: '8px',
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
            borderRadius: '4px',
          }}
        >
          {error}
        </div>
      )}

      {/* Column headers */}
      {!isLoading && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 80px 80px',
            gap: '8px',
            marginBottom: '8px',
            fontSize: '11px',
            color: '#6b7280',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          <div>Event</div>
          <div style={{ textAlign: 'center' }}>Toast</div>
          <div style={{ textAlign: 'center' }}>Browser</div>
        </div>
      )}

      {/* Preference rows */}
      {isLoading ? (
        <div style={{ color: '#6b7280', fontSize: '14px', padding: '8px 0' }}>
          Loading preferences...
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {EVENT_TYPES.map((eventType) => {
            const pref = prefMap.get(eventType);
            const toastEnabled = pref?.toastEnabled ?? true;
            const browserEnabled = pref?.browserEnabled ?? false;

            return (
              <div
                key={eventType}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 80px 80px',
                  gap: '8px',
                  alignItems: 'center',
                  padding: '8px 0',
                  borderBottom: '1px solid #374151',
                }}
              >
                <div style={{ fontSize: '14px' }}>{EVENT_LABELS[eventType]}</div>
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  <Toggle
                    checked={toastEnabled}
                    onChange={(value) => void handleToggle(eventType, 'toastEnabled', value)}
                    disabled={isSaving}
                    label={`Toast for ${EVENT_LABELS[eventType]}`}
                  />
                </div>
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  <Toggle
                    checked={browserEnabled}
                    onChange={(value) => void handleToggle(eventType, 'browserEnabled', value)}
                    disabled={isSaving || browserPermission !== 'granted'}
                    label={`Browser notification for ${EVENT_LABELS[eventType]}`}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {isSaving && (
        <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '12px', textAlign: 'right' }}>
          Saving...
        </div>
      )}
    </div>
  );
}

export default NotificationPreferences;
