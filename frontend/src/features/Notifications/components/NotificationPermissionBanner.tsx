/**
 * Notification Permission Banner Component
 *
 * Prompts user to enable browser notifications for model completion alerts.
 */

import React, { useState, useEffect } from 'react';

interface NotificationPermissionBannerProps {
  onPermissionGranted?: () => void;
  onDismiss?: () => void;
}

export function NotificationPermissionBanner({
  onPermissionGranted,
  onDismiss,
}: NotificationPermissionBannerProps): React.ReactElement | null {
  const [permission, setPermission] = useState<NotificationPermission>(
    typeof Notification !== 'undefined' ? Notification.permission : 'denied'
  );
  const [dismissed, setDismissed] = useState(false);

  // Check if already asked
  useEffect(() => {
    const wasDismissed = localStorage.getItem('notification-banner-dismissed');
    if (wasDismissed === 'true') {
      setDismissed(true);
    }
  }, []);

  // Don't show if already granted, denied, or dismissed
  if (permission !== 'default' || dismissed) {
    return null;
  }

  // Don't show if notifications not supported
  if (typeof Notification === 'undefined') {
    return null;
  }

  const handleEnable = async () => {
    const result = await Notification.requestPermission();
    setPermission(result);
    if (result === 'granted') {
      onPermissionGranted?.();
    }
  };

  const handleDismiss = () => {
    setDismissed(true);
    localStorage.setItem('notification-banner-dismissed', 'true');
    onDismiss?.();
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: '20px',
        left: '50%',
        transform: 'translateX(-50%)',
        backgroundColor: '#1f2937',
        border: '1px solid #374151',
        borderRadius: '8px',
        padding: '12px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: '16px',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
        zIndex: 9998,
        color: '#f3f4f6',
        fontFamily: 'system-ui, sans-serif',
        maxWidth: '500px',
      }}
    >
      <div
        style={{
          width: '40px',
          height: '40px',
          borderRadius: '50%',
          backgroundColor: '#374151',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '20px',
        }}
      >
        🔔
      </div>

      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600, fontSize: '14px', marginBottom: '4px' }}>
          Enable Notifications
        </div>
        <div style={{ fontSize: '13px', color: '#9ca3af' }}>
          Get notified when your fire models finish running.
        </div>
      </div>

      <div style={{ display: 'flex', gap: '8px' }}>
        <button
          onClick={handleEnable}
          style={{
            padding: '8px 16px',
            backgroundColor: '#ff6b35',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '13px',
            fontWeight: 500,
          }}
        >
          Enable
        </button>
        <button
          onClick={handleDismiss}
          style={{
            padding: '8px 16px',
            backgroundColor: 'transparent',
            color: '#9ca3af',
            border: 'none',
            cursor: 'pointer',
            fontSize: '13px',
          }}
        >
          Not now
        </button>
      </div>
    </div>
  );
}

export default NotificationPermissionBanner;
