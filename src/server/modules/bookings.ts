import "server-only";
import type { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { confirmBookingSchema, noShowSchema, rescheduleProposalSchema } from "@/lib/schemas";
import { localToUtc } from "@/lib/time";
import { type Actor, can } from "@/server/auth/roles";
import type { Tx } from "@/server/db/context";
import { DomainError, forbidden, invalidTransition, notFound, validation } from "@/server/errors";
import { audit, emitEvent } from "@/server/lib/infra";
import { lockForUpdate } from "@/server/lib/locks";
import { assertSlotAvailable } from "./technicians";
import { type JobEventType, recordJobEvent } from "./timeline";

const PAGE_SIZE = 15;

type Side = "CUSTOMER" | "PROVIDER";

function sideOf(actor: Actor): Side {
  if (actor.orgType === "CUSTOMER") return "CUSTOMER";
  if (actor.orgType === "PROVIDER") return "PROVIDER";
  throw forbidden();
}

function assertPartyWriter(actor: Actor, booking: { customerOrgId: string; providerOrgId: string }) {
  if (actor.orgType === "CUSTOMER" && booking.customerOrgId === actor.orgId && can.customerWrite(actor)) return;
  if (actor.orgType === "PROVIDER" && booking.providerOrgId === actor.orgId && can.providerManage(actor)) return;
  throw forbidden();
}

async function loadLocked(tx: Tx, bookingId: string) {
  if (!(await lockForUpdate(tx, "booking", bookingId))) throw notFound("Rendez-vous");
  return tx.booking.findUniqueOrThrow({ where: { id: bookingId }, include: { workOrder: true } });
}

function event(
  tx: Tx,
  actor: Actor,
  booking: { id: string; customerOrgId: string; providerOrgId: string; workOrder?: { id: string } | null },
  type: JobEventType,
  extra: Parameters<typeof recordJobEvent>[4] = {},
) {
  return recordJobEvent(
    tx,
    actor,
    { bookingId: booking.id, workOrderId: booking.workOrder?.id ?? null, customerOrgId: booking.customerOrgId, providerOrgId: booking.providerOrgId },
    type,
    extra,
  );
}

/**
 * Provider confirms a pending booking with a named technician and a concrete slot inside the
 * accepted offer window. One short transaction: lock booking → validate state, version and
 * deadline → validate technician availability → insert reservation (the exclusion constraint
 * rejects overlaps atomically) → confirm booking → create work order → outbox event.
 */
export async function confirmBooking(tx: Tx, actor: Actor, bookingId: string, input: z.output<typeof confirmBookingSchema>) {
  if (!can.providerManage(actor)) throw forbidden();
  const booking = await loadLocked(tx, bookingId);
  if (booking.providerOrgId !== actor.orgId) throw notFound("Rendez-vous");
  if (booking.lockVersion !== input.expectedLockVersion) {
    throw new DomainError("VERSION_CONFLICT", "Ce rendez-vous a changé entre-temps. Actualisez la page.");
  }
  if (booking.status !== "PENDING_CONFIRMATION") throw invalidTransition("Ce rendez-vous n'est plus en attente de confirmation.");
  if (booking.confirmationDeadline.getTime() <= Date.now()) {
    throw invalidTransition("Le délai de confirmation est dépassé. Le client doit choisir à nouveau.");
  }
  const version = await tx.offerVersion.findUniqueOrThrow({ where: { id: booking.offerVersionId } });
  if (version.status !== "SELECTED") throw invalidTransition("L'offre retenue n'est plus valide.");

  const startsAt = localToUtc(input.date, input.start);
  const endsAt = new Date(startsAt.getTime() + input.durationMin * 60_000);
  if (booking.windowStart && booking.windowEnd && (startsAt < booking.windowStart || endsAt > booking.windowEnd)) {
    throw validation("Hors fenêtre.", { start: ["Le créneau doit se situer dans la fenêtre proposée dans votre offre."] });
  }
  const request = await tx.serviceRequest.findUniqueOrThrow({ where: { id: booking.requestId }, select: { equipmentCategoryId: true } });
  await assertSlotAvailable(tx, actor.orgId, input.technicianId, startsAt, endsAt, request.equipmentCategoryId);
  const technician = await tx.technicianProfile.findUniqueOrThrow({ where: { id: input.technicianId } });

  await tx.appointmentReservation.create({
    data: {
      providerOrgId: actor.orgId,
      technicianId: technician.id,
      bookingId: booking.id,
      startsAt,
      endsAt,
      bufferBeforeMin: input.bufferBeforeMin,
      bufferAfterMin: input.bufferAfterMin,
      blockedStart: new Date(startsAt.getTime() - input.bufferBeforeMin * 60_000),
      blockedEnd: new Date(endsAt.getTime() + input.bufferAfterMin * 60_000),
      createdById: actor.userId,
    },
    select: { id: true },
  });
  const confirmedAt = new Date();
  await tx.booking.update({
    where: { id: booking.id },
    data: {
      status: "CONFIRMED",
      technicianId: technician.id,
      technicianName: technician.displayName,
      scheduledStart: startsAt,
      scheduledEnd: endsAt,
      confirmedAt,
      confirmedById: actor.userId,
      lockVersion: { increment: 1 },
    },
  });
  const workOrder = await tx.workOrder.create({
    data: {
      bookingId: booking.id,
      customerOrgId: booking.customerOrgId,
      providerOrgId: booking.providerOrgId,
      technicianId: technician.id,
      siteId: booking.siteId,
      equipmentId: booking.equipmentId,
      kind: booking.kind,
      maintenanceScopeAuthorized: booking.kind === "MAINTENANCE",
    },
    select: { id: true, reference: true },
  });
  await event(tx, actor, { ...booking, workOrder }, "BOOKING_CONFIRMED", {
    fromStatus: "PENDING_CONFIRMATION",
    toStatus: "CONFIRMED",
    metadata: { technicianName: technician.displayName, start: startsAt.toISOString(), end: endsAt.toISOString() },
  });
  await audit(tx, actor, { action: "booking.confirmed", targetType: "booking", targetId: booking.id });
  await emitEvent(tx, actor, { type: "booking.confirmed", aggregateType: "booking", aggregateId: booking.id });
  return { bookingId: booking.id, workOrderId: workOrder.id, workOrderReference: workOrder.reference };
}

async function releaseSelection(tx: Tx, booking: { offerVersionId: string; offerId: string }) {
  await tx.offerVersion.updateMany({ where: { id: booking.offerVersionId, status: "SELECTED" }, data: { status: "RELEASED" } });
  await tx.offer.updateMany({ where: { id: booking.offerId, status: "SELECTED" }, data: { status: "CLOSED" } });
}

async function releaseReservation(tx: Tx, bookingId: string, reason: string) {
  await tx.appointmentReservation.updateMany({
    where: { bookingId, status: "ACTIVE" },
    data: { status: "RELEASED", releasedAt: new Date(), releaseReason: reason },
  });
}

export async function declineBooking(tx: Tx, actor: Actor, bookingId: string, reason: string) {
  if (!can.providerManage(actor)) throw forbidden();
  const booking = await loadLocked(tx, bookingId);
  if (booking.providerOrgId !== actor.orgId) throw notFound("Rendez-vous");
  if (booking.status !== "PENDING_CONFIRMATION") throw invalidTransition("Seul un rendez-vous en attente peut être décliné.");
  await tx.booking.update({
    where: { id: booking.id },
    data: { status: "DECLINED", declinedAt: new Date(), declineReason: reason, lockVersion: { increment: 1 } },
  });
  await releaseSelection(tx, booking);
  await event(tx, actor, booking, "BOOKING_DECLINED", { fromStatus: booking.status, toStatus: "DECLINED", note: reason });
  await audit(tx, actor, { action: "booking.declined", targetType: "booking", targetId: booking.id, reason });
  await emitEvent(tx, actor, { type: "booking.declined", aggregateType: "booking", aggregateId: booking.id });
}

/**
 * Either party cancels before work has started on site. Records who and why, releases
 * capacity and never creates a financial charge: the agreed cancellation terms are shown
 * for the parties to settle directly.
 */
export async function cancelBooking(tx: Tx, actor: Actor, bookingId: string, reason: string) {
  const booking = await loadLocked(tx, bookingId);
  assertPartyWriter(actor, booking);
  if (!["PENDING_CONFIRMATION", "CONFIRMED"].includes(booking.status)) throw invalidTransition("Ce rendez-vous ne peut plus être annulé.");
  if (booking.workOrder && !["SCHEDULED", "EN_ROUTE"].includes(booking.workOrder.status)) {
    throw invalidTransition("L'intervention a commencé sur site : utilisez le rapport ou un litige.");
  }
  const side = sideOf(actor);
  await tx.booking.update({
    where: { id: booking.id },
    data: { status: "CANCELLED", cancelledAt: new Date(), cancelledById: actor.userId, cancelledBySide: side, cancelReason: reason, lockVersion: { increment: 1 } },
  });
  await releaseReservation(tx, booking.id, "CANCELLED");
  if (booking.workOrder) {
    await tx.workOrder.update({ where: { id: booking.workOrder.id }, data: { status: "CANCELLED", lockVersion: { increment: 1 } } });
  }
  await releaseSelection(tx, booking);
  await tx.rescheduleProposal.updateMany({ where: { bookingId: booking.id, status: "PENDING" }, data: { status: "WITHDRAWN" } });
  await event(tx, actor, booking, "BOOKING_CANCELLED", { fromStatus: booking.status, toStatus: "CANCELLED", note: reason });
  await audit(tx, actor, { action: "booking.cancelled", targetType: "booking", targetId: booking.id, reason });
  await emitEvent(tx, actor, { type: "booking.cancelled", aggregateType: "booking", aggregateId: booking.id });
}

export async function reportNoShow(tx: Tx, actor: Actor, bookingId: string, input: z.output<typeof noShowSchema>) {
  const booking = await loadLocked(tx, bookingId);
  assertPartyWriter(actor, booking);
  if (booking.status !== "CONFIRMED" || !booking.scheduledStart) throw invalidTransition("Seul un rendez-vous confirmé peut faire l'objet d'une absence.");
  if (booking.scheduledStart.getTime() > Date.now()) throw invalidTransition("L'heure du rendez-vous n'est pas encore passée.");
  if (input.absentSide === sideOf(actor)) throw validation("Absence invalide.", { absentSide: ["Signalez l'absence de l'autre partie."] });
  if (booking.workOrder && !["SCHEDULED", "EN_ROUTE"].includes(booking.workOrder.status)) {
    throw invalidTransition("Le technicien a été enregistré sur site pour ce rendez-vous.");
  }
  await tx.booking.update({
    where: { id: booking.id },
    data: { status: "NO_SHOW", noShowAt: new Date(), noShowSide: input.absentSide, noShowReportedById: actor.userId, noShowNote: input.note, lockVersion: { increment: 1 } },
  });
  await releaseReservation(tx, booking.id, "NO_SHOW");
  if (booking.workOrder) await tx.workOrder.update({ where: { id: booking.workOrder.id }, data: { status: "CANCELLED", lockVersion: { increment: 1 } } });
  await releaseSelection(tx, booking);
  await event(tx, actor, booking, "NO_SHOW_REPORTED", { fromStatus: "CONFIRMED", toStatus: "NO_SHOW", note: input.note, metadata: { absentSide: input.absentSide } });
  await audit(tx, actor, { action: "booking.no_show", targetType: "booking", targetId: booking.id, reason: input.note });
  await emitEvent(tx, actor, { type: "booking.no_show", aggregateType: "booking", aggregateId: booking.id });
}

export async function proposeReschedule(tx: Tx, actor: Actor, bookingId: string, input: z.output<typeof rescheduleProposalSchema>) {
  const booking = await loadLocked(tx, bookingId);
  assertPartyWriter(actor, booking);
  if (booking.status !== "CONFIRMED" || !booking.workOrder || booking.workOrder.status !== "SCHEDULED") {
    throw invalidTransition("Seul un rendez-vous confirmé et non commencé peut être replanifié.");
  }
  const startsAt = localToUtc(input.date, input.start);
  const endsAt = new Date(startsAt.getTime() + input.durationMin * 60_000);
  if (startsAt.getTime() <= Date.now()) throw validation("Créneau passé.", { date: ["Proposez un créneau dans le futur."] });
  const side = sideOf(actor);
  let technicianId: string | null = null;
  let technicianName: string | null = null;
  if (side === "PROVIDER") {
    technicianId = input.technicianId ?? booking.technicianId;
    if (!technicianId) throw validation("Technicien requis.", { technicianId: ["Choisissez un technicien."] });
    const request = await tx.serviceRequest.findUniqueOrThrow({ where: { id: booking.requestId }, select: { equipmentCategoryId: true } });
    await assertSlotAvailable(tx, actor.orgId, technicianId, startsAt, endsAt, request.equipmentCategoryId);
    technicianName = (await tx.technicianProfile.findUniqueOrThrow({ where: { id: technicianId } })).displayName;
  }
  const pending = await tx.rescheduleProposal.count({ where: { bookingId, status: "PENDING" } });
  if (pending) throw new DomainError("CONFLICT", "Une proposition de replanification est déjà en attente.");
  const proposal = await tx.rescheduleProposal.create({
    data: {
      bookingId,
      customerOrgId: booking.customerOrgId,
      providerOrgId: booking.providerOrgId,
      proposedBySide: side,
      proposedById: actor.userId,
      startsAt,
      endsAt,
      technicianId,
      technicianName,
      reason: input.reason,
    },
    select: { id: true },
  });
  await event(tx, actor, booking, "RESCHEDULE_PROPOSED", { note: input.reason, metadata: { start: startsAt.toISOString(), end: endsAt.toISOString() } });
  await emitEvent(tx, actor, { type: "booking.reschedule_proposed", aggregateType: "reschedule_proposal", aggregateId: proposal.id });
  return proposal;
}

/**
 * The other party accepts or rejects. On acceptance the old reservation is released and the
 * new one inserted in the SAME transaction: if the new slot conflicts, everything rolls back
 * and the original confirmed slot is untouched.
 */
export async function respondToReschedule(
  tx: Tx,
  actor: Actor,
  proposalId: string,
  accept: boolean,
  opts: { note?: string | null; technicianId?: string | null; bufferBeforeMin?: number; bufferAfterMin?: number } = {},
) {
  if (!(await lockForUpdate(tx, "reschedule_proposal", proposalId))) throw notFound("Proposition");
  const proposal = await tx.rescheduleProposal.findUniqueOrThrow({ where: { id: proposalId } });
  const booking = await loadLocked(tx, proposal.bookingId);
  assertPartyWriter(actor, booking);
  if (proposal.status !== "PENDING") throw invalidTransition("Cette proposition a déjà reçu une réponse.");
  if (proposal.proposedBySide === sideOf(actor)) throw forbidden("La réponse doit venir de l'autre partie.");
  if (!accept) {
    await tx.rescheduleProposal.update({ where: { id: proposalId }, data: { status: "REJECTED", respondedById: actor.userId, respondedAt: new Date(), responseNote: opts.note ?? null } });
    await event(tx, actor, booking, "RESCHEDULE_REJECTED", { note: opts.note ?? null });
    await emitEvent(tx, actor, { type: "booking.reschedule_rejected", aggregateType: "reschedule_proposal", aggregateId: proposalId });
    return { accepted: false };
  }
  if (booking.status !== "CONFIRMED" || !booking.workOrder || booking.workOrder.status !== "SCHEDULED") {
    throw invalidTransition("Le rendez-vous ne peut plus être replanifié.");
  }
  if (proposal.startsAt.getTime() <= Date.now()) throw invalidTransition("Le créneau proposé est passé.");

  let technicianId = proposal.technicianId ?? booking.technicianId!;
  let technicianName = proposal.technicianName ?? booking.technicianName;
  if (sideOf(actor) === "PROVIDER") {
    // Provider accepting a customer proposal chooses/validates the technician now.
    technicianId = opts.technicianId ?? technicianId;
    const request = await tx.serviceRequest.findUniqueOrThrow({ where: { id: booking.requestId }, select: { equipmentCategoryId: true } });
    await assertSlotAvailable(tx, actor.orgId, technicianId, proposal.startsAt, proposal.endsAt, request.equipmentCategoryId);
    technicianName = (await tx.technicianProfile.findUniqueOrThrow({ where: { id: technicianId } })).displayName;
  }
  const old = await tx.appointmentReservation.findFirst({ where: { bookingId: booking.id, status: "ACTIVE" } });
  const before = opts.bufferBeforeMin ?? old?.bufferBeforeMin ?? 30;
  const after = opts.bufferAfterMin ?? old?.bufferAfterMin ?? 30;
  await releaseReservation(tx, booking.id, "RESCHEDULED");
  await tx.appointmentReservation.create({
    data: {
      providerOrgId: booking.providerOrgId,
      technicianId,
      bookingId: booking.id,
      startsAt: proposal.startsAt,
      endsAt: proposal.endsAt,
      bufferBeforeMin: before,
      bufferAfterMin: after,
      blockedStart: new Date(proposal.startsAt.getTime() - before * 60_000),
      blockedEnd: new Date(proposal.endsAt.getTime() + after * 60_000),
      createdById: actor.userId,
    },
    select: { id: true },
  });
  await tx.booking.update({
    where: { id: booking.id },
    data: {
      scheduledStart: proposal.startsAt,
      scheduledEnd: proposal.endsAt,
      technicianId,
      technicianName,
      lockVersion: { increment: 1 },
    },
  });
  await tx.workOrder.update({ where: { id: booking.workOrder.id }, data: { technicianId, lockVersion: { increment: 1 } } });
  await tx.rescheduleProposal.update({ where: { id: proposalId }, data: { status: "ACCEPTED", respondedById: actor.userId, respondedAt: new Date(), responseNote: opts.note ?? null } });
  await event(tx, actor, booking, "RESCHEDULE_ACCEPTED", {
    metadata: { from: booking.scheduledStart?.toISOString() ?? null, to: proposal.startsAt.toISOString(), technicianName },
  });
  await audit(tx, actor, { action: "booking.rescheduled", targetType: "booking", targetId: booking.id });
  await emitEvent(tx, actor, { type: "booking.rescheduled", aggregateType: "booking", aggregateId: booking.id });
  return { accepted: true };
}

export async function withdrawReschedule(tx: Tx, actor: Actor, proposalId: string) {
  const proposal = await tx.rescheduleProposal.findUnique({ where: { id: proposalId } });
  if (!proposal) throw notFound("Proposition");
  assertPartyWriter(actor, proposal);
  if (proposal.proposedBySide !== sideOf(actor) || proposal.status !== "PENDING") throw invalidTransition("Proposition non modifiable.");
  await tx.rescheduleProposal.update({ where: { id: proposalId }, data: { status: "WITHDRAWN", respondedAt: new Date() } });
}

// --- Reads ----------------------------------------------------------------------------------

export async function listBookings(
  tx: Tx,
  actor: Actor,
  opts: { status?: string; page?: number; scope?: "upcoming" | "pending" | "all" } = {},
) {
  const statuses = ["PENDING_CONFIRMATION", "CONFIRMED", "DECLINED", "EXPIRED", "CANCELLED", "NO_SHOW", "COMPLETED"] as const;
  const status = statuses.find((s) => s === opts.status);
  const where: Prisma.BookingWhereInput = {
    ...(actor.orgType === "CUSTOMER" ? { customerOrgId: actor.orgId } : { providerOrgId: actor.orgId }),
    ...(status ? { status } : {}),
  };
  const page = opts.page ?? 1;
  const [items, total] = await Promise.all([
    tx.booking.findMany({
      where,
      orderBy: [{ scheduledStart: { sort: "desc", nulls: "first" } }, { createdAt: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        offerVersion: { select: { totalMinor: true, currency: true, versionNo: true } },
        workOrder: { select: { id: true, reference: true, status: true, acknowledgment: true } },
      },
    }),
    tx.booking.count({ where }),
  ]);
  const orgIds = [...new Set(items.flatMap((b) => [b.customerOrgId, b.providerOrgId]))];
  const orgs = orgIds.length ? await tx.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } }) : [];
  const names = new Map(orgs.map((o) => [o.id, o.name]));
  return {
    items: items.map((b) => ({ ...b, customerName: names.get(b.customerOrgId) ?? "—", providerName: names.get(b.providerOrgId) ?? "—" })),
    total,
    page,
    pageSize: PAGE_SIZE,
  };
}

/** Shared booking / work-order view with role-appropriate projections. */
export async function getBookingDetail(tx: Tx, actor: Actor, bookingId: string) {
  const booking = await tx.booking.findFirst({
    where: { id: bookingId },
    include: {
      offerVersion: true,
      workOrder: {
        include: {
          repairQuotes: {
            orderBy: { sequenceNo: "asc" },
            include: {
              versions: { orderBy: { versionNo: "desc" }, include: { lines: { orderBy: { position: "asc" } }, approval: true } },
            },
          },
          report: true,
          notes: { orderBy: { createdAt: "asc" } },
          disputes: { orderBy: { createdAt: "desc" }, include: { events: { orderBy: { createdAt: "asc" } } } },
        },
      },
      events: { orderBy: { occurredAt: "asc" } },
      reschedules: { orderBy: { createdAt: "desc" } },
      review: { include: { response: true } },
    },
  });
  if (!booking) throw notFound("Rendez-vous");
  const isCustomer = booking.customerOrgId === actor.orgId;
  const isProvider = booking.providerOrgId === actor.orgId;
  if (!isCustomer && !isProvider && !can.admin(actor)) throw notFound("Rendez-vous");

  const [request, site, equipment, orgs, documents, plan] = await Promise.all([
    tx.serviceRequest.findUnique({
      where: { id: booking.requestId },
      select: { id: true, reference: true, title: true, symptoms: true, kind: true, preferredWindows: true, equipmentCategory: { select: { labelFr: true } } },
    }),
    tx.site.findUnique({ where: { id: booking.siteId }, select: { id: true, name: true, addressLine: true, city: true, accessNotes: true, contactName: true, contactPhone: true } }),
    tx.equipment.findUnique({ where: { id: booking.equipmentId }, select: { id: true, label: true, brand: true, model: true, serialNumber: true, installedYear: true } }),
    tx.organization.findMany({ where: { id: { in: [booking.customerOrgId, booking.providerOrgId] } }, select: { id: true, name: true } }),
    booking.workOrder
      ? tx.document.findMany({
          where: { workOrderId: booking.workOrder.id, status: { in: ["READY", "PENDING", "FAILED"] } },
          orderBy: { createdAt: "asc" },
          select: { id: true, originalName: true, kind: true, visibility: true, status: true, mimeType: true, reportId: true, repairQuoteVersionId: true, ownerOrgId: true, createdAt: true },
        })
      : [],
    tx.maintenancePlan.findFirst({
      where: { equipmentId: booking.equipmentId, providerOrgId: booking.providerOrgId, status: { in: ["PROPOSED", "ACTIVE", "PAUSED"] } },
      select: { id: true, status: true, title: true, intervalMonths: true, nextDueDate: true },
    }),
  ]);
  const names = new Map(orgs.map((o) => [o.id, o.name]));
  // Site access details are shared with the provider only once the appointment is confirmed.
  const showAccess = isCustomer || can.admin(actor) || ["CONFIRMED", "COMPLETED"].includes(booking.status);
  return {
    booking,
    request,
    site: site ? { ...site, accessNotes: showAccess ? site.accessNotes : null, contactName: showAccess ? site.contactName : null, contactPhone: showAccess ? site.contactPhone : null } : null,
    equipment,
    customerName: names.get(booking.customerOrgId) ?? "—",
    providerName: names.get(booking.providerOrgId) ?? "—",
    documents,
    plan,
    viewer: { isCustomer, isProvider, isAdmin: can.admin(actor) },
  };
}
