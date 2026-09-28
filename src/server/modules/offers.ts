import "server-only";
import type { z } from "zod";
import type { OfferVersion } from "@/generated/prisma/client";
import { computeOfferTotals } from "@/lib/money";
import type { offerDraftSchema } from "@/lib/schemas";
import { localToUtc } from "@/lib/time";
import { type Actor, can } from "@/server/auth/roles";
import type { Tx } from "@/server/db/context";
import { getEnv } from "@/server/env";
import { DomainError, forbidden, invalidTransition, notFound, validation } from "@/server/errors";
import { snapshotHash } from "@/server/lib/hash";
import { audit, emitEvent } from "@/server/lib/infra";
import { lockForUpdate } from "@/server/lib/locks";
import { assertEntitled } from "./providers";
import { recordJobEvent } from "./timeline";

function assertManager(actor: Actor) {
  if (!can.providerManage(actor)) throw forbidden();
}

/** Canonical, immutable content of an issued offer version (hashed at issue time). */
export function offerSnapshot(v: OfferVersion) {
  return {
    offerId: v.offerId,
    versionNo: v.versionNo,
    requestId: v.requestId,
    providerOrgId: v.providerOrgId,
    kind: v.kind,
    scope: v.scope,
    calloutFeeMinor: v.calloutFeeMinor,
    serviceFeeMinor: v.serviceFeeMinor,
    taxRateBp: v.taxRateBp,
    taxNote: v.taxNote,
    currency: v.currency,
    subtotalMinor: v.subtotalMinor,
    taxMinor: v.taxMinor,
    totalMinor: v.totalMinor,
    windowStart: v.windowStart,
    windowEnd: v.windowEnd,
    estimatedDurationMin: v.estimatedDurationMin,
    exclusions: v.exclusions,
    cancellationTerms: v.cancellationTerms,
    warrantyTerms: v.warrantyTerms,
    expiresAt: v.expiresAt,
    // A diagnostic offer never includes repair parts or labour.
    repairPricing: v.kind === "DIAGNOSTIC" ? "AFTER_DIAGNOSIS" : "SCOPE_ONLY",
  };
}

/** Creates the draft (or updates the existing draft) of the provider's offer for an invitation. */
export async function saveOfferDraft(tx: Tx, actor: Actor, invitationId: string, input: z.output<typeof offerDraftSchema>) {
  assertManager(actor);
  const invitation = await tx.requestInvitation.findFirst({ where: { id: invitationId, providerOrgId: actor.orgId } });
  if (!invitation) throw notFound("Invitation");
  if (!["INVITED", "OFFERED"].includes(invitation.status)) throw invalidTransition("Cette invitation n'est plus active.");
  const brief = invitation.brief as { kind: "DIAGNOSTIC" | "MAINTENANCE" | "BREAKDOWN" };
  const kind = brief.kind === "MAINTENANCE" ? "MAINTENANCE" : "DIAGNOSTIC";
  if (input.kind !== kind) {
    throw validation("Type d'offre invalide.", { kind: [kind === "MAINTENANCE" ? "Cette demande attend une offre de maintenance." : "Cette demande attend une offre de diagnostic."] });
  }
  const windowStart = localToUtc(input.windowDate, input.windowStart);
  const windowEnd = localToUtc(input.windowDate, input.windowEnd);
  if (windowStart.getTime() <= Date.now()) throw validation("Créneau passé.", { windowDate: ["Proposez un créneau dans le futur."] });
  const durationMs = input.estimatedDurationMin * 60_000;
  if (windowEnd.getTime() - windowStart.getTime() < durationMs) {
    throw validation("Créneau trop court.", { windowEnd: ["La fenêtre proposée doit couvrir la durée estimée."] });
  }
  const totals = computeOfferTotals(input.calloutFee, input.serviceFee, input.taxRate);
  const content = {
    kind,
    scope: input.scope,
    calloutFeeMinor: input.calloutFee,
    serviceFeeMinor: input.serviceFee,
    taxRateBp: input.taxRate,
    taxNote: input.taxNote,
    subtotalMinor: totals.subtotalMinor,
    taxMinor: totals.taxMinor,
    totalMinor: totals.totalMinor,
    windowStart,
    windowEnd,
    estimatedDurationMin: input.estimatedDurationMin,
    exclusions: input.exclusions,
    cancellationTerms: input.cancellationTerms,
    warrantyTerms: input.warrantyTerms,
    expiresAt: new Date(Date.now() + input.validDays * 24 * 3600_000),
  } as const;

  let offer = await tx.offer.findUnique({ where: { invitationId } });
  if (!offer) {
    offer = await tx.offer.create({
      data: {
        requestId: invitation.requestId,
        invitationId,
        customerOrgId: invitation.customerOrgId,
        providerOrgId: actor.orgId,
        createdById: actor.userId,
      },
    });
  } else {
    if (!(await lockForUpdate(tx, "offer", offer.id))) throw notFound("Offre");
  }
  if (offer.status === "SELECTED") throw invalidTransition("Cette offre a été retenue : elle ne peut plus être révisée.");
  if (offer.status === "CLOSED") throw invalidTransition("Cette demande est clôturée.");
  const draft = await tx.offerVersion.findFirst({ where: { offerId: offer.id, status: "DRAFT" } });
  if (draft) {
    await tx.offerVersion.update({ where: { id: draft.id }, data: content });
    return { offerId: offer.id, versionId: draft.id };
  }
  const last = await tx.offerVersion.findFirst({ where: { offerId: offer.id }, orderBy: { versionNo: "desc" }, select: { versionNo: true } });
  const created = await tx.offerVersion.create({
    data: {
      ...content,
      offerId: offer.id,
      requestId: invitation.requestId,
      customerOrgId: invitation.customerOrgId,
      providerOrgId: actor.orgId,
      versionNo: (last?.versionNo ?? 0) + 1,
      createdById: actor.userId,
    },
    select: { id: true },
  });
  if (offer.status === "WITHDRAWN") await tx.offer.update({ where: { id: offer.id }, data: { status: "OPEN" } });
  return { offerId: offer.id, versionId: created.id };
}

/** Issues the current draft: it becomes immutable and supersedes the previous issued version. */
export async function issueOffer(tx: Tx, actor: Actor, offerId: string) {
  assertManager(actor);
  await assertEntitled(tx, actor);
  if (!(await lockForUpdate(tx, "offer", offerId))) throw notFound("Offre");
  // Providers cannot read the customer's request row before selection (RLS): use the invitation.
  const offer = await tx.offer.findUniqueOrThrow({ where: { id: offerId }, include: { invitation: true } });
  if (offer.providerOrgId !== actor.orgId) throw notFound("Offre");
  if (offer.status === "SELECTED") throw invalidTransition("Cette offre a été retenue : elle ne peut plus être révisée.");
  if (offer.status === "CLOSED" || !["INVITED", "OFFERED"].includes(offer.invitation.status)) {
    throw invalidTransition("Cette invitation n'est plus active.");
  }
  const draft = await tx.offerVersion.findFirst({ where: { offerId, status: "DRAFT" } });
  if (!draft) throw invalidTransition("Aucun brouillon à émettre.");
  if (!draft.windowStart || draft.windowStart.getTime() <= Date.now()) throw validation("Créneau passé.", { windowDate: ["Le créneau proposé est passé : modifiez le brouillon."] });
  if (!draft.expiresAt || draft.expiresAt.getTime() <= Date.now()) throw validation("Validité dépassée.", { validDays: ["Mettez à jour la durée de validité."] });

  const issuedAt = new Date();
  const hash = snapshotHash(offerSnapshot(draft));
  await tx.offerVersion.updateMany({ where: { offerId, status: "ISSUED" }, data: { status: "SUPERSEDED" } });
  await tx.offerVersion.update({
    where: { id: draft.id },
    data: { status: "ISSUED", issuedAt, issuedById: actor.userId, snapshotHash: hash },
  });
  await tx.requestInvitation.update({ where: { id: offer.invitationId }, data: { status: "OFFERED", respondedAt: issuedAt } });
  if (offer.status !== "OPEN") await tx.offer.update({ where: { id: offerId }, data: { status: "OPEN" } });
  await audit(tx, actor, { action: "offer.issued", targetType: "offer_version", targetId: draft.id, metadata: { versionNo: draft.versionNo, totalMinor: draft.totalMinor } });
  await emitEvent(tx, actor, { type: "offer.issued", aggregateType: "offer_version", aggregateId: draft.id });
  return { versionId: draft.id, versionNo: draft.versionNo };
}

export async function discardOfferDraft(tx: Tx, actor: Actor, offerId: string) {
  assertManager(actor);
  const result = await tx.offerVersion.deleteMany({ where: { offerId, providerOrgId: actor.orgId, status: "DRAFT" } });
  if (!result.count) throw notFound("Brouillon");
}

export async function withdrawOffer(tx: Tx, actor: Actor, offerId: string, reason: string) {
  assertManager(actor);
  if (!(await lockForUpdate(tx, "offer", offerId))) throw notFound("Offre");
  const offer = await tx.offer.findUniqueOrThrow({ where: { id: offerId } });
  if (offer.providerOrgId !== actor.orgId) throw notFound("Offre");
  if (offer.status === "SELECTED") throw invalidTransition("Offre retenue : déclinez la réservation plutôt que de retirer l'offre.");
  const result = await tx.offerVersion.updateMany({ where: { offerId, status: "ISSUED" }, data: { status: "WITHDRAWN" } });
  if (!result.count) throw invalidTransition("Aucune version émise à retirer.");
  await tx.offer.update({ where: { id: offerId }, data: { status: "WITHDRAWN" } });
  await audit(tx, actor, { action: "offer.withdrawn", targetType: "offer", targetId: offerId, reason });
  await emitEvent(tx, actor, { type: "offer.withdrawn", aggregateType: "offer", aggregateId: offerId });
}

/**
 * Customer selects one exact issued version. Creates a PENDING booking and locks the
 * request (status BOOKING). Expiry is checked synchronously; the partial unique index
 * booking_one_active_per_request prevents two concurrent selections from both succeeding.
 */
export async function selectOfferVersion(tx: Tx, actor: Actor, versionId: string) {
  if (!can.customerWrite(actor)) throw forbidden("Votre rôle permet uniquement la consultation.");
  const version = await tx.offerVersion.findFirst({ where: { id: versionId, customerOrgId: actor.orgId } });
  if (!version) throw notFound("Offre");
  if (!(await lockForUpdate(tx, "service_request", version.requestId))) throw notFound("Demande");
  const request = await tx.serviceRequest.findUniqueOrThrow({ where: { id: version.requestId } });
  // Re-read the version after acquiring the request lock.
  const current = await tx.offerVersion.findUniqueOrThrow({ where: { id: versionId } });
  if (current.status === "SUPERSEDED") throw new DomainError("VERSION_CONFLICT", "Cette version a été remplacée par une révision. Consultez la nouvelle version avant de choisir.");
  if (current.status !== "ISSUED") throw invalidTransition("Cette offre n'est plus disponible.");
  if (!current.expiresAt || current.expiresAt.getTime() <= Date.now()) throw invalidTransition("Cette offre a expiré.");
  if (request.status !== "OPEN") throw invalidTransition("Une réservation est déjà en cours pour cette demande.");

  const env = getEnv();
  const deadlineByPolicy = Date.now() + env.BOOKING_CONFIRMATION_HOURS * 3600_000;
  const deadline = new Date(Math.min(deadlineByPolicy, current.windowStart?.getTime() ?? deadlineByPolicy));
  const booking = await tx.booking.create({
    data: {
      requestId: request.id,
      offerId: current.offerId,
      offerVersionId: current.id,
      customerOrgId: actor.orgId,
      providerOrgId: current.providerOrgId,
      siteId: request.siteId,
      equipmentId: request.equipmentId,
      kind: current.kind,
      windowStart: current.windowStart,
      windowEnd: current.windowEnd,
      estimatedDurationMin: current.estimatedDurationMin,
      confirmationDeadline: deadline,
      selectedById: actor.userId,
    },
    select: { id: true, reference: true },
  });
  await tx.offerVersion.update({ where: { id: current.id }, data: { status: "SELECTED" } });
  await tx.offer.update({ where: { id: current.offerId }, data: { status: "SELECTED" } });
  await tx.serviceRequest.update({ where: { id: request.id }, data: { status: "BOOKING", version: { increment: 1 } } });
  await recordJobEvent(tx, actor, { bookingId: booking.id, customerOrgId: actor.orgId, providerOrgId: current.providerOrgId }, "BOOKING_REQUESTED", {
    toStatus: "PENDING_CONFIRMATION",
    metadata: { offerVersionId: current.id, versionNo: current.versionNo, totalMinor: current.totalMinor },
  });
  await audit(tx, actor, { action: "offer.selected", targetType: "offer_version", targetId: current.id, metadata: { bookingId: booking.id } });
  await emitEvent(tx, actor, { type: "booking.requested", aggregateType: "booking", aggregateId: booking.id });
  return { bookingId: booking.id, reference: booking.reference };
}
