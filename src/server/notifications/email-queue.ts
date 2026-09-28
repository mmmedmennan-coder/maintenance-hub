import "server-only";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import type { Tx } from "@/server/db/context";

export type QueuedEmail = {
  /** Stable key for at-most-once enqueueing of the same logical e-mail. */
  dedupeKey?: string;
  category: string;
  to: string;
  subject: string;
  text: string;
};

/**
 * Stores an e-mail for the worker to deliver (durable, retried, visible failures).
 * Never sends from inside a web request.
 */
export async function queueEmail(db: PrismaClient | Tx, email: QueuedEmail) {
  await db.emailDelivery.createMany({
    data: [
      {
        dedupeKey: email.dedupeKey ?? `${email.category}:${randomUUID()}`,
        category: email.category,
        toEmail: email.to,
        subject: email.subject.slice(0, 250),
        textBody: email.text,
      },
    ],
    skipDuplicates: true,
  });
}
