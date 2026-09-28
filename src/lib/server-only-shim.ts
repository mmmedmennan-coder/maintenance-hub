// Used only by the Node worker and scripts (see tsconfig.worker.json) and by Vitest.
// Next.js resolves the real `server-only` package, which fails the build if a
// server module is imported from a Client Component.
export {};
