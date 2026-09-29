import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import { formatMoney } from "@/lib/money";
import { formatDateTime, durationLabel } from "@/lib/time";
import { te } from "@/lib/i18n";
import { getEnv } from "@/server/env";
import { photoForPdf } from "@/server/pdf/images";
import { renderQuotePdf, renderReportPdf } from "@/server/pdf/render";
import { getStorage } from "@/server/storage";
import {
  CUSTOMER_ALL,
  CUSTOMER_WRITERS,
  PROVIDER_MANAGERS,
  adminRecipients,
  notify,
  orgRecipients,
  technicianRecipient,
} from "./notify";

export type OutboxRow = {
  id: string;
  type: string;
  aggregate_type: string;
  aggregate_id: string;
  payload: Record<string, unknown>;
  actor_user_id: string | null;
  actor_org_id: string | null;
};

type Handler = (db: PrismaClient, e: OutboxRow) => Promise<void>;

async function orgName(db: PrismaClient, id: string) {
  return (await db.organization.findUnique({ where: { id }, select: { name: true } }))?.name ?? "—";
}

async function bookingContext(db: PrismaClient, bookingId: string) {
  return db.booking.findUniqueOrThrow({ where: { id: bookingId }, include: { workOrder: { select: { id: true, reference: true, technicianId: true } } } });
}

const custBooking = (id: string) => `/client/rendez-vous/${id}`;
const provBooking = (id: string) => `/prestataire/rendez-vous/${id}`;
const techJob = (woId: string) => `/technicien/interventions/${woId}`;

/** Worker-side PDF generation for a submitted report (idempotent: deterministic key + unique index). */
export async function generateReportPdf(db: PrismaClient, reportId: string) {
  const report = await db.serviceReport.findUniqueOrThrow({
    where: { id: reportId },
    include: {
      workOrder: {
        include: {
          booking: true,
          site: true,
          equipment: true,
          repairQuotes: { include: { versions: { where: { status: "APPROVED" }, include: { approval: true } } } },
        },
      },
    },
  });
  const existing = await db.document.findFirst({ where: { reportId, kind: "REPORT_PDF", status: { not: "DELETED" } } });
  if (existing) return existing.id;
  const wo = report.workOrder;
  const photos = await db.document.findMany({ where: { reportId, kind: "PHOTO", status: "READY" }, orderBy: { createdAt: "asc" }, take: 8 });
  const storage = getStorage();
  // Every photo (JPEG, PNG, WebP) is decoded and re-encoded as a clean JPEG before embedding:
  // pdfkit then never parses an uploaded file directly, and EXIF/GPS metadata is dropped.
  const photoData = [];
  for (const p of photos) {
    const original = await storage.get(p.storageKey).catch(() => null);
    photoData.push({ name: p.originalName, data: original ? await photoForPdf(original) : null });
  }
  const env = getEnv();
  const approvedScopes = wo.repairQuotes.flatMap((q) =>
    q.versions
      .filter((v) => report.approvedVersionIds.includes(v.id) && v.approval)
      .map((v) => ({ title: q.title, versionNo: v.versionNo, totalMinor: v.totalMinor, currency: v.currency, decidedAt: v.approval!.decidedAt, snapshotHash: v.snapshotHash! })),
  );
  const pdf = await renderReportPdf({
    appName: env.APP_NAME,
    workOrderReference: wo.reference,
    bookingReference: wo.booking.reference,
    customerName: await orgName(db, wo.customerOrgId),
    providerName: await orgName(db, wo.providerOrgId),
    siteName: wo.site.name,
    siteCity: wo.site.city,
    equipment: [wo.equipment.label, wo.equipment.brand, wo.equipment.model].filter(Boolean).join(" · "),
    technicianName: wo.booking.technicianName,
    scheduledStart: wo.booking.scheduledStart,
    submittedAt: report.submittedAt,
    submittedByName: report.submittedByName,
    findings: report.findings,
    workPerformed: report.workPerformed,
    partsUsed: report.partsUsed,
    recommendations: report.recommendations,
    nextServiceDate: report.nextServiceDate,
    repairDeclined: report.repairDeclined,
    approvedScopes,
    photos: photoData,
    snapshotHash: report.snapshotHash,
  });
  const storageKey = `generated/report-${report.id}`;
  await storage.put(storageKey, pdf, "application/pdf");
  await db.document.createMany({
    data: [
      {
        ownerOrgId: wo.providerOrgId,
        customerOrgId: wo.customerOrgId,
        providerOrgId: wo.providerOrgId,
        workOrderId: wo.id,
        reportId: report.id,
        kind: "REPORT_PDF",
        visibility: "SHARED_PARTIES",
        status: "READY",
        storageKey,
        originalName: `rapport-${wo.reference}.pdf`,
        mimeType: "application/pdf",
        sizeBytes: pdf.length,
        finalizedAt: new Date(),
      },
    ],
    skipDuplicates: true,
  });
  return null;
}

export async function generateQuotePdf(db: PrismaClient, versionId: string) {
  const version = await db.repairQuoteVersion.findUniqueOrThrow({
    where: { id: versionId },
    include: { lines: { orderBy: { position: "asc" } }, repairQuote: { include: { workOrder: { include: { equipment: true } } } } },
  });
  if (version.status === "DRAFT" || !version.issuedAt || !version.snapshotHash) return;
  const existing = await db.document.findFirst({ where: { repairQuoteVersionId: versionId, kind: "QUOTE_PDF", status: { not: "DELETED" } } });
  if (existing) return;
  const wo = version.repairQuote.workOrder;
  const env = getEnv();
  const pdf = await renderQuotePdf({
    appName: env.APP_NAME,
    title: version.repairQuote.title,
    workOrderReference: wo.reference,
    versionNo: version.versionNo,
    customerName: await orgName(db, wo.customerOrgId),
    providerName: await orgName(db, wo.providerOrgId),
    equipment: [wo.equipment.label, wo.equipment.brand, wo.equipment.model].filter(Boolean).join(" · "),
    scopeSummary: version.scopeSummary,
    estimatedDuration: version.estimatedDurationMin ? durationLabel(version.estimatedDurationMin) : null,
    timingNote: version.timingNote,
    exclusions: version.exclusions,
    warrantyTerms: version.warrantyTerms,
    validUntil: version.validUntil,
    issuedAt: version.issuedAt,
    currency: version.currency,
    lines: version.lines,
    subtotalMinor: version.subtotalMinor,
    taxMinor: version.taxMinor,
    totalMinor: version.totalMinor,
    snapshotHash: version.snapshotHash,
  });
  const storageKey = `generated/quote-${version.id}`;
  await getStorage().put(storageKey, pdf, "application/pdf");
  await db.document.createMany({
    data: [
      {
        ownerOrgId: wo.providerOrgId,
        customerOrgId: wo.customerOrgId,
        providerOrgId: wo.providerOrgId,
        workOrderId: wo.id,
        repairQuoteVersionId: version.id,
        kind: "QUOTE_PDF",
        visibility: "SHARED_PARTIES",
        status: "READY",
        storageKey,
        originalName: `devis-${wo.reference}-v${version.versionNo}.pdf`,
        mimeType: "application/pdf",
        sizeBytes: pdf.length,
        finalizedAt: new Date(),
      },
    ],
    skipDuplicates: true,
  });
}

/** After confirmation, competing offers are closed and their providers told (no prices disclosed). */
async function closeCompetingOffers(db: PrismaClient, e: OutboxRow, booking: { id: string; requestId: string; providerOrgId: string; status: string }) {
  if (!["CONFIRMED", "COMPLETED"].includes(booking.status)) return;
  const losers = await db.requestInvitation.findMany({
    where: { requestId: booking.requestId, providerOrgId: { not: booking.providerOrgId }, status: { in: ["INVITED", "OFFERED"] } },
    select: { id: true, providerOrgId: true },
  });
  await db.offerVersion.updateMany({
    where: { requestId: booking.requestId, providerOrgId: { not: booking.providerOrgId }, status: "ISSUED" },
    data: { status: "NOT_SELECTED" },
  });
  await db.offer.updateMany({ where: { requestId: booking.requestId, providerOrgId: { not: booking.providerOrgId }, status: { in: ["OPEN", "WITHDRAWN"] } }, data: { status: "CLOSED" } });
  await db.requestInvitation.updateMany({ where: { id: { in: losers.map((l) => l.id) } }, data: { status: "CLOSED" } });
  for (const loser of losers) {
    await notify(db, e.id, await orgRecipients(db, loser.providerOrgId, PROVIDER_MANAGERS), {
      key: "invitationClosed",
      link: `/prestataire/invitations/${loser.id}`,
    });
  }
}

export const handlers: Record<string, Handler> = {
  "request.submitted": async (db, e) => {
    const request = await db.serviceRequest.findUniqueOrThrow({ where: { id: e.aggregate_id } });
    if (request.kind !== "BREAKDOWN") return;
    await notify(db, e.id, await adminRecipients(db), { key: "breakdownToRoute", vars: { ref: request.reference, city: request.city }, link: `/admin/routage/${request.id}`, email: true });
  },
  "request.invited": async (db, e) => {
    const inv = await db.requestInvitation.findUniqueOrThrow({ where: { id: e.aggregate_id } });
    const brief = inv.brief as { reference: string; city: string; kind: string };
    await notify(db, e.id, await orgRecipients(db, inv.providerOrgId, PROVIDER_MANAGERS), {
      key: "newInvitation",
      vars: { ref: brief.reference, city: brief.city, kind: te("enums.requestKind", brief.kind) },
      link: `/prestataire/invitations/${inv.id}`,
      email: true,
    });
  },
  "invitation.declined": async (db, e) => {
    const inv = await db.requestInvitation.findUniqueOrThrow({ where: { id: e.aggregate_id } });
    await notify(db, e.id, await orgRecipients(db, inv.customerOrgId, CUSTOMER_WRITERS), {
      key: "invitationDeclined",
      vars: { provider: await orgName(db, inv.providerOrgId) },
      link: `/client/demandes/${inv.requestId}`,
    });
  },
  "offer.issued": async (db, e) => {
    const v = await db.offerVersion.findUniqueOrThrow({ where: { id: e.aggregate_id } });
    await notify(db, e.id, await orgRecipients(db, v.customerOrgId, CUSTOMER_ALL), {
      key: v.versionNo > 1 ? "offerRevised" : "offerReceived",
      vars: { provider: await orgName(db, v.providerOrgId), total: formatMoney(v.totalMinor, v.currency) },
      link: `/client/demandes/${v.requestId}`,
      email: true,
    });
  },
  "offer.withdrawn": async (db, e) => {
    const offer = await db.offer.findUniqueOrThrow({ where: { id: e.aggregate_id } });
    await notify(db, e.id, await orgRecipients(db, offer.customerOrgId, CUSTOMER_WRITERS), {
      key: "offerWithdrawn",
      vars: { provider: await orgName(db, offer.providerOrgId) },
      link: `/client/demandes/${offer.requestId}`,
    });
  },
  "booking.requested": async (db, e) => {
    const b = await bookingContext(db, e.aggregate_id);
    await notify(db, e.id, await orgRecipients(db, b.providerOrgId, PROVIDER_MANAGERS), {
      key: "bookingRequested",
      vars: { ref: b.reference, deadline: formatDateTime(b.confirmationDeadline) },
      link: provBooking(b.id),
      email: true,
    });
  },
  "booking.confirmed": async (db, e) => {
    const b = await bookingContext(db, e.aggregate_id);
    await closeCompetingOffers(db, e, b);
    const vars = { ref: b.reference, date: formatDateTime(b.scheduledStart), technician: b.technicianName ?? "—" };
    await notify(db, e.id, await orgRecipients(db, b.customerOrgId, CUSTOMER_ALL), { key: "bookingConfirmed", vars, link: custBooking(b.id), email: true });
    if (b.workOrder) {
      await notify(db, e.id, await technicianRecipient(db, b.workOrder.technicianId), {
        key: "jobAssigned",
        vars,
        link: techJob(b.workOrder.id),
        email: true,
        excludeUserId: e.actor_user_id,
      });
    }
  },
  "booking.declined": async (db, e) => {
    const b = await bookingContext(db, e.aggregate_id);
    await notify(db, e.id, await orgRecipients(db, b.customerOrgId, CUSTOMER_WRITERS), {
      key: "bookingDeclined",
      vars: { ref: b.reference, provider: await orgName(db, b.providerOrgId) },
      link: `/client/demandes/${b.requestId}`,
      email: true,
    });
  },
  "booking.cancelled": async (db, e) => {
    const b = await bookingContext(db, e.aggregate_id);
    const vars = { ref: b.reference, reason: b.cancelReason ?? "" };
    if (b.cancelledBySide === "CUSTOMER") {
      await notify(db, e.id, [...(await orgRecipients(db, b.providerOrgId, PROVIDER_MANAGERS)), ...(await technicianRecipient(db, b.workOrder?.technicianId ?? null))], {
        key: "bookingCancelled",
        vars,
        link: provBooking(b.id),
        email: true,
      });
    } else {
      await notify(db, e.id, await orgRecipients(db, b.customerOrgId, CUSTOMER_ALL), { key: "bookingCancelled", vars, link: custBooking(b.id), email: true });
      await notify(db, e.id, await technicianRecipient(db, b.workOrder?.technicianId ?? null), { key: "bookingCancelled", vars, link: techJob(b.workOrder?.id ?? ""), excludeUserId: e.actor_user_id });
    }
  },
  "booking.no_show": async (db, e) => {
    const b = await bookingContext(db, e.aggregate_id);
    const vars = { ref: b.reference };
    const target = e.actor_org_id === b.customerOrgId ? await orgRecipients(db, b.providerOrgId, PROVIDER_MANAGERS) : await orgRecipients(db, b.customerOrgId, CUSTOMER_WRITERS);
    await notify(db, e.id, target, { key: "noShowReported", vars, link: e.actor_org_id === b.customerOrgId ? provBooking(b.id) : custBooking(b.id), email: true });
  },
  "booking.reschedule_proposed": async (db, e) => {
    const p = await db.rescheduleProposal.findUniqueOrThrow({ where: { id: e.aggregate_id } });
    const vars = { date: formatDateTime(p.startsAt) };
    if (p.proposedBySide === "CUSTOMER") {
      await notify(db, e.id, await orgRecipients(db, p.providerOrgId, PROVIDER_MANAGERS), { key: "rescheduleProposed", vars, link: provBooking(p.bookingId), email: true });
    } else {
      await notify(db, e.id, await orgRecipients(db, p.customerOrgId, CUSTOMER_WRITERS), { key: "rescheduleProposed", vars, link: custBooking(p.bookingId), email: true });
    }
  },
  "booking.rescheduled": async (db, e) => {
    const b = await bookingContext(db, e.aggregate_id);
    const vars = { ref: b.reference, date: formatDateTime(b.scheduledStart), technician: b.technicianName ?? "—" };
    await notify(db, e.id, await orgRecipients(db, b.customerOrgId, CUSTOMER_ALL), { key: "rescheduled", vars, link: custBooking(b.id), excludeUserId: e.actor_user_id });
    await notify(db, e.id, await orgRecipients(db, b.providerOrgId, PROVIDER_MANAGERS), { key: "rescheduled", vars, link: provBooking(b.id), excludeUserId: e.actor_user_id });
    await notify(db, e.id, await technicianRecipient(db, b.workOrder?.technicianId ?? null), { key: "rescheduled", vars, link: techJob(b.workOrder?.id ?? ""), email: true });
  },
  "booking.reschedule_rejected": async (db, e) => {
    const p = await db.rescheduleProposal.findUniqueOrThrow({ where: { id: e.aggregate_id } });
    const recipients = p.proposedBySide === "CUSTOMER" ? await orgRecipients(db, p.customerOrgId, CUSTOMER_WRITERS) : await orgRecipients(db, p.providerOrgId, PROVIDER_MANAGERS);
    await notify(db, e.id, recipients, { key: "rescheduleRejected", link: p.proposedBySide === "CUSTOMER" ? custBooking(p.bookingId) : provBooking(p.bookingId) });
  },
  "work_order.status_changed": async (db, e) => {
    const wo = await db.workOrder.findUniqueOrThrow({ where: { id: e.aggregate_id }, include: { booking: { select: { id: true, reference: true } } } });
    const to = String(e.payload.to ?? wo.status);
    if (!["EN_ROUTE", "ON_SITE", "IN_PROGRESS", "AWAITING_PARTS"].includes(to)) return;
    await notify(db, e.id, await orgRecipients(db, wo.customerOrgId, CUSTOMER_ALL), {
      key: "workStatus",
      vars: { ref: wo.reference, status: te("status.workOrder", to) },
      link: custBooking(wo.booking.id),
    });
  },
  "repair_quote.issued": async (db, e) => {
    const v = await db.repairQuoteVersion.findUniqueOrThrow({ where: { id: e.aggregate_id }, include: { repairQuote: { include: { workOrder: { select: { bookingId: true, reference: true } } } } } });
    await generateQuotePdf(db, v.id);
    await notify(db, e.id, await orgRecipients(db, v.customerOrgId, CUSTOMER_WRITERS), {
      key: "repairQuoteIssued",
      vars: { ref: v.repairQuote.workOrder.reference, total: formatMoney(v.totalMinor, v.currency) },
      link: custBooking(v.repairQuote.workOrder.bookingId),
      email: true,
    });
  },
  "repair_quote.decided": async (db, e) => {
    const v = await db.repairQuoteVersion.findUniqueOrThrow({ where: { id: e.aggregate_id }, include: { repairQuote: { include: { workOrder: true } } } });
    const wo = v.repairQuote.workOrder;
    const key = v.status === "APPROVED" ? "repairQuoteApproved" : "repairQuoteRejected";
    const vars = { ref: wo.reference, total: formatMoney(v.totalMinor, v.currency) };
    await notify(db, e.id, await orgRecipients(db, wo.providerOrgId, PROVIDER_MANAGERS), { key, vars, link: provBooking(wo.bookingId), email: true });
    await notify(db, e.id, await technicianRecipient(db, wo.technicianId), { key, vars, link: techJob(wo.id) });
  },
  "report.submitted": async (db, e) => {
    const report = await db.serviceReport.findUniqueOrThrow({ where: { id: e.aggregate_id }, include: { workOrder: { include: { booking: true } } } });
    await generateReportPdf(db, report.id);
    await db.serviceRequest.updateMany({ where: { id: report.workOrder.booking.requestId, status: "BOOKING" }, data: { status: "CLOSED", closedAt: new Date() } });
    await notify(db, e.id, await orgRecipients(db, report.customerOrgId, CUSTOMER_ALL), {
      key: "reportSubmitted",
      vars: { ref: report.workOrder.reference },
      link: custBooking(report.workOrder.bookingId),
      email: true,
    });
  },
  "report.acknowledged": async (db, e) => {
    const wo = await db.workOrder.findUniqueOrThrow({ where: { id: e.aggregate_id } });
    await notify(db, e.id, await orgRecipients(db, wo.providerOrgId, PROVIDER_MANAGERS), { key: "reportAcknowledged", vars: { ref: wo.reference }, link: provBooking(wo.bookingId) });
  },
  "dispute.opened": async (db, e) => {
    const d = await db.dispute.findUniqueOrThrow({ where: { id: e.aggregate_id }, include: { workOrder: { select: { reference: true } } } });
    await notify(db, e.id, await orgRecipients(db, d.providerOrgId, PROVIDER_MANAGERS), { key: "disputeOpened", vars: { ref: d.workOrder.reference }, link: provBooking(d.bookingId), email: true });
    await notify(db, e.id, await adminRecipients(db), { key: "disputeOpened", vars: { ref: d.workOrder.reference }, link: `/admin/litiges/${d.id}`, email: true });
  },
  "dispute.updated": async (db, e) => {
    const d = await db.dispute.findUniqueOrThrow({ where: { id: e.aggregate_id }, include: { workOrder: { select: { reference: true } } } });
    const vars = { ref: d.workOrder.reference, status: te("status.dispute", d.status) };
    await notify(db, e.id, await orgRecipients(db, d.customerOrgId, CUSTOMER_WRITERS), { key: "disputeUpdated", vars, link: custBooking(d.bookingId), excludeUserId: e.actor_user_id });
    await notify(db, e.id, await orgRecipients(db, d.providerOrgId, PROVIDER_MANAGERS), { key: "disputeUpdated", vars, link: provBooking(d.bookingId), excludeUserId: e.actor_user_id });
  },
  "payment.reported": async (db, e) => {
    const p = await db.paymentRecord.findUniqueOrThrow({ where: { id: e.aggregate_id } });
    const vars = { amount: formatMoney(p.amountMinor, p.currency) };
    if (p.status === "REPORTED") {
      await notify(db, e.id, await orgRecipients(db, p.providerOrgId, PROVIDER_MANAGERS), { key: "paymentReported", vars, link: provBooking(p.bookingId), email: true });
    } else {
      await notify(db, e.id, await orgRecipients(db, p.customerOrgId, CUSTOMER_WRITERS), { key: "paymentRecorded", vars, link: custBooking(p.bookingId) });
    }
  },
  "payment.updated": async (db, e) => {
    const p = await db.paymentRecord.findUniqueOrThrow({ where: { id: e.aggregate_id } });
    await notify(db, e.id, await orgRecipients(db, p.customerOrgId, CUSTOMER_WRITERS), {
      key: "paymentUpdated",
      vars: { amount: formatMoney(p.amountMinor, p.currency), status: te("status.payment", p.status) },
      link: custBooking(p.bookingId),
    });
  },
  "maintenance_plan.proposed": async (db, e) => {
    const plan = await db.maintenancePlan.findUniqueOrThrow({ where: { id: e.aggregate_id } });
    await notify(db, e.id, await orgRecipients(db, plan.customerOrgId, CUSTOMER_WRITERS), {
      key: "planProposed",
      vars: { provider: await orgName(db, plan.providerOrgId), title: plan.title },
      link: "/client/plans",
      email: true,
    });
  },
  "maintenance_plan.updated": async (db, e) => {
    const plan = await db.maintenancePlan.findUniqueOrThrow({ where: { id: e.aggregate_id } });
    const vars = { title: plan.title, status: te("status.plan", plan.status) };
    await notify(db, e.id, await orgRecipients(db, plan.providerOrgId, PROVIDER_MANAGERS), { key: "planUpdated", vars, link: "/prestataire/plans", excludeUserId: e.actor_user_id });
    await notify(db, e.id, await orgRecipients(db, plan.customerOrgId, CUSTOMER_WRITERS), { key: "planUpdated", vars, link: "/client/plans", excludeUserId: e.actor_user_id });
  },
  "review.submitted": async (db, e) => {
    await notify(db, e.id, await adminRecipients(db), { key: "reviewToModerate", link: "/admin/avis" });
  },
  "provider.reviewed": async (db, e) => {
    const profile = await db.providerProfile.findUniqueOrThrow({ where: { id: e.aggregate_id } });
    if (profile.status === "SUBMITTED") {
      await notify(db, e.id, await adminRecipients(db), { key: "providerSubmitted", vars: { provider: profile.displayName }, link: `/admin/prestataires/${profile.id}`, email: true });
      return;
    }
    await notify(db, e.id, await orgRecipients(db, profile.providerOrgId, PROVIDER_MANAGERS), {
      key: "providerStatus",
      vars: { status: te("status.provider", profile.status) },
      link: "/prestataire/profil",
      email: true,
    });
  },
};

export async function dispatch(db: PrismaClient, event: OutboxRow) {
  const handler = handlers[event.type];
  if (!handler) return; // Unknown or informational events are acknowledged without side effects.
  await handler(db, event);
}

export const WORKER_LINKS = { custBooking, provBooking, techJob };
