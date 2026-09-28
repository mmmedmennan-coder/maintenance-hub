import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import { t, type Vars } from "@/lib/i18n";
import { getEnv } from "@/server/env";

export type Recipient = { userId: string; email: string; name: string; orgId: string };

export const CUSTOMER_WRITERS = ["customer_owner", "customer_manager"];
export const CUSTOMER_ALL = ["customer_owner", "customer_manager", "customer_viewer"];
export const PROVIDER_MANAGERS = ["provider_owner", "provider_dispatcher"];

export async function orgRecipients(db: PrismaClient, orgId: string, roles?: string[]): Promise<Recipient[]> {
  const members = await db.member.findMany({
    where: { organizationId: orgId, ...(roles ? { role: { in: roles } } : {}) },
    include: { user: { select: { id: true, email: true, name: true, emailVerified: true } } },
  });
  return members.map((m) => ({ userId: m.user.id, email: m.user.email, name: m.user.name, orgId }));
}

export async function adminRecipients(db: PrismaClient): Promise<Recipient[]> {
  const members = await db.member.findMany({
    where: { role: "platform_admin", organization: { type: "PLATFORM" } },
    include: { user: { select: { id: true, email: true, name: true } } },
  });
  return members.map((m) => ({ userId: m.user.id, email: m.user.email, name: m.user.name, orgId: m.organizationId }));
}

export async function technicianRecipient(db: PrismaClient, technicianId: string | null): Promise<Recipient[]> {
  if (!technicianId) return [];
  const tech = await db.technicianProfile.findUnique({ where: { id: technicianId }, select: { userId: true, providerOrgId: true } });
  if (!tech?.userId) return [];
  const user = await db.user.findUnique({ where: { id: tech.userId }, select: { id: true, email: true, name: true } });
  return user ? [{ userId: user.id, email: user.email, name: user.name, orgId: tech.providerOrgId }] : [];
}

/**
 * Creates in-app notifications (and optionally queued e-mails) for recipients. Idempotent:
 * notification (event_id, user_id) is unique and e-mail dedupe keys derive from the event,
 * so retries of the same outbox event never duplicate messages.
 */
export async function notify(
  db: PrismaClient,
  eventId: string,
  recipients: Recipient[],
  message: { key: string; vars?: Vars; link: string | ((r: Recipient) => string); email?: boolean; excludeUserId?: string | null },
) {
  const unique = new Map<string, Recipient>();
  for (const r of recipients) if (r.userId !== message.excludeUserId) unique.set(`${r.userId}:${r.orgId}`, r);
  const list = [...unique.values()];
  if (list.length === 0) return 0;
  const title = t(`notify.${message.key}.title`, message.vars);
  const body = t(`notify.${message.key}.body`, message.vars);
  const linkFor = (r: Recipient) => (typeof message.link === "function" ? message.link(r) : message.link);
  await db.notification.createMany({
    data: list.map((r) => ({ userId: r.userId, organizationId: r.orgId, type: message.key, title, body, link: linkFor(r), eventId })),
    skipDuplicates: true,
  });
  if (message.email) {
    const env = getEnv();
    await db.emailDelivery.createMany({
      data: list.map((r) => ({
        dedupeKey: `event:${eventId}:${r.userId}:${r.orgId}`,
        category: `notify.${message.key}`,
        toEmail: r.email,
        subject: `${title} — ${env.APP_NAME}`,
        textBody: t("email.notification.body", { name: r.name, body, url: `${env.APP_URL}${linkFor(r)}`, app: env.APP_NAME }),
      })),
      skipDuplicates: true,
    });
  }
  return list.length;
}
