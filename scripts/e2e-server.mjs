/**
 * End-to-end test server: prepares the TEST database (reset, migrate, reference data, demo
 * seed), then starts the production build (`next start`, port from APP_URL in .env.test) and
 * the worker with the same configuration. Used by playwright.config.ts; never points at the
 * development database.
 *
 *   npm run build && npm run test:e2e
 */
import { execSync, spawn } from "node:child_process";
import fs from "node:fs";
import { config } from "dotenv";

config({ path: ".env.test", override: true, quiet: true });
const url = new URL(process.env.APP_URL);
if (!/_test$/.test(new URL(process.env.DATABASE_URL).pathname)) {
  console.error("[e2e] DATABASE_URL must point at a *_test database.");
  process.exit(1);
}
const env = {
  ...process.env,
  ENV_FILE: ".env.test",
  ALLOW_DEMO_SEED: "true",
  // Many sign-ins from one address during the run.
  AUTH_SIGNIN_RATE_LIMIT_PER_MINUTE: "1000",
  WORKER_POLL_INTERVAL_MS: "500",
  NEXT_TELEMETRY_DISABLED: "1",
};
const run = (cmd) => execSync(cmd, { stdio: "inherit", env });
run("npx tsx scripts/db-reset-dev.ts --yes");
run("npx tsx scripts/migrate.ts");
run("npx tsx --tsconfig tsconfig.worker.json scripts/seed.ts");
fs.rmSync(process.env.STORAGE_LOCAL_DIR ?? "./storage/test-private", { recursive: true, force: true });

// Clear captured e-mails so tests read only their own messages (Mailpit, local only).
try {
  await fetch("http://127.0.0.1:8025/api/v1/messages", { method: "DELETE" });
} catch {
  console.warn("[e2e] Mailpit not reachable on :8025 — the sign-up test will fail.");
}

const children = [
  spawn("npx", ["next", "start", "-p", url.port || "3100"], { stdio: "inherit", env: { ...env, NODE_ENV: "production" } }),
  spawn("npx", ["tsx", "--tsconfig", "tsconfig.worker.json", "src/worker/index.ts"], { stdio: "inherit", env }),
];
const stop = () => {
  for (const c of children) c.kill("SIGTERM");
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const c of children) c.on("exit", (code) => code && code !== 0 && console.error(`[e2e] child exited with ${code}`));
