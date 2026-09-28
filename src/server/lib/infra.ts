import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { Actor } from "@/server/auth/roles";
import type { Tx } from "@/server/db/context";
import { DomainError } from "@/server/errors";
import { canonicalJson, sha256Hex } from "./hash";

export type DomainEventType =
  | "request.submitted"
  | "request.invited"
  | "invitation.declined"
  | "offer.issued"
  | "offer.withdrawn"
  | "booking.requested"
  | "booking.confirmed"
  | "booking.declined"
  | "booking.cancelled"
  | "booking.no_show"
  | "booking.reschedule_proposed"
  | "booking.rescheduled"
  | "booking.reschedule_rejected"
  | "work_order.status_changed"
  | "repair_quote.issued"
  | "repair_quote.decided"
  | "report.submitted"
  | "report.acknowledged"
  | "dispute.opened"
  | "dispute.updated"
  | "payment.reported"
  | "payment.updated"
  | "maintenance_plan.proposed"
  | "maintenance_plan.updated"
  | "review.submitted"
  | "provider.reviewed"
  | "staff.invited";

/**
 * Appends a transactional outbox event. Payloads carry identifiers only; the worker
 * re-reads authoritative records and derives recipients from them.
 * createMany is used deliberately: the runtime role may insert but not read the outbox.
 */
export async function emitEvent(
  tx: Tx,
  actor: Pick<Actor, "userId" | "orgId"> | null,
  event: { type: DomainEventType; aggregateType: string; aggregateId: string; payload?: Record<string, string | number | boolean | null> },
) {
  await tx.outboxEvent.createMany({
    data: [
      {
        type: event.type,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        payload: (event.payload ?? {}) as Prisma.InputJsonValue,
        actorUserId: actor?.userId ?? null,
        actorOrgId: actor?.orgId ?? null,
      },
    ],
  });
}

const REDACT_KEYS = /password|token|secret|email|phone|iban/i;

function redact(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(redact);
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, REDACT_KEYS.test(k) ? "[redacted]" : redact(v)]),
  );
}

/** Immutable audit record (insert-only for runtime roles). Personal data keys are redacted. */
export async function audit(
  tx: Tx,
  actor: Pick<Actor, "userId" | "orgId" | "role"> | null,
  entry: { action: string; targetType: string; targetId?: string | null; reason?: string | null; metadata?: Record<string, unknown> },
) {
  await tx.auditEvent.createMany({
    data: [
      {
        actorUserId: actor?.userId ?? null,
        actorOrgId: actor?.orgId ?? null,
        actorRole: actor?.role ?? null,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId ?? null,
        reason: entry.reason ?? null,
        metadata: entry.metadata ? (redact(entry.metadata) as Prisma.InputJsonValue) : undefined,
      },
    ],
  });
}

export type IdempotentResult<T> = { status: number; body: T; replayed: boolean };

/**
 * Idempotency for retried mutations, scoped to (acting organization, operation, key).
 * The record is inserted FIRST inside the same transaction as the operation, so a
 * concurrent duplicate blocks on the unique index and then sees the committed outcome.
 * Reusing a key with a different payload fails with IDEMPOTENCY_KEY_REUSED.
 */
export async function idempotent<T>(
  tx: Tx,
  actor: Actor,
  operation: string,
  key: string | null,
  request: unknown,
  fn: () => Promise<T>,
): Promise<IdempotentResult<T>> {
  if (!key) return { status: 200, body: await fn(), replayed: false };
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(key)) {
    throw new DomainError("VALIDATION_ERROR", "En-tête Idempotency-Key invalide.");
  }
  const requestHash = sha256Hex(canonicalJson({ operation, request }));
  const existing = await tx.idempotencyRecord.findUnique({
    where: { organizationId_operation_key: { organizationId: actor.orgId, operation, key } },
  });
  if (existing) {
    if (existing.requestHash !== requestHash) {
      throw new DomainError("IDEMPOTENCY_KEY_REUSED", "Cette clé d'idempotence a déjà été utilisée pour une autre requête.");
    }
    return { status: existing.responseStatus, body: existing.responseBody as T, replayed: true };
  }
  const record = await tx.idempotencyRecord.create({
    data: {
      organizationId: actor.orgId,
      userId: actor.userId,
      operation,
      key,
      requestHash,
      responseStatus: 102,
      responseBody: {},
    },
    select: { id: true },
  });
  const body = await fn();
  await tx.idempotencyRecord.update({
    where: { id: record.id },
    data: { responseStatus: 200, responseBody: JSON.parse(JSON.stringify(body ?? null)) as Prisma.InputJsonValue },
  });
  return { status: 200, body, replayed: false };
}

/** Looks up a committed idempotent outcome after a concurrent duplicate lost the race. */
export async function findIdempotentOutcome<T>(tx: Tx, actor: Actor, operation: string, key: string, request: unknown) {
  const requestHash = sha256Hex(canonicalJson({ operation, request }));
  const existing = await tx.idempotencyRecord.findUnique({
    where: { organizationId_operation_key: { organizationId: actor.orgId, operation, key } },
  });
  if (!existing || existing.responseStatus === 102) return null;
  if (existing.requestHash !== requestHash) {
    throw new DomainError("IDEMPOTENCY_KEY_REUSED", "Cette clé d'idempotence a déjà été utilisée pour une autre requête.");
  }
  return { status: existing.responseStatus, body: existing.responseBody as T, replayed: true } satisfies IdempotentResult<T>;
}
