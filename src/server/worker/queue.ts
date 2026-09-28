import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import type { PrismaClient } from "@/generated/prisma/client";
import { getEnv } from "@/server/env";
import { dispatch, type OutboxRow } from "./handlers";

const LEASE_MINUTES = 5;
const HANDLER_TIMEOUT_MS = 60_000;

/** A handler that hangs must not block the worker: it fails and is retried later. */
export function withTimeout<T>(promise: Promise<T>, ms = HANDLER_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`handler timeout after ${ms} ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/** Exponential backoff: 10 s, 20 s, 40 s … capped at one hour. */
export function backoffSeconds(attempts: number) {
  return Math.min(3600, 10 * 2 ** Math.max(0, attempts - 1));
}

/** Error text stored for operators: bounded and stripped of e-mail addresses. */
export function safeError(error: unknown) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return message.replace(/[^\s@]+@[^\s@]+/g, "[email]").slice(0, 500);
}

/**
 * Claims up to `limit` due outbox events (FOR UPDATE SKIP LOCKED) and processes them.
 * Rows whose lease expired (worker crashed mid-processing) are reclaimed. Each handler is
 * idempotent, so at-least-once processing never duplicates domain effects.
 */
export async function processOutboxBatch(db: PrismaClient, workerId: string, limit = 10) {
  const rows = await db.$queryRaw<(OutboxRow & { attempts: number; max_attempts: number })[]>`
    UPDATE outbox_event SET status = 'PROCESSING', locked_at = now(), locked_by = ${workerId}, attempts = attempts + 1
    WHERE id IN (
      SELECT id FROM outbox_event
      WHERE (status IN ('PENDING', 'FAILED') AND available_at <= now())
         OR (status = 'PROCESSING' AND locked_at < now() - make_interval(mins => ${LEASE_MINUTES}))
      ORDER BY created_at
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit})
    RETURNING id, type, aggregate_type, aggregate_id, payload, actor_user_id, actor_org_id, attempts, max_attempts`;
  let ok = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      await withTimeout(dispatch(db, row));
      await db.outboxEvent.updateMany({
        where: { id: row.id, lockedBy: workerId },
        data: { status: "DONE", processedAt: new Date(), lockedAt: null, lastError: null },
      });
      ok++;
    } catch (error) {
      failed++;
      const dead = row.attempts >= row.max_attempts;
      await db.outboxEvent.updateMany({
        where: { id: row.id, lockedBy: workerId },
        data: {
          status: dead ? "DEAD" : "FAILED",
          lockedAt: null,
          lastError: safeError(error),
          availableAt: new Date(Date.now() + backoffSeconds(row.attempts) * 1000),
        },
      });
      console.error(`[worker] outbox ${row.type} ${row.id} failed (attempt ${row.attempts}${dead ? ", dead" : ""}): ${safeError(error)}`);
    }
  }
  return { claimed: rows.length, ok, failed };
}

let transporter: Transporter | undefined;
export function getTransport(): Transporter {
  if (transporter) return transporter;
  const env = getEnv();
  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
  });
  return transporter;
}

export type Sender = (mail: { to: string; subject: string; text: string }) => Promise<void>;

const smtpSender: Sender = async (mail) => {
  await getTransport().sendMail({ from: getEnv().EMAIL_FROM, ...mail });
};

/**
 * Delivers queued e-mails. At-least-once: a crash after the SMTP hand-off but before the
 * status update can resend one message; the body (which may contain a one-time link) is
 * cleared once delivered.
 */
export async function processEmailBatch(db: PrismaClient, workerId: string, limit = 10, send: Sender = smtpSender) {
  const rows = await db.$queryRaw<{ id: string; to_email: string; subject: string; text_body: string; attempts: number; max_attempts: number }[]>`
    UPDATE email_delivery SET status = 'PROCESSING', locked_at = now(), locked_by = ${workerId}, attempts = attempts + 1
    WHERE id IN (
      SELECT id FROM email_delivery
      WHERE (status IN ('PENDING', 'FAILED') AND available_at <= now())
         OR (status = 'PROCESSING' AND locked_at < now() - make_interval(mins => ${LEASE_MINUTES}))
      ORDER BY created_at
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit})
    RETURNING id, to_email, subject, text_body, attempts, max_attempts`;
  let sent = 0;
  for (const row of rows) {
    try {
      await withTimeout(send({ to: row.to_email, subject: row.subject, text: row.text_body }), 30_000);
      await db.emailDelivery.updateMany({
        where: { id: row.id, lockedBy: workerId },
        data: { status: "DONE", sentAt: new Date(), lockedAt: null, lastError: null, textBody: "[contenu effacé après envoi]" },
      });
      sent++;
    } catch (error) {
      const dead = row.attempts >= row.max_attempts;
      await db.emailDelivery.updateMany({
        where: { id: row.id, lockedBy: workerId },
        data: { status: dead ? "DEAD" : "FAILED", lockedAt: null, lastError: safeError(error), availableAt: new Date(Date.now() + backoffSeconds(row.attempts) * 1000) },
      });
      console.error(`[worker] email ${row.id} failed (attempt ${row.attempts}${dead ? ", dead" : ""}): ${safeError(error)}`);
    }
  }
  return { claimed: rows.length, sent };
}
