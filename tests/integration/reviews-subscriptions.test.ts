import { beforeAll, describe, expect, it } from "vitest";
import { withActor, withPublic } from "@/server/db/context";
import { recordSubscriptionPeriod } from "@/server/modules/admin";
import { recordPayment, updatePayment } from "@/server/modules/payments";
import { createReview, hideReviewResponse, moderateReview, respondToReview } from "@/server/modules/feedback";
import { proposePlan } from "@/server/modules/maintenance";
import { issueOffer, saveOfferDraft } from "@/server/modules/offers";
import { createRequestDraft, inviteProviders, submitRequest } from "@/server/modules/requests";
import { getPublicProvider } from "@/server/modules/providers";
import { performWorkAction, submitReport } from "@/server/modules/work";
import { confirm, confirmedBooking, offerFor, pendingBooking } from "./flows";
import { expectCode, inDays, makeAdmin, makeCustomer, makeProvider, ownerDb, shiftBookingToSoon } from "./helpers";

type Customer = Awaited<ReturnType<typeof makeCustomer>>;
type Provider = Awaited<ReturnType<typeof makeProvider>>;

const reportInput = { findings: "Condenseur encrassé.", workPerformed: "Nettoyage et contrôle.", partsUsed: null, recommendations: null, nextServiceDate: null, photoDocumentIds: [] };

/** Technician arrives and submits the report of a confirmed diagnostic job → booking COMPLETED. */
async function complete(provider: Provider, job: { bookingId: string; workOrderId: string }, techIndex = 0) {
  await shiftBookingToSoon(job.bookingId, 60);
  const tech = provider.technicians[techIndex]!.actor;
  const lockVersion = (await withActor(tech, (tx) => tx.workOrder.findUniqueOrThrow({ where: { id: job.workOrderId } }))).lockVersion;
  await withActor(tech, (tx) => performWorkAction(tx, tech, job.workOrderId, { action: "ARRIVE", note: null, expectedLockVersion: lockVersion }));
  await withActor(tech, (tx) => submitReport(tx, tech, job.workOrderId, reportInput));
}

/** Customer opens a request and invites the provider; returns the provider's invitation id. */
async function invitation(customer: Customer, provider: Provider, date: string) {
  const request = await withActor(customer.owner, (tx) =>
    createRequestDraft(tx, customer.owner, {
      equipmentId: customer.equipment.id,
      kind: "DIAGNOSTIC",
      title: "Vitrine bruyante",
      symptoms: "Bruit anormal du ventilateur.",
      preferredWindows: [{ date, start: "08:00", end: "18:00" }],
    }),
  );
  await withActor(customer.owner, (tx) => submitRequest(tx, customer.owner, request.id));
  await withActor(customer.owner, (tx) => inviteProviders(tx, customer.owner, request.id, { providerOrgIds: [provider.org.id] }));
  return (await withActor(provider.manager, (tx) => tx.requestInvitation.findFirstOrThrow({ where: { requestId: request.id } }))).id;
}

const publicStats = (provider: Provider) =>
  withPublic(async (tx) => {
    const p = await getPublicProvider(tx, provider.profile.slug);
    return { count: p?.reviewCount, avg: p?.ratingAvg, responses: p?.reviews.filter((r) => r.response).length };
  });

describe("reviews: verified through the booking, moderated, answered once", () => {
  let customer: Customer;
  let other: Customer;
  let provider: Provider;
  let rival: Provider;
  let admin: Awaited<ReturnType<typeof makeAdmin>>;

  beforeAll(async () => {
    customer = await makeCustomer("Boulangerie");
    other = await makeCustomer("Autre client");
    provider = await makeProvider("Avis");
    rival = await makeProvider("Concurrent");
    admin = await makeAdmin();
  });

  it("only the booking's customer writer can review a completed booking, once", async () => {
    const job = await confirmedBooking(customer, provider, inDays(5), "09:00");
    const review = { rating: 5, comment: "Intervention propre et bien expliquée." };
    // Not completed yet.
    await expectCode(withActor(customer.owner, (tx) => createReview(tx, customer.owner, job.bookingId, review)), "INVALID_TRANSITION");
    await complete(provider, job);
    // Read-only member, another customer, the provider and its technician cannot review.
    await expectCode(withActor(customer.viewer, (tx) => createReview(tx, customer.viewer, job.bookingId, review)), "FORBIDDEN");
    await expectCode(withActor(other.owner, (tx) => createReview(tx, other.owner, job.bookingId, review)), "NOT_FOUND");
    await expectCode(withActor(provider.manager, (tx) => createReview(tx, provider.manager, job.bookingId, review)), "FORBIDDEN");
    await expectCode(withActor(provider.technicians[0]!.actor, (tx) => createReview(tx, provider.technicians[0]!.actor, job.bookingId, review)), "FORBIDDEN");

    const created = await withActor(customer.owner, (tx) => createReview(tx, customer.owner, job.bookingId, review));
    await expectCode(withActor(customer.owner, (tx) => createReview(tx, customer.owner, job.bookingId, { rating: 1, comment: null })), "CONFLICT");
    const stored = await ownerDb().review.findUniqueOrThrow({ where: { id: created.id } });
    expect(stored).toMatchObject({ status: "PENDING_MODERATION", customerOrgId: customer.org.id, providerOrgId: provider.org.id, authorUserId: customer.owner.userId, rating: 5 });
    expect(await ownerDb().review.count({ where: { bookingId: job.bookingId } })).toBe(1);
  });

  it("ratings count published reviews only; the provider replies once; moderation is admin-only and audited", async () => {
    const before = await publicStats(provider);
    const pending = await ownerDb().review.findFirstOrThrow({ where: { providerOrgId: provider.org.id } });
    expect(before).toMatchObject({ count: 0, avg: null });

    // A reply is only possible once the review is published.
    await expectCode(withActor(provider.manager, (tx) => respondToReview(tx, provider.manager, pending.id, "Merci pour votre retour.")), "INVALID_TRANSITION");
    await expectCode(withActor(customer.owner, (tx) => moderateReview(tx, customer.owner, pending.id, { decision: "PUBLISH", note: null })), "FORBIDDEN");
    await withActor(admin, (tx) => moderateReview(tx, admin, pending.id, { decision: "PUBLISH", note: "Conforme" }));

    // A second completed booking gets a 1-star review that the admin rejects: not counted.
    const second = await confirmedBooking(customer, provider, inDays(6), "09:00", "DIAGNOSTIC", 1);
    await complete(provider, second, 1);
    const rejected = await withActor(customer.owner, (tx) => createReview(tx, customer.owner, second.bookingId, { rating: 1, comment: "Texte hors sujet." }));
    await withActor(admin, (tx) => moderateReview(tx, admin, rejected.id, { decision: "REJECT", note: "Hors sujet" }));
    expect(await publicStats(provider)).toMatchObject({ count: 1, avg: 5, responses: 0 });

    // Replies: the provider manager only, once; not a competitor or a technician.
    await expectCode(withActor(rival.manager, (tx) => respondToReview(tx, rival.manager, pending.id, "Réponse")), "NOT_FOUND");
    await expectCode(withActor(provider.technicians[0]!.actor, (tx) => respondToReview(tx, provider.technicians[0]!.actor, pending.id, "Réponse")), "FORBIDDEN");
    await withActor(provider.manager, (tx) => respondToReview(tx, provider.manager, pending.id, "Merci pour votre retour."));
    await expectCode(withActor(provider.manager, (tx) => respondToReview(tx, provider.manager, pending.id, "Deuxième réponse")), "CONFLICT");
    expect((await publicStats(provider)).responses).toBe(1);

    // The admin can hide the reply (with a reason); it disappears from the public profile.
    await withActor(admin, (tx) => hideReviewResponse(tx, admin, pending.id, "Coordonnées personnelles dans la réponse"));
    expect((await publicStats(provider)).responses).toBe(0);
    const audits = await ownerDb().auditEvent.findMany({ where: { targetId: { in: [pending.id, rejected.id] } }, select: { action: true } });
    expect(audits.map((a) => a.action).sort()).toEqual(
      ["review.published", "review.rejected", "review.responded", "review.response_hidden", "review.submitted", "review.submitted"].sort(),
    );
  });
});

describe("subscription expiry: stops new commercial actions, not ongoing work", () => {
  it("an expired provider finishes selected jobs but cannot issue offers or propose plans until an admin records a period", async () => {
    const customer = await makeCustomer("Boucherie");
    const provider = await makeProvider("Abonnement");
    const admin = await makeAdmin();
    const date = inDays(4);

    // Offer issued and selected while the subscription was active.
    const pending = await pendingBooking(customer, provider, date);
    const nextInvitation = await invitation(customer, provider, inDays(8));
    const draft = await withActor(provider.manager, (tx) => saveOfferDraft(tx, provider.manager, nextInvitation, offerFor(inDays(8))));

    // Subscription lapses (paid until yesterday).
    await ownerDb().providerSubscription.update({ where: { providerOrgId: provider.org.id }, data: { paidUntil: new Date(`${inDays(-1)}T00:00:00Z`) } });

    // New commercial actions are refused with an explicit code.
    await expectCode(withActor(provider.manager, (tx) => issueOffer(tx, provider.manager, draft.offerId)), "ENTITLEMENT_REQUIRED");
    const planInput = { equipmentId: customer.equipment.id, title: "Entretien", scope: "Nettoyage condenseur et contrôle", intervalMonths: 6, reminderLeadDays: 14, firstDueDate: inDays(30) };

    // Ongoing work continues: confirmation of the already-selected offer, the visit, the report, payments.
    const confirmed = await confirm(provider, pending.bookingId, date, "10:00");
    await complete(provider, { bookingId: pending.bookingId, workOrderId: confirmed.workOrderId });
    const paid = await withActor(customer.owner, (tx) =>
      recordPayment(tx, customer.owner, pending.bookingId, { amount: 42_000, method: "CASH", paidOn: inDays(0), externalReference: null, note: null, evidenceDocumentId: null }),
    );
    await withActor(provider.manager, (tx) => updatePayment(tx, provider.manager, paid.paymentId, { action: "CONFIRM", reason: null }));
    await expectCode(withActor(provider.manager, (tx) => proposePlan(tx, provider.manager, planInput)), "ENTITLEMENT_REQUIRED");
    // History stays readable.
    expect(await withActor(provider.manager, (tx) => tx.booking.count({ where: { id: pending.bookingId, status: "COMPLETED" } }))).toBe(1);

    // The admin records a new period (audited): commercial actions resume.
    await withActor(admin, (tx) =>
      recordSubscriptionPeriod(tx, admin, provider.org.id, { periodStart: inDays(0), periodEnd: inDays(30), amount: 39_900, reference: "VIR-TEST", reason: "Paiement reçu par virement" }),
    );
    await withActor(provider.manager, (tx) => issueOffer(tx, provider.manager, draft.offerId));
    await withActor(provider.manager, (tx) => proposePlan(tx, provider.manager, planInput));
    expect(await ownerDb().auditEvent.count({ where: { action: "subscription.period_recorded", targetType: "provider_subscription" } })).toBeGreaterThanOrEqual(1);
  });
});
