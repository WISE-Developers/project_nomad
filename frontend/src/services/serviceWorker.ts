/**
 * Service Worker Registration
 *
 * Registers the Project Nomad service worker for browser push notification support.
 * Safe to call multiple times — only registers once.
 *
 * The SW handles:
 *   - SHOW_NOTIFICATION messages from the main app thread
 *   - notificationclick events to navigate the user to model results
 */

let registrationPromise: Promise<ServiceWorkerRegistration | null> | null = null;

/**
 * Register the service worker and return its registration.
 * Returns null if service workers are not supported.
 * Only registers once — subsequent calls return the same promise.
 */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) {
    console.warn('[SW] Service workers not supported in this browser');
    return null;
  }

  if (registrationPromise !== null) {
    return registrationPromise;
  }

  registrationPromise = navigator.serviceWorker
    .register('/sw.js', { scope: '/' })
    .then((registration) => {
      console.log('[SW] Registered, scope:', registration.scope);
      return registration;
    })
    .catch((error) => {
      console.error('[SW] Registration failed:', error);
      // Reset so it can be retried
      registrationPromise = null;
      return null;
    });

  return registrationPromise;
}

/**
 * Unregister all service workers (useful for development/testing).
 */
export async function unregisterServiceWorkers(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;

  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(registrations.map((r) => r.unregister()));
  registrationPromise = null;
}
