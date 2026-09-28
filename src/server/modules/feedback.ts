import "server-only";
import type { z } from "zod";
import type { disputeResolutionSchema, reviewModerationSchema, reviewSchema } from "@/lib/schemas";
import { type Actor, can } from "@/server/auth/roles";
import type { Tx } from "@/server/db/context";
import { DomainError, forbidden, invalidTransition, notFound } from "@/server/errors";
import { audit, emitEvent } from "@/server/lib/infra";
import { recordJobEvent } from "./timeline";

// --- Reviews: one per completed booking, written by the actual customer, moderated ----------

export async function createReview(tx: Tx, actor: Actor, bookingId: string, input: z.output<typeof reviewSchema>) {
  if (!can.customerWrite(actor)) throw forbidden();
  const booking = await tx.booking.findFirst({ where: { id: bookingId, customerOrgId: actor.orgId } });
  if (!booking) throw notFound("Rendez-vous");
  if (booking.status !== "COMPLETED") throw invalidTransition("Un avis peut être donné après une intervention terminée.");
  const existing = await tx.review.findUnique({ where: { bookingId } });
  if (existing) throw new DomainError("CONFLICT", "Un avis a déjà été déposé pour ce rendez-vous.");
  const review = await tx.review.create({
    data: { bookingId, customerOrgId: actor.orgId, providerOrgId: booking.providerOrgId, authorUserId: actor.userId, rating: input.rating, comment: input.comment },
    select: { id: true },
  });
  await audit(tx, actor, { action: "review.submitted", targetType: "review", targetId: review.id });
  await emitEvent(tx, actor, { type: "review.submitted", aggregateType: "review", aggregateId: review.id });
  return review;
}

export async function respondToReview(tx: Tx, actor: Actor, reviewId: string, body: string) {
  if (!can.providerManage(actor)) throw forbidden();
  const review = await tx.review.findFirst({ where: { id: reviewId, providerOrgId: actor.orgId }, include: { response: true } });
  if (!review) throw notFound("Avis");
  if (review.status !== "PUBLISHED") throw invalidTransition("Vous pouvez répondre à un avis publié.");
  if (review.response) throw new DomainError("CONFLICT", "Une réponse a déjà été publiée.");
  await tx.reviewResponse.create({
    data: { reviewId, providerOrgId: actor.orgId, customerOrgId: review.customerOrgId, authorUserId: actor.userId, body },
    select: { id: true },
  });
  await audit(tx, actor, { action: "review.responded", targetType: "review", targetId: reviewId });
}

export async function moderateReview(tx: Tx, actor: Actor, reviewId: string, input: z.output<typeof reviewModerationSchema>) {
  if (!can.admin(actor)) throw forbidden();
  const review = await tx.review.findUnique({ where: { id: reviewId } });
  if (!review) throw notFound("Avis");
  const status = input.decision === "PUBLISH" ? "PUBLISHED" : "REJECTED";
  await tx.review.update({ where: { id: reviewId }, data: { status, moderatedById: actor.userId, moderatedAt: new Date(), moderationNote: input.note } });
  await audit(tx, actor, { action: `review.${status.toLowerCase()}`, targetType: "review", targetId: reviewId, reason: input.note });
}

export async function hideReviewResponse(tx: Tx, actor: Actor, reviewId: string, reason: string) {
  if (!can.admin(actor)) throw forbidden();
  const updated = await tx.reviewResponse.updateMany({ where: { reviewId }, data: { hidden: true } });
  if (!updated.count) throw notFound("Réponse");
  await audit(tx, actor, { action: "review.response_hidden", targetType: "review", targetId: reviewId, reason });
}

export async function listProviderReviews(tx: Tx, actor: Actor) {
  if (!can.providerAny(actor)) throw forbidden();
  return tx.review.findMany({ where: { providerOrgId: actor.orgId }, orderBy: { createdAt: "desc" }, include: { response: true } });
}

export async function listReviewsForModeration(tx: Tx, actor: Actor, status: "PENDING_MODERATION" | "PUBLISHED" | "REJECTED") {
  if (!can.admin(actor)) throw forbidden();
  const reviews = await tx.review.findMany({ where: { status }, orderBy: { createdAt: "asc" }, take: 100, include: { response: true } });
  const orgIds = [...new Set(reviews.map((r) => r.providerOrgId))];
  const orgs = orgIds.length ? await tx.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } }) : [];
  const names = new Map(orgs.map((o) => [o.id, o.name]));
  return reviews.map((r) => ({ ...r, providerName: names.get(r.providerOrgId) ?? "—" }));
}

// --- Disputes: separate from work status and payment; history is append-only ----------------

export async function addDisputeComment(tx: Tx, actor: Actor, disputeId: string, body: string) {
  const dispute = await tx.dispute.findUnique({ where: { id: disputeId } });
  if (!dispute) throw notFound("Litige");
  let side: "CUSTOMER" | "PROVIDER" | "PLATFORM";
  if (dispute.customerOrgId === actor.orgId && can.customerWrite(actor)) side = "CUSTOMER";
  else if (dispute.providerOrgId === actor.orgId && can.providerManage(actor)) side = "PROVIDER";
  else if (can.admin(actor)) side = "PLATFORM";
  else throw forbidden();
  if (!["OPEN", "UNDER_REVIEW"].includes(dispute.status)) throw invalidTransition("Ce litige est clos.");
  await tx.disputeEvent.create({
    data: {
      disputeId,
      customerOrgId: dispute.customerOrgId,
      providerOrgId: dispute.providerOrgId,
      actorUserId: actor.userId,
      actorOrgId: actor.orgId,
      actorSide: side,
      actorName: actor.userName,
      type: "COMMENT",
      body,
    },
    select: { id: true },
  });
  await emitEvent(tx, actor, { type: "dispute.updated", aggregateType: "dispute", aggregateId: disputeId });
}

export async function withdrawDispute(tx: Tx, actor: Actor, disputeId: string) {
  if (!can.customerWrite(actor)) throw forbidden();
  const dispute = await tx.dispute.findFirst({ where: { id: disputeId, customerOrgId: actor.orgId } });
  if (!dispute) throw notFound("Litige");
  if (!["OPEN", "UNDER_REVIEW"].includes(dispute.status)) throw invalidTransition("Ce litige est clos.");
  await tx.dispute.update({ where: { id: disputeId }, data: { status: "WITHDRAWN" } });
  await tx.disputeEvent.create({
    data: {
      disputeId,
      customerOrgId: dispute.customerOrgId,
      providerOrgId: dispute.providerOrgId,
      actorUserId: actor.userId,
      actorOrgId: actor.orgId,
      actorSide: "CUSTOMER",
      actorName: actor.userName,
      type: "WITHDRAWN",
    },
    select: { id: true },
  });
  await emitEvent(tx, actor, { type: "dispute.updated", aggregateType: "dispute", aggregateId: disputeId });
}

/** Administrator records review/resolution actions; earlier events are never rewritten. */
export async function adminDisputeAction(tx: Tx, actor: Actor, disputeId: string, input: z.output<typeof disputeResolutionSchema>) {
  if (!can.admin(actor)) throw forbidden();
  const dispute = await tx.dispute.findUnique({ where: { id: disputeId } });
  if (!dispute) throw notFound("Litige");
  if (!["OPEN", "UNDER_REVIEW"].includes(dispute.status)) throw invalidTransition("Ce litige est clos.");
  if (input.action === "COMMENT") return addDisputeComment(tx, actor, disputeId, input.body);
  const now = new Date();
  if (input.action === "UNDER_REVIEW") {
    if (dispute.status !== "OPEN") throw invalidTransition("Le litige est déjà en cours d'examen.");
    await tx.dispute.update({ where: { id: disputeId }, data: { status: "UNDER_REVIEW" } });
  } else {
    await tx.dispute.update({ where: { id: disputeId }, data: { status: "RESOLVED", resolutionSummary: input.body, resolvedById: actor.userId, resolvedAt: now } });
    const wo = await tx.workOrder.findUniqueOrThrow({ where: { id: dispute.workOrderId } });
    await recordJobEvent(tx, actor, { bookingId: wo.bookingId, workOrderId: wo.id, customerOrgId: wo.customerOrgId, providerOrgId: wo.providerOrgId }, "DISPUTE_RESOLVED", {
      note: input.body,
      metadata: { disputeId },
    });
  }
  await tx.disputeEvent.create({
    data: {
      disputeId,
      customerOrgId: dispute.customerOrgId,
      providerOrgId: dispute.providerOrgId,
      actorUserId: actor.userId,
      actorOrgId: actor.orgId,
      actorSide: "PLATFORM",
      actorName: actor.userName,
      type: input.action === "RESOLVE" ? "RESOLVED" : "STATUS_CHANGED",
      body: input.body,
    },
    select: { id: true },
  });
  await audit(tx, actor, { action: `dispute.${input.action.toLowerCase()}`, targetType: "dispute", targetId: disputeId, reason: input.body });
  await emitEvent(tx, actor, { type: "dispute.updated", aggregateType: "dispute", aggregateId: disputeId });
}

export async function listDisputes(tx: Tx, actor: Actor, status?: string) {
  const statuses = ["OPEN", "UNDER_REVIEW", "RESOLVED", "WITHDRAWN"] as const;
  const s = statuses.find((x) => x === status);
  const scope = can.admin(actor) ? {} : actor.orgType === "CUSTOMER" ? { customerOrgId: actor.orgId } : { providerOrgId: actor.orgId };
  const disputes = await tx.dispute.findMany({
    where: { ...scope, ...(s ? { status: s } : {}) },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { workOrder: { select: { reference: true, bookingId: true } } },
  });
  const orgIds = [...new Set(disputes.flatMap((d) => [d.customerOrgId, d.providerOrgId]))];
  const orgs = orgIds.length ? await tx.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } }) : [];
  const names = new Map(orgs.map((o) => [o.id, o.name]));
  return disputes.map((d) => ({ ...d, customerName: names.get(d.customerOrgId) ?? "—", providerName: names.get(d.providerOrgId) ?? "—" }));
}
