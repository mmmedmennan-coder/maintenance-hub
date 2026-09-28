/**
 * Maintenance Hub background worker.
 *
 *   npm run worker:dev    (watch mode)
 *   npm run worker:start
 *
 * Processes the transactional outbox (notifications, PDFs, competing-offer closure),
 * delivers queued e-mails and runs scheduled tasks (booking expiry, offer expiry,
 * maintenance reminders, abandoned uploads). State lives in PostgreSQL, so a restart
 * resumes where it stopped; expired leases are reclaimed.
 */
import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { disconnectAll, workerDb } from "@/server/db/clients";
import { getEnv } from "@/server/env";
import { processEmailBatch, processOutboxBatch } from "@/server/worker/queue";
import { runScheduledTasks } from "@/server/worker/scheduler";

config({ path: process.env.ENV_FILE ?? ".env", quiet: true });

const workerId = `worker-${process.pid}-${randomUUID().slice(0, 8)}`;
let stopping = false;

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const env = getEnv();
  const db = workerDb();
  console.log(`[worker] ${workerId} started (poll ${env.WORKER_POLL_INTERVAL_MS} ms)`);
  let lastSchedule = 0;
  while (!stopping) {
    try {
      const outbox = await processOutboxBatch(db, workerId);
      const email = await processEmailBatch(db, workerId);
      if (Date.now() - lastSchedule > 60_000) {
        lastSchedule = Date.now();
        const tasks = await runScheduledTasks(db);
        if (Object.values(tasks).some((n) => n > 0)) console.log("[worker] scheduled tasks", tasks);
      }
      if (outbox.claimed || email.claimed) {
        console.log(`[worker] outbox ${outbox.ok}/${outbox.claimed} ok · e-mails ${email.sent}/${email.claimed} sent`);
        continue; // More work may be waiting.
      }
    } catch (error) {
      console.error("[worker] loop error:", error instanceof Error ? error.message : error);
    }
    await sleep(env.WORKER_POLL_INTERVAL_MS);
  }
  await disconnectAll();
  console.log(`[worker] ${workerId} stopped`);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.log(`[worker] ${signal} received, finishing current batch…`);
    stopping = true;
  });
}

main().catch((error) => {
  console.error("[worker] fatal:", error);
  process.exit(1);
});
