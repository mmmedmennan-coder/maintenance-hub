import "server-only";
import type { z } from "zod";
import type { supportMessageSchema } from "@/lib/schemas";
import type { Actor } from "@/server/auth/roles";
import type { Tx } from "@/server/db/context";
import { DomainError } from "@/server/errors";

const PAGE_SIZE = 20;

export async function listNotifications(tx: Tx, actor: Actor, page = 1) {
  const where = { userId: actor.userId, organizationId: actor.orgId };
  const [items, total, unread] = await Promise.all([
    tx.notification.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
    tx.notification.count({ where }),
    tx.notification.count({ where: { ...where, readAt: null } }),
  ]);
  return { items, total, unread, page, pageSize: PAGE_SIZE };
}

export async function unreadCount(tx: Tx, actor: Actor) {
  return tx.notification.count({ where: { userId: actor.userId, organizationId: actor.orgId, readAt: null } });
}

export async function markNotificationsRead(tx: Tx, actor: Actor, ids: string[] | "all") {
  const result = await tx.notification.updateMany({
    where: { userId: actor.userId, organizationId: actor.orgId, readAt: null, ...(ids === "all" ? {} : { id: { in: ids } }) },
    data: { readAt: new Date() },
  });
  return { updated: result.count };
}

/** Public support form, stored for administrators (the route applies a per-IP rate limit). */
export async function createSupportMessage(tx: Tx, userId: string | null, input: z.output<typeof supportMessageSchema>) {
  await tx.supportMessage.createMany({
    data: [{ name: input.name, email: input.email, organizationName: input.organizationName, topic: input.topic, message: input.message, userId }],
  });
}

export function assertNonEmpty(ids: string[]) {
  if (ids.length === 0) throw new DomainError("VALIDATION_ERROR", "Aucune notification sélectionnée.");
}
