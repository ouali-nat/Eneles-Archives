// Service worker, required for PWA support.
// Currently a no-op; caching strategies can be added later.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
