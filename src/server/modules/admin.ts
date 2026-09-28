import "server-only";
import type { z } from "zod";
import type { providerCheckSchema, providerReviewSchema, subscriptionPeriodSchema, subscriptionPlanSchema } from "@/lib/schemas";
import { dateOnly } from "@/lib/time";
import { type Actor, can } from "@/server/auth/roles";
import type { Tx } from "@/server/db/context";
import { DomainError, forbidden, invalidTransition, notFound } from "@/server/errors";
import { audit, emitEvent } from "@/server/lib/infra";

function assertAdmin(actor: Actor) {
  if (!can.admin(actor)) throw forbidden();
}

/** Records that an administrator viewed another organization's record (audited access). */
export async function auditAdminView(tx: Tx, actor: Actor, targetType: string, targetId: string) {
  if (!can.admin(actor)) return;
  await audit(tx, actor, { action: "admin.viewed", targetType, targetId });
}

export async function adminMetrics(tx: Tx, actor: Actor) {
  assertAdmin(actor);
  const [providers, requests, unmatched, bookings, workOrders, disputes, reviews, subscriptions, queue] = await Promise.all([
    tx.providerProfile.groupBy({ by: ["status"], _count: true }),
    tx.serviceRequest.groupBy({ by: ["status"], _count: true, where: { status: { not: "DRAFT" } } }),
    tx.serviceRequest.count({ where: { status: "OPEN", invitations: { none: { status: { in: ["INVITED", "OFFERED"] } } } } }),
    tx.booking.groupBy({ by: ["status"], _count: true }),
    tx.workOrder.groupBy({ by: ["status"], _count: true }),
    tx.dispute.count({ where: { status: { in: ["OPEN", "UNDER_REVIEW"] } } }),
    tx.review.count({ where: { status: "PENDING_MODERATION" } }),
    tx.providerSubscription.findMany({ select: { paidUntil: true } }),
    tx.$queryRaw<{ outbox_failed: number; outbox_dead: number; email_failed: number; email_dead: number; outbox_pending: number }[]>`SELECT * FROM app.queue_health()`,
  ]);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Casablanca" }).format(new Date());
  const activeSubs = subscriptions.filter((s) => s.paidUntil && s.paidUntil.toISOString().slice(0, 10) >= today).length;
  const toMap = (rows: { status: string; _count: number }[]) => Object.fromEntries(rows.map((r) => [r.status, r._count]));
  const confirmedOrDone = bookings.filter((b) => ["CONFIRMED", "COMPLETED"].includes(b.status)).reduce((a, b) => a + b._count, 0);
  const allSelected = bookings.reduce((a, b) => a + b._count, 0);
  return {
    providers: toMap(providers),
    requests: toMap(requests),
    unmatched,
    bookings: toMap(bookings),
    workOrders: toMap(workOrders),
    openDisputes: disputes,
    pendingReviews: reviews,
    subscriptions: { active: activeSubs, total: subscriptions.length },
    confirmationRate: allSelected ? confirmedOrDone / allSelected : null,
    queue: queue[0] ?? null,
  };
}

// --- Provider review & checks --------------------------------------------------------------

export async function listProvidersForReview(tx: Tx, actor: Actor, status?: string) {
  assertAdmin(actor);
  const statuses = ["DRAFT", "SUBMITTED", "APPROVED", "REJECTED", "SUSPENDED"] as const;
  const s = statuses.find((x) => x === status);
  return tx.providerProfile.findMany({
    where: s ? { status: s } : {},
    orderBy: [{ submittedAt: { sort: "asc", nulls: "last" } }, { displayName: "asc" }],
    include: {
      organization: { select: { name: true, createdAt: true, isDemo: true } },
      checks: { select: { type: true, status: true } },
      serviceAreas: { include: { serviceArea: { select: { name: true } } } },
    },
  });
}

export async function getProviderForReview(tx: Tx, actor: Actor, profileId: string) {
  assertAdmin(actor);
  const profile = await tx.providerProfile.findUnique({
    where: { id: profileId },
    include: {
      organization: true,
      checks: { orderBy: { type: "asc" } },
      serviceAreas: { include: { serviceArea: true } },
      categories: { include: { equipmentCategory: true } },
    },
  });
  if (!profile) throw notFound("Prestataire");
  const [technicians, subscription] = await Promise.all([
    tx.technicianProfile.findMany({ where: { providerOrgId: profile.providerOrgId }, include: { windows: true } }),
    tx.providerSubscription.findUnique({ where: { providerOrgId: profile.providerOrgId }, include: { plan: true, events: { orderBy: { createdAt: "desc" } } } }),
  ]);
  await auditAdminView(tx, actor, "provider_profile", profileId);
  return { profile, technicians, subscription };
}

export async function reviewProvider(tx: Tx, actor: Actor, profileId: string, input: z.output<typeof providerReviewSchema>) {
  assertAdmin(actor);
  const profile = await tx.providerProfile.findUnique({ where: { id: profileId } });
  if (!profile) throw notFound("Prestataire");
  const rules: Record<string, { from: string[]; to: "APPROVED" | "REJECTED" | "SUSPENDED" }> = {
    APPROVE: { from: ["SUBMITTED", "REJECTED"], to: "APPROVED" },
    REJECT: { from: ["SUBMITTED"], to: "REJECTED" },
    SUSPEND: { from: ["APPROVED"], to: "SUSPENDED" },
    REINSTATE: { from: ["SUSPENDED"], to: "APPROVED" },
  };
  const rule = rules[input.decision]!;
  if (!rule.from.includes(profile.status)) throw invalidTransition("Transition impossible depuis le statut actuel.");
  if (rule.to === "APPROVED") {
    const identity = await tx.providerCheck.findFirst({ where: { providerProfileId: profileId, type: "BUSINESS_IDENTITY", status: "VERIFIED" } });
    if (!identity) throw invalidTransition("Vérifiez au minimum l'identité de l'entreprise avant l'approbation.");
  }
  await tx.providerProfile.update({
    where: { id: profileId },
    data: { status: rule.to, statusReason: input.reason, reviewedAt: new Date(), reviewedById: actor.userId },
  });
  await audit(tx, actor, { action: `provider.${input.decision.toLowerCase()}`, targetType: "provider_profile", targetId: profileId, reason: input.reason });
  await emitEvent(tx, actor, { type: "provider.reviewed", aggregateType: "provider_profile", aggregateId: profileId, payload: { status: rule.to } });
}

export async function upsertProviderCheck(tx: Tx, actor: Actor, profileId: string, input: z.output<typeof providerCheckSchema>) {
  assertAdmin(actor);
  const profile = await tx.providerProfile.findUnique({ where: { id: profileId } });
  if (!profile) throw notFound("Prestataire");
  const data = {
    status: input.status,
    publicNote: input.publicNote,
    internalNote: input.internalNote,
    expiresAt: input.expiresAt ? dateOnly(input.expiresAt) : null,
    checkedById: actor.userId,
    checkedAt: new Date(),
  };
  await tx.providerCheck.upsert({
    where: { providerProfileId_type: { providerProfileId: profileId, type: input.type } },
    create: { providerProfileId: profileId, providerOrgId: profile.providerOrgId, type: input.type, ...data },
    update: data,
  });
  await audit(tx, actor, { action: "provider.check_recorded", targetType: "provider_profile", targetId: profileId, metadata: { type: input.type, status: input.status } });
}

// --- Subscriptions (manual pilot periods) --------------------------------------------------------

export async function listSubscriptions(tx: Tx, actor: Actor) {
  assertAdmin(actor);
  const [profiles, plans] = await Promise.all([
    tx.providerProfile.findMany({ orderBy: { displayName: "asc" }, select: { id: true, providerOrgId: true, displayName: true, status: true, isDemo: true } }),
    tx.subscriptionPlan.findMany({ orderBy: { createdAt: "asc" } }),
  ]);
  const subs = await tx.providerSubscription.findMany({ include: { plan: true, events: { orderBy: { createdAt: "desc" }, take: 5 } } });
  const byOrg = new Map(subs.map((s) => [s.providerOrgId, s]));
  return { providers: profiles.map((p) => ({ ...p, subscription: byOrg.get(p.providerOrgId) ?? null })), plans };
}

export async function recordSubscriptionPeriod(tx: Tx, actor: Actor, providerOrgId: string, input: z.output<typeof subscriptionPeriodSchema>) {
  assertAdmin(actor);
  const profile = await tx.providerProfile.findFirst({ where: { providerOrgId } });
  if (!profile) throw notFound("Prestataire");
  const plan = await tx.subscriptionPlan.findFirst({ where: { active: true }, orderBy: { createdAt: "asc" } });
  if (!plan) throw new DomainError("INVALID_TRANSITION", "Aucun plan actif configuré.");
  let sub = await tx.providerSubscription.findUnique({ where: { providerOrgId } });
  if (!sub) sub = await tx.providerSubscription.create({ data: { providerOrgId, planId: plan.id } });
  const currentEnd = sub.paidUntil?.toISOString().slice(0, 10) ?? null;
  const newEnd = !currentEnd || input.periodEnd > currentEnd ? input.periodEnd : currentEnd;
  await tx.providerSubscription.update({ where: { id: sub.id }, data: { paidUntil: dateOnly(newEnd) } });
  await tx.subscriptionEvent.create({
    data: {
      subscriptionId: sub.id,
      providerOrgId,
      type: "PERIOD_RECORDED",
      periodStart: dateOnly(input.periodStart),
      periodEnd: dateOnly(input.periodEnd),
      amountMinor: input.amount,
      currency: "MAD",
      reference: input.reference,
      reason: input.reason,
      actorUserId: actor.userId,
    },
    select: { id: true },
  });
  await audit(tx, actor, { action: "subscription.period_recorded", targetType: "provider_subscription", targetId: sub.id, reason: input.reason, metadata: { periodEnd: input.periodEnd } });
}

export async function correctSubscription(tx: Tx, actor: Actor, providerOrgId: string, paidUntil: string | null, reason: string) {
  assertAdmin(actor);
  const sub = await tx.providerSubscription.findUnique({ where: { providerOrgId } });
  if (!sub) throw notFound("Abonnement");
  await tx.providerSubscription.update({ where: { id: sub.id }, data: { paidUntil: paidUntil ? dateOnly(paidUntil) : null } });
  await tx.subscriptionEvent.create({
    data: { subscriptionId: sub.id, providerOrgId, type: "CORRECTION", periodEnd: paidUntil ? dateOnly(paidUntil) : null, reason, actorUserId: actor.userId },
    select: { id: true },
  });
  await audit(tx, actor, { action: "subscription.corrected", targetType: "provider_subscription", targetId: sub.id, reason });
}

export async function updateSubscriptionPlan(tx: Tx, actor: Actor, planId: string, input: z.output<typeof subscriptionPlanSchema>) {
  assertAdmin(actor);
  const before = await tx.subscriptionPlan.findUnique({ where: { id: planId } });
  if (!before) throw notFound("Plan");
  await tx.subscriptionPlan.update({
    where: { id: planId },
    data: { name: input.name, priceMinor: input.price, maxStaff: input.maxStaff, taxNote: input.taxNote, active: input.active },
  });
  await audit(tx, actor, {
    action: "subscription_plan.updated",
    targetType: "subscription_plan",
    targetId: planId,
    reason: input.reason,
    metadata: { before: { priceMinor: before.priceMinor, maxStaff: before.maxStaff, active: before.active }, after: { priceMinor: input.price, maxStaff: input.maxStaff, active: input.active } },
  });
}

// --- Audit & support ------------------------------------------------------------------------------

export async function listAuditEvents(tx: Tx, actor: Actor, opts: { targetType?: string; targetId?: string; page?: number }) {
  assertAdmin(actor);
  const pageSize = 50;
  const page = opts.page ?? 1;
  const where = { ...(opts.targetType ? { targetType: opts.targetType } : {}), ...(opts.targetId ? { targetId: opts.targetId } : {}) };
  const [items, total] = await Promise.all([
    tx.auditEvent.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
    tx.auditEvent.count({ where }),
  ]);
  const userIds = [...new Set(items.map((i) => i.actorUserId).filter((x): x is string => !!x))];
  const users = userIds.length ? await tx.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [];
  const names = new Map(users.map((u) => [u.id, u.name]));
  return { items: items.map((i) => ({ ...i, actorName: i.actorUserId ? names.get(i.actorUserId) ?? "—" : "Système" })), total, page, pageSize };
}

export async function listSupportMessages(tx: Tx, actor: Actor) {
  assertAdmin(actor);
  return tx.supportMessage.findMany({ orderBy: [{ handled: "asc" }, { createdAt: "desc" }], take: 100 });
}

export async function markSupportHandled(tx: Tx, actor: Actor, id: string) {
  assertAdmin(actor);
  await tx.supportMessage.update({ where: { id }, data: { handled: true } });
  await audit(tx, actor, { action: "support.handled", targetType: "support_message", targetId: id });
}
