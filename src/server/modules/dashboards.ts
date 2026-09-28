import "server-only";
import { type Actor, can } from "@/server/auth/roles";
import type { Tx } from "@/server/db/context";
import { forbidden } from "@/server/errors";
import { getEntitlement } from "./providers";

/** Customer "to do" view: every count comes from the database under row-level security. */
export async function customerDashboard(tx: Tx, actor: Actor) {
  if (!can.customerRead(actor)) throw forbidden();
  const org = actor.orgId;
  const now = new Date();
  const [openRequests, drafts, withOffers, pendingBookings, needsReopen, upcoming, approvals, toAcknowledge, openDisputes, plansProposed, equipmentCount, sitesCount] = await Promise.all([
    tx.serviceRequest.count({ where: { customerOrgId: org, status: "OPEN" } }),
    tx.serviceRequest.findMany({
      where: { customerOrgId: org, status: "DRAFT" },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, reference: true, title: true, source: true, createdAt: true },
    }),
    tx.serviceRequest.findMany({
      where: { customerOrgId: org, status: "OPEN", offers: { some: { versions: { some: { status: "ISSUED" } } } } },
      take: 5,
      select: { id: true, reference: true, title: true },
    }),
    tx.booking.findMany({
      where: { customerOrgId: org, status: "PENDING_CONFIRMATION" },
      take: 5,
      orderBy: { confirmationDeadline: "asc" },
      select: { id: true, reference: true, confirmationDeadline: true },
    }),
    tx.serviceRequest.findMany({
      where: { customerOrgId: org, status: "BOOKING", bookings: { none: { status: { in: ["PENDING_CONFIRMATION", "CONFIRMED", "COMPLETED"] } } } },
      take: 5,
      select: { id: true, reference: true, title: true },
    }),
    tx.booking.findMany({
      where: { customerOrgId: org, status: "CONFIRMED", scheduledStart: { gte: new Date(now.getTime() - 12 * 3600_000) } },
      orderBy: { scheduledStart: "asc" },
      take: 6,
      include: { workOrder: { select: { status: true } }, site: { select: { name: true } }, equipment: { select: { label: true } } },
    }),
    tx.repairQuoteVersion.findMany({
      where: { customerOrgId: org, status: "ISSUED" },
      take: 10,
      orderBy: { issuedAt: "asc" },
      include: { repairQuote: { include: { workOrder: { select: { bookingId: true, reference: true } } } } },
    }),
    tx.workOrder.findMany({
      where: { customerOrgId: org, status: "REPORT_SUBMITTED", acknowledgment: "PENDING" },
      take: 5,
      select: { id: true, reference: true, bookingId: true, completedAt: true },
    }),
    tx.dispute.count({ where: { customerOrgId: org, status: { in: ["OPEN", "UNDER_REVIEW"] } } }),
    tx.maintenancePlan.count({ where: { customerOrgId: org, status: "PROPOSED" } }),
    tx.equipment.count({ where: { customerOrgId: org, archivedAt: null } }),
    tx.site.count({ where: { customerOrgId: org, archivedAt: null } }),
  ]);
  return { openRequests, drafts, withOffers, pendingBookings, needsReopen, upcoming, approvals, toAcknowledge, openDisputes, plansProposed, equipmentCount, sitesCount };
}

export async function providerDashboard(tx: Tx, actor: Actor) {
  if (!can.providerManage(actor)) throw forbidden();
  const org = actor.orgId;
  const now = new Date();
  const [profile, newInvitations, pendingBookings, upcoming, awaitingDecision, awaitingParts, reportsDue, paymentsToConfirm, openDisputes, entitlement, technicians] = await Promise.all([
    tx.providerProfile.findFirst({ where: { providerOrgId: org }, select: { status: true, statusReason: true } }),
    tx.requestInvitation.findMany({ where: { providerOrgId: org, status: "INVITED" }, orderBy: { createdAt: "asc" }, take: 6 }),
    tx.booking.findMany({ where: { providerOrgId: org, status: "PENDING_CONFIRMATION" }, orderBy: { confirmationDeadline: "asc" }, take: 6 }),
    tx.booking.findMany({
      where: { providerOrgId: org, status: "CONFIRMED", scheduledStart: { gte: new Date(now.getTime() - 12 * 3600_000) } },
      orderBy: { scheduledStart: "asc" },
      take: 8,
      include: { workOrder: { select: { id: true, status: true } }, site: { select: { name: true, city: true } } },
    }),
    tx.workOrder.count({ where: { providerOrgId: org, status: "AWAITING_APPROVAL" } }),
    tx.workOrder.count({ where: { providerOrgId: org, status: "AWAITING_PARTS" } }),
    tx.workOrder.count({ where: { providerOrgId: org, status: { in: ["ON_SITE", "DIAGNOSED", "IN_PROGRESS"] } } }),
    tx.paymentRecord.count({ where: { providerOrgId: org, status: "REPORTED" } }),
    tx.dispute.count({ where: { providerOrgId: org, status: { in: ["OPEN", "UNDER_REVIEW"] } } }),
    getEntitlement(tx, org),
    tx.technicianProfile.count({ where: { providerOrgId: org, active: true } }),
  ]);
  return {
    profile,
    newInvitations: newInvitations.map((i) => ({ ...i, brief: i.brief as { reference: string; title: string; city: string; kind: string; equipmentCategory: string } })),
    pendingBookings,
    upcoming,
    awaitingDecision,
    awaitingParts,
    reportsDue,
    paymentsToConfirm,
    openDisputes,
    entitlement,
    technicians,
  };
}

/** Pending repair-quote decisions for the customer's approvals page. */
export async function pendingApprovals(tx: Tx, actor: Actor) {
  if (!can.customerRead(actor)) throw forbidden();
  return tx.repairQuoteVersion.findMany({
    where: { customerOrgId: actor.orgId, status: "ISSUED" },
    orderBy: { issuedAt: "asc" },
    include: {
      lines: { orderBy: { position: "asc" } },
      repairQuote: { include: { workOrder: { include: { equipment: { select: { label: true } }, site: { select: { name: true } }, booking: { select: { id: true, reference: true } } } } } },
    },
  });
}

/** Completed interventions (service history) across the customer's assets. */
export async function serviceHistory(tx: Tx, actor: Actor, opts: { equipmentId?: string; page?: number } = {}) {
  if (!can.customerRead(actor)) throw forbidden();
  const pageSize = 20;
  const page = opts.page ?? 1;
  const where = { customerOrgId: actor.orgId, status: "REPORT_SUBMITTED" as const, ...(opts.equipmentId ? { equipmentId: opts.equipmentId } : {}) };
  const [items, total] = await Promise.all([
    tx.workOrder.findMany({
      where,
      orderBy: { completedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        equipment: { select: { id: true, label: true } },
        site: { select: { name: true } },
        report: { select: { id: true, findings: true, workPerformed: true, nextServiceDate: true, repairDeclined: true } },
        booking: { select: { id: true, reference: true, technicianName: true, providerOrgId: true } },
      },
    }),
    tx.workOrder.count({ where }),
  ]);
  const providerIds = [...new Set(items.map((i) => i.booking.providerOrgId))];
  const orgs = providerIds.length ? await tx.organization.findMany({ where: { id: { in: providerIds } }, select: { id: true, name: true } }) : [];
  const names = new Map(orgs.map((o) => [o.id, o.name]));
  return { items: items.map((i) => ({ ...i, providerName: names.get(i.booking.providerOrgId) ?? "—" })), total, page, pageSize };
}

/** Documents visible to the acting organization (row-level security decides). */
export async function listVisibleDocuments(tx: Tx, actor: Actor, opts: { kind?: string; page?: number } = {}) {
  const kinds = ["PHOTO", "ATTACHMENT", "REPORT_PDF", "QUOTE_PDF", "PAYMENT_EVIDENCE"] as const;
  const kind = kinds.find((k) => k === opts.kind);
  const pageSize = 25;
  const page = opts.page ?? 1;
  const where = { status: "READY" as const, ...(kind ? { kind } : {}), OR: [{ customerOrgId: actor.orgId }, { providerOrgId: actor.orgId }, { ownerOrgId: actor.orgId }] };
  const [items, total] = await Promise.all([
    tx.document.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: { id: true, originalName: true, kind: true, visibility: true, mimeType: true, sizeBytes: true, createdAt: true, workOrderId: true, requestId: true, equipmentId: true },
    }),
    tx.document.count({ where }),
  ]);
  return { items, total, page, pageSize };
}
