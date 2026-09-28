"use client";

import { useEffect } from "react";

/**
 * Registers a minimal service worker that only serves an offline notice for failed page
 * navigations. It never caches API responses or private customer records.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
  }, []);
  return null;
}
