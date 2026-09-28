import "server-only";
import type { z } from "zod";
import type { QuoteLineItem, RepairQuoteVersion, WorkOrder, WorkOrderStatus } from "@/generated/prisma/client";
import { computeLine, sumLines } from "@/lib/money";
import type { acknowledgeSchema, noteSchema, repairQuoteSchema, reportSchema, workOrderActionSchema } from "@/lib/schemas";
import { dateOnly } from "@/lib/time";
import { type Actor, can } from "@/server/auth/roles";
import type { Tx } from "@/server/db/context";
import { DomainError, forbidden, invalidTransition, notFound, validation } from "@/server/errors";
import { snapshotHash } from "@/server/lib/hash";
import { audit, emitEvent } from "@/server/lib/infra";
import { lockForUpdate } from "@/server/lib/locks";
import { technicianIdForActor } from "./technicians";
import { type JobEventType, recordJobEvent } from "./timeline";

// ---------------------------------------------------------------------------------------
// Transition table (also enforced by the work_order_guard trigger).
// Actor: assigned technician or provider owner/dispatcher.
// ---------------------------------------------------------------------------------------
export const WORK_ACTIONS: Record<
  z.output<typeof workOrderActionSchema>["action"],
  { from: WorkOrderStatus[]; to: WorkOrderStatus; event: JobEventType; requiresScope?: boolean }
> = {
  START_TRAVEL: { from: ["SCHEDULED"], to: "EN_ROUTE", event: "EN_ROUTE" },
  ARRIVE: { from: ["SCHEDULED", "EN_ROUTE"], to: "ON_SITE", event: "ON_SITE" },
  START_WORK: { from: ["ON_SITE", "DIAGNOSED", "AWAITING_PARTS"], to: "IN_PROGRESS", event: "WORK_STARTED", requiresScope: true },
  WAIT_FOR_PARTS: { from: ["DIAGNOSED", "IN_PROGRESS"], to: "AWAITING_PARTS", event: "AWAITING_PARTS", requiresScope: true },
};

async function loadWorkOrderForProvider(tx: Tx, actor: Actor, workOrderId: string) {
  if (!can.providerManage(actor) && !can.technician(actor)) throw forbidden();
  if (!(await lockForUpdate(tx, "work_order", workOrderId))) throw notFound("Intervention");
  const workOrder = await tx.workOrder.findUniqueOrThrow({ where: { id: workOrderId } });
  if (workOrder.providerOrgId !== actor.orgId) throw notFound("Intervention");
  if (can.technician(actor)) {
    const techId = await technicianIdForActor(tx, actor);
    if (!techId || techId !== workOrder.technicianId) throw notFound("Intervention");
  }
  return workOrder;
}

function target(wo: Pick<WorkOrder, "id" | "bookingId" | "customerOrgId" | "providerOrgId">) {
  return { bookingId: wo.bookingId, workOrderId: wo.id, customerOrgId: wo.customerOrgId, providerOrgId: wo.providerOrgId };
}

async function hasAuthorizedScope(tx: Tx, wo: WorkOrder) {
  if (wo.maintenanceScopeAuthorized) return true;
  return (await tx.repairQuoteVersion.count({ where: { workOrderId: wo.id, status: "APPROVED" } })) > 0;
}

export async function performWorkAction(tx: Tx, actor: Actor, workOrderId: string, input: z.output<typeof workOrderActionSchema>) {
  const wo = await loadWorkOrderForProvider(tx, actor, workOrderId);
  if (wo.lockVersion !== input.expectedLockVersion) {
    throw new DomainError("VERSION_CONFLICT", "L'intervention a été mise à jour par ailleurs. Actualisez la page.");
  }
  const rule = WORK_ACTIONS[input.action];
  if (!rule.from.includes(wo.status)) throw invalidTransition("Cette action n'est pas possible à cette étape.");
  if (rule.requiresScope && !(await hasAuthorizedScope(tx, wo))) {
    throw invalidTransition("Aucun périmètre de travaux approuvé : envoyez un devis de réparation au client.");
  }
  if (input.action === "ARRIVE") {
    const booking = await tx.booking.findUniqueOrThrow({ where: { id: wo.bookingId }, select: { scheduledStart: true } });
    if (booking.scheduledStart && booking.scheduledStart.getTime() - Date.now() > 12 * 3600_000) {
      throw invalidTransition("Le rendez-vous est prévu plus tard : l'arrivée sur site ne peut pas être enregistrée à l'avance.");
    }
  }
  await tx.workOrder.update({ where: { id: wo.id }, data: { status: rule.to, lockVersion: { increment: 1 } } });
  await recordJobEvent(tx, actor, target(wo), rule.event, { fromStatus: wo.status, toStatus: rule.to, note: input.note });
  await emitEvent(tx, actor, { type: "work_order.status_changed", aggregateType: "work_order", aggregateId: wo.id, payload: { to: rule.to } });
  return { status: rule.to };
}

export async function addWorkOrderNote(tx: Tx, actor: Actor, workOrderId: string, input: z.output<typeof noteSchema>) {
  const wo = await tx.workOrder.findUnique({ where: { id: workOrderId } });
  if (!wo) throw notFound("Intervention");
  const isCustomer = wo.customerOrgId === actor.orgId;
  const isProvider = wo.providerOrgId === actor.orgId;
  if (isCustomer && (!can.customerWrite(actor) || input.visibility === "PROVIDER_INTERNAL")) throw forbidden();
  if (isProvider && input.visibility === "CUSTOMER_PRIVATE") throw forbidden();
  if (!isCustomer && !isProvider) throw notFound("Intervention");
  await tx.workOrderNote.create({
    data: {
      workOrderId,
      customerOrgId: wo.customerOrgId,
      providerOrgId: wo.providerOrgId,
      authorUserId: actor.userId,
      authorOrgId: actor.orgId,
      authorName: actor.userName,
      visibility: input.visibility,
      body: input.body,
    },
    select: { id: true },
  });
}

// ---------------------------------------------------------------------------------------
// Repair quotes
// ---------------------------------------------------------------------------------------

export function repairQuoteSnapshot(v: RepairQuoteVersion, lines: QuoteLineItem[]) {
  return {
    versionId: v.id,
    repairQuoteId: v.repairQuoteId,
    workOrderId: v.workOrderId,
    versionNo: v.versionNo,
    scopeSummary: v.scopeSummary,
    estimatedDurationMin: v.estimatedDurationMin,
    timingNote: v.timingNote,
    exclusions: v.exclusions,
    warrantyTerms: v.warrantyTerms,
    validUntil: v.validUntil,
    currency: v.currency,
    subtotalMinor: v.subtotalMinor,
    taxMinor: v.taxMinor,
    totalMinor: v.totalMinor,
    lines: [...lines]
      .sort((a, b) => a.position - b.position)
      .map((l) => ({
        position: l.position,
        kind: l.kind,
        description: l.description,
        quantityMilli: l.quantityMilli,
        unitPriceMinor: l.unitPriceMinor,
        taxRateBp: l.taxRateBp,
        subtotalMinor: l.subtotalMinor,
        taxMinor: l.taxMinor,
        totalMinor: l.totalMinor,
      })),
  };
}

const EDITABLE_WORK_STATUSES: WorkOrderStatus[] = ["ON_SITE", "AWAITING_APPROVAL", "DIAGNOSED", "IN_PROGRESS", "AWAITING_PARTS"];

async function writeDraftLines(tx: Tx, versionId: string, wo: WorkOrder, input: z.output<typeof repairQuoteSchema>) {
  const computed = input.lines.map((l, i) => ({ ...l, ...computeLine(l.quantity, l.unitPrice, l.taxRate), position: i + 1 }));
  const totals = sumLines(computed);
  await tx.quoteLineItem.deleteMany({ where: { versionId } });
  await tx.quoteLineItem.createMany({
    data: computed.map((l) => ({
      versionId,
      customerOrgId: wo.customerOrgId,
      providerOrgId: wo.providerOrgId,
      position: l.position,
      kind: l.kind,
      description: l.description,
      quantityMilli: l.quantity,
      unitPriceMinor: l.unitPrice,
      taxRateBp: l.taxRate,
      subtotalMinor: l.subtotalMinor,
      taxMinor: l.taxMinor,
      totalMinor: l.totalMinor,
    })),
  });
  await tx.repairQuoteVersion.update({
    where: { id: versionId },
    data: {
      scopeSummary: input.scopeSummary,
      estimatedDurationMin: input.estimatedDurationMin ?? null,
      timingNote: input.timingNote,
      exclusions: input.exclusions,
      warrantyTerms: input.warrantyTerms,
      revisionReason: input.revisionReason,
      validUntil: new Date(Date.now() + input.validDays * 24 * 3600_000),
      subtotalMinor: totals.subtotalMinor,
      taxMinor: totals.taxMinor,
      totalMinor: totals.totalMinor,
    },
  });
  return totals;
}

/**
 * Saves a repair-quote draft. Without repairQuoteId a new quote is started (the first one is
 * the repair scope, later ones are change orders for additional work). With repairQuoteId a
 * new draft version is created (or the existing draft updated) — issued versions never change.
 */
export async function saveRepairQuoteDraft(
  tx: Tx,
  actor: Actor,
  workOrderId: string,
  repairQuoteId: string | null,
  input: z.output<typeof repairQuoteSchema>,
) {
  const wo = await loadWorkOrderForProvider(tx, actor, workOrderId);
  if (!EDITABLE_WORK_STATUSES.includes(wo.status)) throw invalidTransition("Un devis ne peut être préparé qu'une fois le technicien sur site.");
  let quoteId = repairQuoteId;
  if (!quoteId) {
    const last = await tx.repairQuote.findFirst({ where: { workOrderId }, orderBy: { sequenceNo: "desc" }, select: { sequenceNo: true } });
    const sequenceNo = (last?.sequenceNo ?? 0) + 1;
    const quote = await tx.repairQuote.create({
      data: {
        workOrderId,
        customerOrgId: wo.customerOrgId,
        providerOrgId: wo.providerOrgId,
        sequenceNo,
        title: input.title ?? (sequenceNo === 1 ? "Devis de réparation" : `Travaux supplémentaires n°${sequenceNo - 1}`),
        createdById: actor.userId,
      },
      select: { id: true },
    });
    quoteId = quote.id;
  } else {
    const quote = await tx.repairQuote.findFirst({ where: { id: quoteId, workOrderId } });
    if (!quote) throw notFound("Devis");
  }
  let draft = await tx.repairQuoteVersion.findFirst({ where: { repairQuoteId: quoteId, status: "DRAFT" } });
  if (!draft) {
    const last = await tx.repairQuoteVersion.findFirst({ where: { repairQuoteId: quoteId }, orderBy: { versionNo: "desc" } });
    if (last && last.versionNo >= 1 && !input.revisionReason) {
      throw validation("Motif requis.", { revisionReason: ["Indiquez le motif de la révision."] });
    }
    draft = await tx.repairQuoteVersion.create({
      data: {
        repairQuoteId: quoteId,
        workOrderId,
        customerOrgId: wo.customerOrgId,
        providerOrgId: wo.providerOrgId,
        versionNo: (last?.versionNo ?? 0) + 1,
        scopeSummary: input.scopeSummary,
        createdById: actor.userId,
      },
    });
  }
  const totals = await writeDraftLines(tx, draft.id, wo, input);
  return { repairQuoteId: quoteId, versionId: draft.id, versionNo: draft.versionNo, ...totals };
}

/** Issues a draft to the customer. A previously ISSUED (undecided) version is superseded. */
export async function issueRepairQuote(tx: Tx, actor: Actor, versionId: string) {
  const draft = await tx.repairQuoteVersion.findFirst({ where: { id: versionId, providerOrgId: actor.orgId }, include: { lines: true } });
  if (!draft) throw notFound("Devis");
  const wo = await loadWorkOrderForProvider(tx, actor, draft.workOrderId);
  if (draft.status !== "DRAFT") throw invalidTransition("Seul un brouillon peut être émis.");
  if (!EDITABLE_WORK_STATUSES.includes(wo.status)) throw invalidTransition("L'intervention ne permet plus d'émettre de devis.");
  if (draft.lines.length === 0) throw validation("Devis vide.", { lines: ["Ajoutez au moins une ligne."] });
  const hash = snapshotHash(repairQuoteSnapshot(draft, draft.lines));
  await tx.repairQuoteVersion.updateMany({ where: { repairQuoteId: draft.repairQuoteId, status: "ISSUED" }, data: { status: "SUPERSEDED" } });
  await tx.repairQuoteVersion.update({
    where: { id: draft.id },
    data: { status: "ISSUED", issuedAt: new Date(), issuedById: actor.userId, snapshotHash: hash },
  });
  if (wo.status !== "AWAITING_APPROVAL") {
    await tx.workOrder.update({ where: { id: wo.id }, data: { status: "AWAITING_APPROVAL", lockVersion: { increment: 1 } } });
  }
  await recordJobEvent(tx, actor, target(wo), "REPAIR_QUOTE_ISSUED", {
    fromStatus: wo.status,
    toStatus: "AWAITING_APPROVAL",
    metadata: { versionId: draft.id, versionNo: draft.versionNo, totalMinor: draft.totalMinor },
  });
  await audit(tx, actor, { action: "repair_quote.issued", targetType: "repair_quote_version", targetId: draft.id, metadata: { totalMinor: draft.totalMinor } });
  await emitEvent(tx, actor, { type: "repair_quote.issued", aggregateType: "repair_quote_version", aggregateId: draft.id });
  return { versionId: draft.id, snapshotHash: hash };
}

async function settleAwaitingApproval(tx: Tx, woId: string) {
  const [pending, wo] = await Promise.all([
    tx.repairQuoteVersion.count({ where: { workOrderId: woId, status: "ISSUED" } }),
    tx.workOrder.findUniqueOrThrow({ where: { id: woId } }),
  ]);
  if (pending === 0 && wo.status === "AWAITING_APPROVAL") {
    await tx.workOrder.update({ where: { id: woId }, data: { status: "DIAGNOSED", lockVersion: { increment: 1 } } });
    return "DIAGNOSED" as const;
  }
  return wo.status;
}

export async function withdrawRepairQuote(tx: Tx, actor: Actor, versionId: string) {
  const version = await tx.repairQuoteVersion.findFirst({ where: { id: versionId, providerOrgId: actor.orgId } });
  if (!version) throw notFound("Devis");
  const wo = await loadWorkOrderForProvider(tx, actor, version.workOrderId);
  if (version.status === "DRAFT") {
    await tx.quoteLineItem.deleteMany({ where: { versionId } });
    await tx.repairQuoteVersion.delete({ where: { id: versionId } });
    return;
  }
  if (version.status !== "ISSUED") throw invalidTransition("Seul un devis en attente de décision peut être retiré.");
  await tx.repairQuoteVersion.update({ where: { id: versionId }, data: { status: "WITHDRAWN" } });
  await settleAwaitingApproval(tx, wo.id);
  await recordJobEvent(tx, actor, target(wo), "REPAIR_QUOTE_WITHDRAWN", { metadata: { versionId, versionNo: version.versionNo } });
}

/**
 * Customer approves or rejects one exact issued version. The decision stores the approver,
 * timestamp, amount, currency and the snapshot hash the customer saw (checked by trigger);
 * a stale screen (different hash) gets VERSION_CONFLICT instead of approving new content.
 */
export async function decideRepairQuote(
  tx: Tx,
  actor: Actor,
  versionId: string,
  input: { decision: "APPROVED" | "REJECTED"; expectedSnapshotHash: string; reason: string | null },
) {
  if (!can.customerWrite(actor)) throw forbidden("Seul un responsable client peut approuver des travaux.");
  const version = await tx.repairQuoteVersion.findFirst({ where: { id: versionId, customerOrgId: actor.orgId } });
  if (!version) throw notFound("Devis");
  if (!(await lockForUpdate(tx, "work_order", version.workOrderId))) throw notFound("Intervention");
  const current = await tx.repairQuoteVersion.findUniqueOrThrow({ where: { id: versionId }, include: { approval: true } });
  if (current.approval) {
    if (current.approval.decision === input.decision) return { decision: current.approval.decision, approvalId: current.approval.id, duplicate: true };
    throw invalidTransition("Une décision a déjà été enregistrée pour cette version.");
  }
  if (current.status !== "ISSUED") throw invalidTransition("Cette version n'attend plus de décision.");
  if (current.snapshotHash !== input.expectedSnapshotHash) {
    throw new DomainError("VERSION_CONFLICT", "Le devis a changé depuis votre consultation. Relisez la version actuelle.");
  }
  if (input.decision === "REJECTED" && !input.reason) throw validation("Motif requis.", { reason: ["Indiquez le motif du refus."] });
  if (input.decision === "APPROVED" && current.validUntil && current.validUntil.getTime() < Date.now()) {
    throw invalidTransition("Ce devis a dépassé sa date de validité : demandez une nouvelle version au prestataire.");
  }
  const approval = await tx.approval.create({
    data: {
      versionId: current.id,
      repairQuoteId: current.repairQuoteId,
      workOrderId: current.workOrderId,
      customerOrgId: current.customerOrgId,
      providerOrgId: current.providerOrgId,
      decision: input.decision,
      actorUserId: actor.userId,
      actorOrgId: actor.orgId,
      amountMinor: current.totalMinor,
      currency: current.currency,
      snapshotHash: current.snapshotHash!,
      reason: input.reason,
    },
    select: { id: true },
  });
  await tx.repairQuoteVersion.update({ where: { id: current.id }, data: { status: input.decision } });
  const wo = await tx.workOrder.findUniqueOrThrow({ where: { id: current.workOrderId } });
  const newStatus = await settleAwaitingApproval(tx, wo.id);
  await recordJobEvent(tx, actor, target(wo), input.decision === "APPROVED" ? "REPAIR_QUOTE_APPROVED" : "REPAIR_QUOTE_REJECTED", {
    fromStatus: wo.status,
    toStatus: newStatus,
    note: input.reason,
    metadata: { versionId: current.id, versionNo: current.versionNo, totalMinor: current.totalMinor, snapshotHash: current.snapshotHash },
  });
  await audit(tx, actor, { action: `repair_quote.${input.decision.toLowerCase()}`, targetType: "repair_quote_version", targetId: current.id, reason: input.reason });
  await emitEvent(tx, actor, { type: "repair_quote.decided", aggregateType: "repair_quote_version", aggregateId: current.id, payload: { decision: input.decision } });
  return { decision: input.decision, approvalId: approval.id, duplicate: false };
}

// ---------------------------------------------------------------------------------------
// Service report, acknowledgment, disputes
// ---------------------------------------------------------------------------------------

export async function submitReport(tx: Tx, actor: Actor, workOrderId: string, input: z.output<typeof reportSchema>) {
  const wo = await loadWorkOrderForProvider(tx, actor, workOrderId);
  if (!["ON_SITE", "DIAGNOSED", "IN_PROGRESS", "AWAITING_PARTS"].includes(wo.status)) {
    throw invalidTransition("Le rapport peut être soumis une fois le technicien sur site.");
  }
  const existing = await tx.serviceReport.findUnique({ where: { workOrderId } });
  if (existing) throw new DomainError("CONFLICT", "Un rapport a déjà été soumis pour cette intervention.");
  const pending = await tx.repairQuoteVersion.count({ where: { workOrderId, status: "ISSUED" } });
  if (pending) throw invalidTransition("Un devis attend encore la décision du client.");
  const photos = input.photoDocumentIds.length
    ? await tx.document.findMany({ where: { id: { in: input.photoDocumentIds }, workOrderId, ownerOrgId: actor.orgId } })
    : [];
  if (photos.length !== input.photoDocumentIds.length || photos.some((p) => p.status !== "READY")) {
    throw validation("Photos non enregistrées.", { photoDocumentIds: ["Certaines photos ne sont pas enregistrées. Réessayez l'envoi ou retirez-les."] });
  }
  const decided = await tx.repairQuoteVersion.findMany({ where: { workOrderId, status: { in: ["APPROVED", "REJECTED"] } }, select: { id: true, status: true } });
  const approvedIds = decided.filter((d) => d.status === "APPROVED").map((d) => d.id);
  const repairDeclined = approvedIds.length === 0 && decided.some((d) => d.status === "REJECTED");
  const submittedAt = new Date();
  const content = {
    workOrderId,
    findings: input.findings,
    workPerformed: input.workPerformed,
    partsUsed: input.partsUsed,
    recommendations: input.recommendations,
    nextServiceDate: input.nextServiceDate ?? null,
    approvedVersionIds: approvedIds,
    repairDeclined,
    photoDocumentIds: photos.map((p) => p.id).sort(),
    submittedById: actor.userId,
    submittedAt,
  };
  const report = await tx.serviceReport.create({
    data: {
      workOrderId,
      customerOrgId: wo.customerOrgId,
      providerOrgId: wo.providerOrgId,
      findings: input.findings,
      workPerformed: input.workPerformed,
      partsUsed: input.partsUsed,
      recommendations: input.recommendations,
      nextServiceDate: input.nextServiceDate ? dateOnly(input.nextServiceDate) : null,
      approvedVersionIds: approvedIds,
      repairDeclined,
      submittedById: actor.userId,
      submittedByName: actor.userName,
      submittedAt,
      snapshotHash: snapshotHash(content),
    },
    select: { id: true },
  });
  if (photos.length) {
    await tx.document.updateMany({ where: { id: { in: photos.map((p) => p.id) } }, data: { reportId: report.id, visibility: "SHARED_PARTIES" } });
  }
  await tx.workOrder.update({
    where: { id: wo.id },
    data: { status: "REPORT_SUBMITTED", acknowledgment: "PENDING", completedAt: submittedAt, lockVersion: { increment: 1 } },
  });
  await tx.booking.update({ where: { id: wo.bookingId }, data: { status: "COMPLETED", completedAt: submittedAt, lockVersion: { increment: 1 } } });
  await recordJobEvent(tx, actor, target(wo), "REPORT_SUBMITTED", { fromStatus: wo.status, toStatus: "REPORT_SUBMITTED", metadata: { reportId: report.id, repairDeclined } });
  await audit(tx, actor, { action: "report.submitted", targetType: "service_report", targetId: report.id });
  await emitEvent(tx, actor, { type: "report.submitted", aggregateType: "service_report", aggregateId: report.id });
  return { reportId: report.id };
}

/**
 * Customer acknowledges the report or opens a dispute. Work status, acknowledgment and
 * dispute resolution are separate records; nothing here marks the job as paid.
 * Acknowledgment is not a waiver of workmanship claims (stated in the interface).
 */
export async function respondToReport(tx: Tx, actor: Actor, workOrderId: string, input: z.output<typeof acknowledgeSchema>) {
  if (!can.customerWrite(actor)) throw forbidden();
  if (!(await lockForUpdate(tx, "work_order", workOrderId))) throw notFound("Intervention");
  const wo = await tx.workOrder.findUniqueOrThrow({ where: { id: workOrderId } });
  if (wo.customerOrgId !== actor.orgId) throw notFound("Intervention");
  if (wo.status !== "REPORT_SUBMITTED") throw invalidTransition("Aucun rapport soumis pour cette intervention.");
  if (input.decision === "ACKNOWLEDGE") {
    if (wo.acknowledgment === "ACKNOWLEDGED") return { acknowledgment: "ACKNOWLEDGED" };
    if (wo.acknowledgment === "DISPUTED") {
      const open = await tx.dispute.count({ where: { workOrderId, status: { in: ["OPEN", "UNDER_REVIEW"] } } });
      if (open) throw invalidTransition("Un litige est en cours : attendez sa résolution ou retirez-le.");
    }
    await tx.workOrder.update({
      where: { id: wo.id },
      data: { acknowledgment: "ACKNOWLEDGED", acknowledgedAt: new Date(), acknowledgedById: actor.userId, lockVersion: { increment: 1 } },
    });
    await recordJobEvent(tx, actor, target(wo), "ACKNOWLEDGED", { note: input.reason });
    await emitEvent(tx, actor, { type: "report.acknowledged", aggregateType: "work_order", aggregateId: wo.id });
    return { acknowledgment: "ACKNOWLEDGED" };
  }
  if (!input.reason || input.reason.length < 10) throw validation("Motif requis.", { reason: ["Décrivez le problème (10 caractères minimum)."] });
  if (wo.acknowledgment !== "PENDING") throw invalidTransition("Le rapport a déjà reçu une réponse.");
  const booking = await tx.booking.findUniqueOrThrow({ where: { id: wo.bookingId }, select: { id: true } });
  const dispute = await tx.dispute.create({
    data: { workOrderId: wo.id, bookingId: booking.id, customerOrgId: wo.customerOrgId, providerOrgId: wo.providerOrgId, openedById: actor.userId, reason: input.reason },
    select: { id: true },
  });
  await tx.disputeEvent.create({
    data: {
      disputeId: dispute.id,
      customerOrgId: wo.customerOrgId,
      providerOrgId: wo.providerOrgId,
      actorUserId: actor.userId,
      actorOrgId: actor.orgId,
      actorSide: "CUSTOMER",
      actorName: actor.userName,
      type: "OPENED",
      body: input.reason,
    },
    select: { id: true },
  });
  await tx.workOrder.update({ where: { id: wo.id }, data: { acknowledgment: "DISPUTED", lockVersion: { increment: 1 } } });
  await recordJobEvent(tx, actor, target(wo), "DISPUTE_OPENED", { note: input.reason, metadata: { disputeId: dispute.id } });
  await audit(tx, actor, { action: "dispute.opened", targetType: "dispute", targetId: dispute.id });
  await emitEvent(tx, actor, { type: "dispute.opened", aggregateType: "dispute", aggregateId: dispute.id });
  return { acknowledgment: "DISPUTED", disputeId: dispute.id };
}

// ---------------------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------------------

export async function listTechnicianJobs(tx: Tx, actor: Actor, scope: "today" | "upcoming" | "recent") {
  if (!can.technician(actor) && !can.providerManage(actor)) throw forbidden();
  const techId = await technicianIdForActor(tx, actor);
  if (!techId) return { technicianId: null, items: [] };
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setUTCHours(0, 0, 0, 0);
  const where =
    scope === "recent"
      ? { technicianId: techId, status: { in: ["REPORT_SUBMITTED", "CANCELLED"] as WorkOrderStatus[] } }
      : { technicianId: techId, status: { notIn: ["REPORT_SUBMITTED", "CANCELLED"] as WorkOrderStatus[] } };
  const items = await tx.workOrder.findMany({
    where,
    orderBy: { booking: { scheduledStart: scope === "recent" ? "desc" : "asc" } },
    take: 50,
    include: {
      booking: { select: { id: true, reference: true, scheduledStart: true, scheduledEnd: true, kind: true } },
      site: { select: { name: true, addressLine: true, city: true } },
      equipment: { select: { label: true, brand: true, model: true } },
    },
  });
  return { technicianId: techId, items };
}

export async function listProviderWorkOrders(tx: Tx, actor: Actor, opts: { status?: string } = {}) {
  if (!can.providerManage(actor)) throw forbidden();
  const statuses: WorkOrderStatus[] = ["SCHEDULED", "EN_ROUTE", "ON_SITE", "AWAITING_APPROVAL", "DIAGNOSED", "AWAITING_PARTS", "IN_PROGRESS", "REPORT_SUBMITTED", "CANCELLED"];
  const status = statuses.find((s) => s === opts.status);
  return tx.workOrder.findMany({
    where: { providerOrgId: actor.orgId, ...(status ? { status } : {}) },
    orderBy: { updatedAt: "desc" },
    take: 100,
    include: {
      booking: { select: { id: true, reference: true, scheduledStart: true, technicianName: true } },
      site: { select: { name: true, city: true } },
      equipment: { select: { label: true } },
    },
  });
}
