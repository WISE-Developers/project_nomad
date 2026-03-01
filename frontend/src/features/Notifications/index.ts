/**
 * Notifications Feature
 *
 * Provides real-time job status notifications via SSE and browser push.
 */

export { useJobNotifications } from './hooks/useJobNotifications';
export type { JobStatus } from './hooks/useJobNotifications';
export { JobStatusToast } from './components/JobStatusToast';
export { NotificationPermissionBanner } from './components/NotificationPermissionBanner';
export { NotificationPreferences } from './components/NotificationPreferences';
