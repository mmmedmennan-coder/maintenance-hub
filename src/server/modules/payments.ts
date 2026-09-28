import "server-only";
import type { z } from "zod";
import type { paymentActionSchema, paymentSchema } from "@/lib/schemas";
import { dateOnly } from "@/lib/time";
import { type Actor, can } from "@/server/auth/roles";
import type { Tx } from "@/server/db/context";
import { DomainError, forbidden, invalidTransition, notFound, validation } from "@/server/errors";
import { audit, emitEvent } from "@/server/lib/infra";
import { lockForUpdate } from "@/server/lib/locks";
import { recordJobEvent } from "./timeline";

export type PaymentSummary = {
  currency: string;
  offerTotalMinor: number;
  approvedRepairsMinor: number;
  agreedTotalMinor: number;
  confirmedMinor: number;
  reportedPendingMinor: number;
  reversedMinor: number;
  outstandingMinor: number;
};

/**
 * Agreed amount = accepted offer total + for each repair quote the latest APPROVED version.
 * Only payee-CONFIRMED payments reduce the balance; REPORTED ones are shown separately.
 * The pilot records direct payments; the platform never holds funds.
 */
export async function paymentSummary(tx: Tx, bookingId: string): Promise<PaymentSummary> {
  const booking = await tx.booking.findUnique({
    where: { id: bookingId },
    select: { id: true, offerVersion: { select: { totalMinor: true, currency: true } }, workOrder: { select: { id: true } } },
  });
  if (!booking) throw notFound("Rendez-vous");
  let approvedRepairsMinor = 0;
  if (booking.workOrder) {
    const approved = await tx.repairQuoteVersion.findMany({
      where: { workOrderId: booking.workOrder.id, status: "APPROVED" },
      orderBy: { versionNo: "desc" },
      select: { repairQuoteId: true, totalMinor: true },
    });
    const seen = new Set<string>();
    for (const v of approved) {
      if (seen.has(v.repairQuoteId)) continue;
      seen.add(v.repairQuoteId);
      approvedRepairsMinor += v.totalMinor;
    }
  }
  const payments = await tx.paymentRecord.groupBy({ by: ["status"], where: { bookingId }, _sum: { amountMinor: true } });
  const sum = (status: string) => payments.find((p) => p.status === status)?._sum.amountMinor ?? 0;
  const offerTotalMinor = booking.offerVersion.totalMinor;
  const agreedTotalMinor = offerTotalMinor + approvedRepairsMinor;
  const confirmedMinor = sum("CONFIRMED");
  return {
    currency: booking.offerVersion.currency,
    offerTotalMinor,
    approvedRepairsMinor,
    agreedTotalMinor,
    confirmedMinor,
    reportedPendingMinor: sum("REPORTED"),
    reversedMinor: sum("REVERSED"),
    outstandingMinor: agreedTotalMinor - confirmedMinor,
  };
}

export async function listPayments(tx: Tx, actor: Actor, bookingId: string) {
  if (can.technician(actor)) throw forbidden();
  const [payments, summary] = await Promise.all([
    tx.paymentRecord.findMany({ where: { bookingId }, orderBy: { createdAt: "asc" }, include: { events: { orderBy: { createdAt: "asc" } } } }),
    paymentSummary(tx, bookingId),
  ]);
  return { payments, summary };
}

/** Customer reports a payment (REPORTED); provider records a receipt directly (CONFIRMED). */
export async function recordPayment(tx: Tx, actor: Actor, bookingId: string, input: z.output<typeof paymentSchema>) {
  const booking = await tx.booking.findUnique({ where: { id: bookingId }, include: { workOrder: { select: { id: true } } } });
  if (!booking) throw notFound("Rendez-vous");
  const asCustomer = booking.customerOrgId === actor.orgId && can.customerWrite(actor);
  const asProvider = booking.providerOrgId === actor.orgId && can.providerManage(actor);
  if (!asCustomer && !asProvider) throw forbidden();
  if (!["CONFIRMED", "COMPLETED", "CANCELLED", "NO_SHOW"].includes(booking.status)) {
    throw invalidTransition("Un paiement peut être enregistré une fois le rendez-vous confirmé.");
  }
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Casablanca" }).format(new Date());
  if (input.paidOn > today) throw validation("Date future.", { paidOn: ["La date de paiement ne peut pas être dans le futur."] });
  if (input.evidenceDocumentId) {
    const doc = await tx.document.findFirst({
      where: { id: input.evidenceDocumentId, ownerOrgId: actor.orgId, status: "READY", kind: "PAYMENT_EVIDENCE", workOrderId: booking.workOrder?.id ?? "-", paymentId: null },
    });
    if (!doc) throw validation("Justificatif invalide.", { evidenceDocumentId: ["Justificatif introuvable ou non enregistré."] });
  }
  const now = new Date();
  const payment = await tx.paymentRecord.create({
    data: {
      bookingId,
      customerOrgId: booking.customerOrgId,
      providerOrgId: booking.providerOrgId,
      amountMinor: input.amount,
      currency: "MAD",
      method: input.method,
      paidOn: dateOnly(input.paidOn),
      externalReference: input.externalReference,
      note: input.note,
      status: asCustomer ? "REPORTED" : "CONFIRMED",
      reportedSide: asCustomer ? "CUSTOMER" : "PROVIDER",
      reportedById: actor.userId,
      reportedByOrgId: actor.orgId,
      ...(asProvider ? { confirmedById: actor.userId, confirmedAt: now } : {}),
      evidenceDocumentId: input.evidenceDocumentId ?? null,
    },
    select: { id: true, status: true },
  });
  if (input.evidenceDocumentId) {
    await tx.document.update({ where: { id: input.evidenceDocumentId }, data: { paymentId: payment.id, visibility: "SHARED_PARTIES" } });
  }
  await tx.paymentEvent.create({
    data: {
      paymentId: payment.id,
      bookingId,
      customerOrgId: booking.customerOrgId,
      providerOrgId: booking.providerOrgId,
      type: asCustomer ? "REPORTED" : "RECORDED_BY_PAYEE",
      actorUserId: actor.userId,
      actorOrgId: actor.orgId,
    },
    select: { id: true },
  });
  await recordJobEvent(
    tx,
    actor,
    { bookingId, workOrderId: booking.workOrder?.id ?? null, customerOrgId: booking.customerOrgId, providerOrgId: booking.providerOrgId },
    asCustomer ? "PAYMENT_REPORTED" : "PAYMENT_CONFIRMED",
    { metadata: { paymentId: payment.id, amountMinor: input.amount } },
  );
  await audit(tx, actor, { action: asCustomer ? "payment.reported" : "payment.recorded", targetType: "payment_record", targetId: payment.id, metadata: { amountMinor: input.amount } });
  await emitEvent(tx, actor, { type: "payment.reported", aggregateType: "payment_record", aggregateId: payment.id });
  return { paymentId: payment.id, status: payment.status };
}

/**
 * Payee (provider) confirms or rejects a reported payment, or reverses a confirmed one.
 * Administrators may reverse with a reason (recorded as an audited correction).
 * Financial history is never deleted; reversals are explicit records.
 */
export async function updatePayment(tx: Tx, actor: Actor, paymentId: string, input: z.output<typeof paymentActionSchema>) {
  if (!(await lockForUpdate(tx, "payment_record", paymentId))) throw notFound("Paiement");
  const payment = await tx.paymentRecord.findUniqueOrThrow({ where: { id: paymentId }, include: { booking: { select: { workOrder: { select: { id: true } } } } } });
  const isPayee = payment.providerOrgId === actor.orgId && can.providerManage(actor);
  const isAdmin = can.admin(actor);
  if (!isPayee && !isAdmin) throw forbidden("Seul le bénéficiaire du paiement peut confirmer sa réception.");
  const now = new Date();
  if (input.action === "CONFIRM") {
    if (!isPayee) throw forbidden("Seul le bénéficiaire du paiement peut confirmer sa réception.");
    if (payment.status !== "REPORTED") throw invalidTransition("Ce paiement n'est pas en attente de confirmation.");
    await tx.paymentRecord.update({ where: { id: paymentId }, data: { status: "CONFIRMED", confirmedById: actor.userId, confirmedAt: now } });
  } else if (input.action === "REJECT") {
    if (!isPayee) throw forbidden();
    if (payment.status !== "REPORTED") throw invalidTransition("Ce paiement n'est pas en attente de confirmation.");
    if (!input.reason) throw validation("Motif requis.", { reason: ["Indiquez pourquoi la réception n'est pas confirmée."] });
    await tx.paymentRecord.update({ where: { id: paymentId }, data: { status: "REJECTED", rejectedById: actor.userId, rejectedAt: now, rejectionReason: input.reason } });
  } else {
    if (payment.status !== "CONFIRMED") throw invalidTransition("Seul un paiement confirmé peut être contre-passé.");
    if (!input.reason) throw validation("Motif requis.", { reason: ["Indiquez le motif de la contre-passation."] });
    await tx.paymentRecord.update({ where: { id: paymentId }, data: { status: "REVERSED", reversedById: actor.userId, reversedAt: now, reversalReason: input.reason } });
  }
  const type = input.action === "CONFIRM" ? "CONFIRMED" : input.action === "REJECT" ? "REJECTED" : isAdmin ? "ADMIN_CORRECTION" : "REVERSED";
  await tx.paymentEvent.create({
    data: {
      paymentId,
      bookingId: payment.bookingId,
      customerOrgId: payment.customerOrgId,
      providerOrgId: payment.providerOrgId,
      type,
      actorUserId: actor.userId,
      actorOrgId: actor.orgId,
      reason: input.reason,
    },
    select: { id: true },
  });
  await recordJobEvent(
    tx,
    actor,
    { bookingId: payment.bookingId, workOrderId: payment.booking.workOrder?.id ?? null, customerOrgId: payment.customerOrgId, providerOrgId: payment.providerOrgId },
    input.action === "CONFIRM" ? "PAYMENT_CONFIRMED" : input.action === "REJECT" ? "PAYMENT_REJECTED" : "PAYMENT_REVERSED",
    { note: input.reason, metadata: { paymentId, amountMinor: payment.amountMinor } },
  );
  await audit(tx, actor, { action: `payment.${type.toLowerCase()}`, targetType: "payment_record", targetId: paymentId, reason: input.reason });
  await emitEvent(tx, actor, { type: "payment.updated", aggregateType: "payment_record", aggregateId: paymentId, payload: { action: input.action } });
  return { paymentId, status: input.action === "CONFIRM" ? "CONFIRMED" : input.action === "REJECT" ? "REJECTED" : "REVERSED" };
}

/** Payment overview across bookings for a workspace (customer or provider). */
export async function listOrgPayments(tx: Tx, actor: Actor, page = 1) {
  if (can.technician(actor)) throw forbidden();
  const where = actor.orgType === "CUSTOMER" ? { customerOrgId: actor.orgId } : actor.orgType === "PROVIDER" ? { providerOrgId: actor.orgId } : {};
  const pageSize = 20;
  const [items, total, sums] = await Promise.all([
    tx.paymentRecord.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { booking: { select: { id: true, reference: true } } },
    }),
    tx.paymentRecord.count({ where }),
    tx.paymentRecord.groupBy({ by: ["status"], where, _sum: { amountMinor: true } }),
  ]);
  if (items.length === 0 && total > 0) throw new DomainError("NOT_FOUND", "Page introuvable.");
  return { items, total, page, pageSize, sums: Object.fromEntries(sums.map((s) => [s.status, s._sum.amountMinor ?? 0])) };
}
