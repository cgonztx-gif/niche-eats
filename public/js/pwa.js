/**
 * Service worker registration, shared by both pages.
 *
 * Registration failure is non-fatal: the app works fine without offline
 * support, so a worker problem must never block the dashboard from rendering.
 */
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((error) => {
      console.warn('Service worker registration failed:', error.message);
    });
  });
}
