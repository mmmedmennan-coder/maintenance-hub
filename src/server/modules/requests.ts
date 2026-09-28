import "server-only";
import type { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { inviteProvidersSchema, requestDraftSchema, requestUpdateSchema } from "@/lib/schemas";
import { localToUtc } from "@/lib/time";
import { type Actor, can } from "@/server/auth/roles";
import type { Tx } from "@/server/db/context";
import { DomainError, forbidden, invalidTransition, notFound, validation } from "@/server/errors";
import { audit, emitEvent } from "@/server/lib/infra";
import { lockForUpdate, lockVisible } from "@/server/lib/locks";

export const MAX_INVITATIONS = 3;
const PAGE_SIZE = 15;

export type PreferredWindow = { start: string; end: string };

/** The limited brief an invited provider receives. No customer identity, address or history. */
export type RequestBrief = {
  reference: string;
  kind: "DIAGNOSTIC" | "MAINTENANCE" | "BREAKDOWN";
  title: string;
  symptoms: string;
  city: string;
  serviceAreaName: string | null;
  equipmentCategory: string;
  equipmentCategoryId: string;
  brand: string | null;
  model: string | null;
  installedYear: number | null;
  preferredWindows: PreferredWindow[];
  sharedAttachmentCount: number;
  submittedAt: string | null;
};

function toWindows(input: z.output<typeof requestDraftSchema>["preferredWindows"]): PreferredWindow[] {
  return input.map((w) => ({ start: localToUtc(w.date, w.start).toISOString(), end: localToUtc(w.date, w.end).toISOString() }));
}

function assertFutureWindows(windows: PreferredWindow[]) {
  if (windows.some((w) => new Date(w.end).getTime() <= Date.now())) {
    throw validation("Créneau passé.", { preferredWindows: ["Les créneaux souhaités doivent être dans le futur."] });
  }
}

function assertWriter(actor: Actor) {
  if (!can.customerWrite(actor)) throw forbidden("Votre rôle permet uniquement la consultation.");
}

export async function createRequestDraft(tx: Tx, actor: Actor, input: z.output<typeof requestDraftSchema>) {
  assertWriter(actor);
  const equipment = await tx.equipment.findFirst({
    where: { id: input.equipmentId, customerOrgId: actor.orgId, archivedAt: null },
    include: { site: true },
  });
  if (!equipment || equipment.site.archivedAt) {
    throw validation("Équipement invalide.", { equipmentId: ["Choisissez un équipement actif de votre entreprise."] });
  }
  const windows = toWindows(input.preferredWindows);
  assertFutureWindows(windows);
  const request = await tx.serviceRequest.create({
    data: {
      customerOrgId: actor.orgId,
      siteId: equipment.siteId,
      equipmentId: equipment.id,
      equipmentCategoryId: equipment.categoryId,
      serviceAreaId: equipment.site.serviceAreaId,
      city: equipment.site.city,
      kind: input.kind,
      source: input.kind === "BREAKDOWN" ? "BREAKDOWN_ROUTING" : "MARKETPLACE",
      title: input.title,
      symptoms: input.symptoms,
      preferredWindows: windows,
      createdById: actor.userId,
    },
    select: { id: true, reference: true },
  });
  await audit(tx, actor, { action: "request.drafted", targetType: "service_request", targetId: request.id });
  return request;
}

export async function updateRequestDraft(tx: Tx, actor: Actor, requestId: string, input: z.output<typeof requestUpdateSchema>) {
  assertWriter(actor);
  const request = await tx.serviceRequest.findFirst({ where: { id: requestId, customerOrgId: actor.orgId } });
  if (!request) throw notFound("Demande");
  if (request.status !== "DRAFT") throw invalidTransition("Une demande soumise ne peut plus être modifiée.");
  const data: Prisma.ServiceRequestUncheckedUpdateManyInput = { version: { increment: 1 } };
  if (input.equipmentId && input.equipmentId !== request.equipmentId) {
    const equipment = await tx.equipment.findFirst({
      where: { id: input.equipmentId, customerOrgId: actor.orgId, archivedAt: null },
      include: { site: true },
    });
    if (!equipment) throw validation("Équipement invalide.", { equipmentId: ["Équipement inconnu."] });
    Object.assign(data, {
      equipmentId: equipment.id,
      siteId: equipment.siteId,
      equipmentCategoryId: equipment.categoryId,
      serviceAreaId: equipment.site.serviceAreaId,
      city: equipment.site.city,
    });
  }
  if (input.kind) Object.assign(data, { kind: input.kind, source: input.kind === "BREAKDOWN" ? "BREAKDOWN_ROUTING" : "MARKETPLACE" });
  if (input.title) data.title = input.title;
  if (input.symptoms) data.symptoms = input.symptoms;
  if (input.preferredWindows) {
    const windows = toWindows(input.preferredWindows);
    assertFutureWindows(windows);
    data.preferredWindows = windows;
  }
  const result = await tx.serviceRequest.updateMany({ where: { id: requestId, version: input.version, status: "DRAFT" }, data });
  if (!result.count) throw new DomainError("VERSION_CONFLICT", "La demande a été modifiée entre-temps. Rechargez la page.");
  return { id: requestId };
}

export async function submitRequest(tx: Tx, actor: Actor, requestId: string) {
  assertWriter(actor);
  if (!(await lockForUpdate(tx, "service_request", requestId))) throw notFound("Demande");
  const request = await tx.serviceRequest.findFirstOrThrow({ where: { id: requestId }, include: { equipment: true, site: true } });
  if (request.customerOrgId !== actor.orgId) throw notFound("Demande");
  if (request.status !== "DRAFT") throw invalidTransition("Cette demande a déjà été soumise.");
  if (request.equipment.archivedAt || request.site.archivedAt) throw invalidTransition("L'équipement ou le site est archivé.");
  assertFutureWindows(request.preferredWindows as PreferredWindow[]);
  const pendingUploads = await tx.document.count({ where: { requestId, status: "PENDING" } });
  if (pendingUploads) throw invalidTransition("Des photos sont encore en cours d'envoi. Attendez la fin de l'envoi ou retirez-les.");
  await tx.serviceRequest.update({ where: { id: requestId }, data: { status: "OPEN", submittedAt: new Date(), version: { increment: 1 } } });
  await audit(tx, actor, { action: "request.submitted", targetType: "service_request", targetId: requestId });
  await emitEvent(tx, actor, { type: "request.submitted", aggregateType: "service_request", aggregateId: requestId, payload: { kind: request.kind } });
  return { id: requestId };
}

export async function listCustomerRequests(tx: Tx, actor: Actor, opts: { status?: string; page?: number } = {}) {
  if (!can.customerRead(actor)) throw forbidden();
  const statuses = ["DRAFT", "OPEN", "BOOKING", "CLOSED", "CANCELLED"] as const;
  const status = statuses.find((s) => s === opts.status);
  const where: Prisma.ServiceRequestWhereInput = { customerOrgId: actor.orgId, ...(status ? { status } : {}) };
  const page = opts.page ?? 1;
  const [items, total] = await Promise.all([
    tx.serviceRequest.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        equipment: { select: { label: true } },
        site: { select: { name: true } },
        _count: { select: { invitations: { where: { status: { in: ["INVITED", "OFFERED"] } } } } },
        bookings: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, status: true, reference: true } },
      },
    }),
    tx.serviceRequest.count({ where }),
  ]);
  const ids = items.map((i) => i.id);
  const offerCounts = ids.length
    ? await tx.offerVersion.groupBy({ by: ["requestId"], where: { requestId: { in: ids }, status: "ISSUED" }, _count: true })
    : [];
  const offersBy = new Map(offerCounts.map((o) => [o.requestId, o._count]));
  return { items: items.map((i) => ({ ...i, issuedOffers: offersBy.get(i.id) ?? 0 })), total, page, pageSize: PAGE_SIZE };
}

/** Full request view for the owning customer (or an administrator). */
export async function getRequestForCustomer(tx: Tx, actor: Actor, requestId: string) {
  if (!can.customerRead(actor) && !can.admin(actor)) throw forbidden();
  const request = await tx.serviceRequest.findFirst({
    where: { id: requestId, ...(can.admin(actor) ? {} : { customerOrgId: actor.orgId }) },
    include: {
      site: { select: { id: true, name: true, addressLine: true, city: true } },
      equipment: { select: { id: true, label: true, brand: true, model: true } },
      equipmentCategory: { select: { id: true, labelFr: true } },
      serviceArea: { select: { id: true, name: true, routingHours: true } },
      invitations: { orderBy: { createdAt: "asc" } },
      bookings: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          reference: true,
          status: true,
          offerVersionId: true,
          providerOrgId: true,
          scheduledStart: true,
          scheduledEnd: true,
          technicianName: true,
          confirmationDeadline: true,
          declineReason: true,
          cancelReason: true,
          workOrder: { select: { id: true, status: true } },
        },
      },
    },
  });
  if (!request) throw notFound("Demande");
  const providerIds = [...new Set(request.invitations.map((i) => i.providerOrgId))];
  const [profiles, offers, documents] = await Promise.all([
    providerIds.length
      ? tx.providerProfile.findMany({
          where: { providerOrgId: { in: providerIds } },
          select: {
            providerOrgId: true,
            slug: true,
            displayName: true,
            status: true,
            isDemo: true,
            checks: { where: { status: "VERIFIED" }, select: { type: true } },
          },
        })
      : [],
    tx.offer.findMany({
      where: { requestId },
      include: { versions: { where: { status: { not: "DRAFT" } }, orderBy: { versionNo: "desc" } } },
    }),
    tx.document.findMany({
      where: { requestId, status: { in: ["READY", "PENDING", "FAILED"] } },
      orderBy: { createdAt: "asc" },
      select: { id: true, originalName: true, kind: true, visibility: true, status: true, mimeType: true, sizeBytes: true, createdAt: true },
    }),
  ]);
  const ratings = providerIds.length
    ? await tx.review.groupBy({ by: ["providerOrgId"], where: { providerOrgId: { in: providerIds }, status: "PUBLISHED" }, _avg: { rating: true }, _count: true })
    : [];
  return {
    request,
    providers: new Map(profiles.map((p) => [p.providerOrgId, p])),
    ratings: new Map(ratings.map((r) => [r.providerOrgId, { avg: r._avg.rating, count: r._count }])),
    offers,
    documents,
  };
}

async function buildBrief(tx: Tx, requestId: string): Promise<RequestBrief> {
  const request = await tx.serviceRequest.findUniqueOrThrow({
    where: { id: requestId },
    include: { equipment: true, equipmentCategory: true, serviceArea: true },
  });
  const shared = await tx.document.count({ where: { requestId, visibility: "QUOTING_SHARED", status: "READY" } });
  return {
    reference: request.reference,
    kind: request.kind,
    title: request.title,
    symptoms: request.symptoms,
    city: request.city,
    serviceAreaName: request.serviceArea?.name ?? null,
    equipmentCategory: request.equipmentCategory.labelFr,
    equipmentCategoryId: request.equipmentCategoryId,
    brand: request.equipment.brand,
    model: request.equipment.model,
    installedYear: request.equipment.installedYear,
    preferredWindows: request.preferredWindows as PreferredWindow[],
    sharedAttachmentCount: shared,
    submittedAt: request.submittedAt?.toISOString() ?? null,
  };
}

/**
 * Invites up to three eligible providers (approved, handling the equipment category and,
 * for customers, the request's service area). Customers or routing administrators only.
 */
export async function inviteProviders(tx: Tx, actor: Actor, requestId: string, input: z.output<typeof inviteProvidersSchema>) {
  const admin = can.admin(actor);
  if (!admin) assertWriter(actor);
  // Administrators can read but not update a customer's request: they take the advisory lock only.
  const locked = admin ? await lockVisible(tx, "service_request", requestId) : await lockForUpdate(tx, "service_request", requestId);
  if (!locked) throw notFound("Demande");
  const request = await tx.serviceRequest.findUniqueOrThrow({ where: { id: requestId } });
  if (!admin && request.customerOrgId !== actor.orgId) throw notFound("Demande");
  if (request.status !== "OPEN") throw invalidTransition("Les invitations sont possibles uniquement pour une demande ouverte.");

  const uniqueIds = [...new Set(input.providerOrgIds)];
  const existing = await tx.requestInvitation.findMany({ where: { requestId } });
  const active = existing.filter((i) => i.status === "INVITED" || i.status === "OFFERED");
  const toCreate = uniqueIds.filter((id) => !existing.some((e) => e.providerOrgId === id));
  if (toCreate.length === 0) throw new DomainError("CONFLICT", "Ces prestataires ont déjà été invités.");
  if (active.length + toCreate.length > MAX_INVITATIONS) {
    throw validation("Trop de prestataires.", {
      providerOrgIds: [`${MAX_INVITATIONS} prestataires actifs maximum par demande (${active.length} déjà invité(s)).`],
    });
  }
  const eligible = await tx.providerProfile.findMany({
    where: {
      providerOrgId: { in: toCreate },
      status: "APPROVED",
      categories: { some: { equipmentCategoryId: request.equipmentCategoryId } },
      ...(!admin && request.serviceAreaId ? { serviceAreas: { some: { serviceAreaId: request.serviceAreaId } } } : {}),
    },
    select: { providerOrgId: true },
  });
  if (eligible.length !== toCreate.length) {
    throw validation("Prestataire non éligible.", { providerOrgIds: ["Un prestataire choisi n'est pas éligible pour cet équipement ou cette zone."] });
  }
  const brief = await buildBrief(tx, requestId);
  for (const providerOrgId of toCreate) {
    const invitation = await tx.requestInvitation.create({
      data: {
        requestId,
        customerOrgId: request.customerOrgId,
        providerOrgId,
        invitedById: actor.userId,
        invitedAsAdmin: admin,
        brief: brief as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    await emitEvent(tx, actor, { type: "request.invited", aggregateType: "request_invitation", aggregateId: invitation.id });
  }
  await audit(tx, actor, {
    action: admin ? "request.routed_by_admin" : "request.providers_invited",
    targetType: "service_request",
    targetId: requestId,
    metadata: { providers: toCreate.length },
  });
  return { invited: toCreate.length };
}

export async function revokeInvitation(tx: Tx, actor: Actor, invitationId: string) {
  assertWriter(actor);
  const invitation = await tx.requestInvitation.findFirst({ where: { id: invitationId, customerOrgId: actor.orgId } });
  if (!invitation) throw notFound("Invitation");
  if (!(await lockForUpdate(tx, "service_request", invitation.requestId))) throw notFound("Demande");
  if (!["INVITED", "OFFERED"].includes(invitation.status)) throw invalidTransition("Cette invitation n'est plus active.");
  const activeBooking = await tx.booking.count({
    where: { requestId: invitation.requestId, providerOrgId: invitation.providerOrgId, status: { in: ["PENDING_CONFIRMATION", "CONFIRMED", "COMPLETED"] } },
  });
  if (activeBooking) throw invalidTransition("Ce prestataire a une réservation active pour cette demande.");
  await tx.requestInvitation.update({ where: { id: invitationId }, data: { status: "REVOKED", respondedAt: new Date() } });
  const offer = await tx.offer.findUnique({ where: { invitationId } });
  if (offer) {
    await tx.offerVersion.updateMany({ where: { offerId: offer.id, status: "ISSUED" }, data: { status: "NOT_SELECTED" } });
    await tx.offer.update({ where: { id: offer.id }, data: { status: "CLOSED" } });
  }
  await audit(tx, actor, { action: "request.invitation_revoked", targetType: "request_invitation", targetId: invitationId });
}

export async function cancelRequest(tx: Tx, actor: Actor, requestId: string, reason: string) {
  assertWriter(actor);
  if (!(await lockForUpdate(tx, "service_request", requestId))) throw notFound("Demande");
  const request = await tx.serviceRequest.findUniqueOrThrow({ where: { id: requestId } });
  if (request.customerOrgId !== actor.orgId) throw notFound("Demande");
  if (!["DRAFT", "OPEN", "BOOKING"].includes(request.status)) throw invalidTransition("Cette demande est déjà clôturée.");
  const activeBooking = await tx.booking.count({ where: { requestId, status: { in: ["PENDING_CONFIRMATION", "CONFIRMED"] } } });
  if (activeBooking) throw invalidTransition("Annulez d'abord le rendez-vous en cours.");
  await tx.serviceRequest.update({
    where: { id: requestId },
    data: { status: "CANCELLED", cancelledAt: new Date(), cancelledById: actor.userId, cancelReason: reason, version: { increment: 1 } },
  });
  await tx.requestInvitation.updateMany({ where: { requestId, status: { in: ["INVITED", "OFFERED"] } }, data: { status: "CLOSED" } });
  await tx.offerVersion.updateMany({ where: { requestId, status: "ISSUED" }, data: { status: "NOT_SELECTED" } });
  await tx.offer.updateMany({ where: { requestId, status: "OPEN" }, data: { status: "CLOSED" } });
  await audit(tx, actor, { action: "request.cancelled", targetType: "service_request", targetId: requestId, reason });
}

/** After a decline, expiry, cancellation or no-show, the customer reopens the request to choose again. */
export async function reopenRequest(tx: Tx, actor: Actor, requestId: string) {
  assertWriter(actor);
  if (!(await lockForUpdate(tx, "service_request", requestId))) throw notFound("Demande");
  const request = await tx.serviceRequest.findUniqueOrThrow({ where: { id: requestId } });
  if (request.customerOrgId !== actor.orgId) throw notFound("Demande");
  if (request.status !== "BOOKING") throw invalidTransition("Seule une demande en cours de réservation peut être rouverte.");
  const active = await tx.booking.count({ where: { requestId, status: { in: ["PENDING_CONFIRMATION", "CONFIRMED", "COMPLETED"] } } });
  if (active) throw invalidTransition("Une réservation est toujours active pour cette demande.");
  await tx.serviceRequest.update({ where: { id: requestId }, data: { status: "OPEN", version: { increment: 1 } } });
  await audit(tx, actor, { action: "request.reopened", targetType: "service_request", targetId: requestId });
}

// --- Provider side -----------------------------------------------------------------------

export async function listProviderInvitations(tx: Tx, actor: Actor, opts: { status?: string; page?: number } = {}) {
  if (!can.providerManage(actor)) throw forbidden();
  const statuses = ["INVITED", "OFFERED", "DECLINED", "REVOKED", "CLOSED"] as const;
  const status = statuses.find((s) => s === opts.status);
  const where: Prisma.RequestInvitationWhereInput = { providerOrgId: actor.orgId, ...(status ? { status } : {}) };
  const page = opts.page ?? 1;
  const [items, total] = await Promise.all([
    tx.requestInvitation.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        offer: { include: { versions: { orderBy: { versionNo: "desc" }, take: 1, select: { status: true, versionNo: true, totalMinor: true } } } },
      },
    }),
    tx.requestInvitation.count({ where }),
  ]);
  return { items: items.map((i) => ({ ...i, brief: i.brief as unknown as RequestBrief })), total, page, pageSize: PAGE_SIZE };
}

export async function getInvitationForProvider(tx: Tx, actor: Actor, invitationId: string) {
  if (!can.providerManage(actor)) throw forbidden();
  const invitation = await tx.requestInvitation.findFirst({
    where: { id: invitationId, providerOrgId: actor.orgId },
    include: { offer: { include: { versions: { orderBy: { versionNo: "desc" } } } } },
  });
  if (!invitation) throw notFound("Invitation");
  const [attachments, booking] = await Promise.all([
    tx.document.findMany({
      where: { requestId: invitation.requestId, visibility: "QUOTING_SHARED", status: "READY" },
      select: { id: true, originalName: true, mimeType: true, kind: true },
    }),
    tx.booking.findFirst({
      where: { requestId: invitation.requestId, providerOrgId: actor.orgId },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true, reference: true },
    }),
  ]);
  return { invitation: { ...invitation, brief: invitation.brief as unknown as RequestBrief }, attachments, booking };
}

export async function declineInvitation(tx: Tx, actor: Actor, invitationId: string, reason: string | null) {
  if (!can.providerManage(actor)) throw forbidden();
  const invitation = await tx.requestInvitation.findFirst({ where: { id: invitationId, providerOrgId: actor.orgId } });
  if (!invitation) throw notFound("Invitation");
  if (invitation.status !== "INVITED") throw invalidTransition("Retirez d'abord votre offre émise, ou l'invitation n'est plus active.");
  await tx.requestInvitation.update({ where: { id: invitationId }, data: { status: "DECLINED", respondedAt: new Date(), declineReason: reason } });
  await audit(tx, actor, { action: "invitation.declined", targetType: "request_invitation", targetId: invitationId, reason });
  await emitEvent(tx, actor, { type: "invitation.declined", aggregateType: "request_invitation", aggregateId: invitationId });
}

// --- Routing desk (administrators) ----------------------------------------------------------

/** Open requests with no active invitation (breakdowns first), for human-assisted routing. */
export async function listUnmatchedRequests(tx: Tx, actor: Actor) {
  if (!can.admin(actor)) throw forbidden();
  const requests = await tx.serviceRequest.findMany({
    where: {
      status: "OPEN",
      invitations: { none: { status: { in: ["INVITED", "OFFERED"] } } },
    },
    orderBy: [{ kind: "asc" }, { submittedAt: "asc" }],
    take: 100,
    include: {
      equipmentCategory: { select: { id: true, labelFr: true } },
      serviceArea: { select: { id: true, name: true } },
      invitations: { select: { status: true, providerOrgId: true } },
    },
  });
  const breakdownFirst = [...requests].sort((a, b) => Number(b.kind === "BREAKDOWN") - Number(a.kind === "BREAKDOWN"));
  return breakdownFirst;
}
