import { beforeAll, describe, expect, it } from "vitest";
import { withActor, withPublic } from "@/server/db/context";
import { idempotent } from "@/server/lib/infra";
import { confirmBooking } from "@/server/modules/bookings";
import { issueOffer, saveOfferDraft, selectOfferVersion } from "@/server/modules/offers";
import { searchProviders } from "@/server/modules/providers";
import { createRequestDraft, inviteProviders, submitRequest } from "@/server/modules/requests";
import { drainOutbox, expectCode, inDays, makeCustomer, makeProvider } from "./helpers";

export function offerInput(date: string, overrides: Record<string, unknown> = {}) {
  return {
    kind: "DIAGNOSTIC" as const,
    scope: "Diagnostic complet du circuit frigorifique et contrôle des températures.",
    calloutFee: 10_000,
    serviceFee: 25_000,
    taxRate: 2000,
    taxNote: null,
    windowDate: date,
    windowStart: "08:00",
    windowEnd: "12:00",
    estimatedDurationMin: 90,
    exclusions: "Pièces et réparation non incluses.",
    cancellationTerms: "Annulation sans frais jusqu'à 24 h avant.",
    warrantyTerms: null,
    validDays: 7,
    ...overrides,
  };
}

describe("request → offers → selection → confirmation (real PostgreSQL + RLS)", () => {
  let customer: Awaited<ReturnType<typeof makeCustomer>>;
  let other: Awaited<ReturnType<typeof makeCustomer>>;
  let p1: Awaited<ReturnType<typeof makeProvider>>;
  let p2: Awaited<ReturnType<typeof makeProvider>>;
  let p3: Awaited<ReturnType<typeof makeProvider>>;
  let unapproved: Awaited<ReturnType<typeof makeProvider>>;

  beforeAll(async () => {
    customer = await makeCustomer("Atlas");
    other = await makeCustomer("Autre");
    p1 = await makeProvider("Froid Un");
    p2 = await makeProvider("Froid Deux");
    p3 = await makeProvider("Froid Trois");
    unapproved = await makeProvider("Non approuvé", { approved: false });
  });

  it("runs the journey and enforces cross-company isolation at every step", async () => {
    const date = inDays(3);
    const request = await withActor(customer.owner, (tx) =>
      createRequestDraft(tx, customer.owner, {
        equipmentId: customer.equipment.id,
        kind: "DIAGNOSTIC",
        title: "Vitrine ne refroidit plus",
        symptoms: "La température monte à 9 °C l'après-midi, compresseur bruyant.",
        preferredWindows: [{ date, start: "08:00", end: "12:00" }],
      }),
    );
    await withActor(customer.owner, (tx) => submitRequest(tx, customer.owner, request.id));

    // A read-only customer member cannot invite providers.
    await expectCode(withActor(customer.viewer, (tx) => inviteProviders(tx, customer.viewer, request.id, { providerOrgIds: [p1.org.id] })), "FORBIDDEN");
    // Unapproved providers are not eligible.
    await expectCode(
      withActor(customer.owner, (tx) => inviteProviders(tx, customer.owner, request.id, { providerOrgIds: [unapproved.org.id] })),
      "VALIDATION_ERROR",
    );
    await withActor(customer.owner, (tx) => inviteProviders(tx, customer.owner, request.id, { providerOrgIds: [p1.org.id, p2.org.id] }));

    // Uninvited provider sees nothing (request, invitations, counts).
    const p3View = await withActor(p3.manager, async (tx) => ({
      request: await tx.serviceRequest.findUnique({ where: { id: request.id } }),
      invitations: await tx.requestInvitation.count({ where: { requestId: request.id } }),
      site: await tx.site.findUnique({ where: { id: customer.site.id } }),
    }));
    expect(p3View).toEqual({ request: null, invitations: 0, site: null });

    // Invited provider sees only its limited brief, not the request row, site or equipment.
    const inv1 = await withActor(p1.manager, (tx) => tx.requestInvitation.findFirstOrThrow({ where: { requestId: request.id } }));
    expect(inv1.providerOrgId).toBe(p1.org.id);
    expect(JSON.stringify(inv1.brief)).not.toContain("12 avenue de France");
    expect(JSON.stringify(inv1.brief)).not.toContain("1234");
    const p1Hidden = await withActor(p1.manager, async (tx) => ({
      request: await tx.serviceRequest.findUnique({ where: { id: request.id } }),
      site: await tx.site.findUnique({ where: { id: customer.site.id } }),
      equipment: await tx.equipment.findUnique({ where: { id: customer.equipment.id } }),
      otherInvites: await tx.requestInvitation.count({ where: { requestId: request.id, providerOrgId: { not: p1.org.id } } }),
    }));
    expect(p1Hidden).toEqual({ request: null, site: null, equipment: null, otherInvites: 0 });
    // Technicians do not see invitations (commercial data).
    expect(await withActor(p1.technicians[0]!.actor, (tx) => tx.requestInvitation.count({ where: { requestId: request.id } }))).toBe(0);

    // Offers.
    const inv2 = await withActor(p2.manager, (tx) => tx.requestInvitation.findFirstOrThrow({ where: { requestId: request.id } }));
    const d1 = await withActor(p1.manager, (tx) => saveOfferDraft(tx, p1.manager, inv1.id, offerInput(date)));
    const d2 = await withActor(p2.manager, (tx) => saveOfferDraft(tx, p2.manager, inv2.id, offerInput(date, { serviceFee: 20_000 })));
    // Customer never sees drafts.
    expect(await withActor(customer.owner, (tx) => tx.offerVersion.count({ where: { requestId: request.id } }))).toBe(0);
    await withActor(p1.manager, (tx) => issueOffer(tx, p1.manager, d1.offerId));
    await withActor(p2.manager, (tx) => issueOffer(tx, p2.manager, d2.offerId));
    expect(await withActor(customer.owner, (tx) => tx.offerVersion.count({ where: { requestId: request.id, status: "ISSUED" } }))).toBe(2);
    // Losing bidder cannot see the competitor's prices.
    expect(await withActor(p2.manager, (tx) => tx.offerVersion.count({ where: { requestId: request.id } }))).toBe(1);
    expect(await withActor(p2.manager, (tx) => tx.offer.count({ where: { providerOrgId: p1.org.id } }))).toBe(0);
    // Another customer sees nothing of it.
    const otherView = await withActor(other.owner, async (tx) => ({
      request: await tx.serviceRequest.count({ where: { id: request.id } }),
      offers: await tx.offerVersion.count({ where: { requestId: request.id } }),
      site: await tx.site.count({ where: { id: customer.site.id } }),
      equipment: await tx.equipment.count({ where: { customerOrgId: customer.org.id } }),
    }));
    expect(otherView).toEqual({ request: 0, offers: 0, site: 0, equipment: 0 });

    // Issued versions are immutable in the database itself.
    await expectCode(
      withActor(p1.manager, (tx) => tx.offerVersion.update({ where: { id: d1.versionId }, data: { serviceFeeMinor: 1 } })),
      "VERSION_CONFLICT",
    );

    // Selection with an idempotency key: retry returns the same booking.
    const select = () =>
      withActor(customer.owner, (tx) => idempotent(tx, customer.owner, "offer.select", "key-select-0001", { versionId: d1.versionId }, () => selectOfferVersion(tx, customer.owner, d1.versionId)));
    const first = await select();
    const retry = await select();
    expect(retry.replayed).toBe(true);
    expect(retry.body.bookingId).toBe(first.body.bookingId);
    await expectCode(
      withActor(customer.owner, (tx) => idempotent(tx, customer.owner, "offer.select", "key-select-0001", { versionId: d2.versionId }, () => selectOfferVersion(tx, customer.owner, d2.versionId))),
      "IDEMPOTENCY_KEY_REUSED",
    );
    // A second selection cannot create another active booking.
    await expectCode(withActor(customer.owner, (tx) => selectOfferVersion(tx, customer.owner, d2.versionId)), "INVALID_TRANSITION");
    const bookingId = first.body.bookingId;

    // Selected provider can now read the request (pending), but the site access details are hidden by the service.
    expect(await withActor(p1.manager, (tx) => tx.serviceRequest.count({ where: { id: request.id } }))).toBe(1);
    // Losing bidder cannot read the booking.
    expect(await withActor(p2.manager, (tx) => tx.booking.count({ where: { id: bookingId } }))).toBe(0);

    // Provider confirms with technician 1.
    const tech1 = p1.technicians[0]!;
    const booking = await withActor(p1.manager, (tx) => tx.booking.findUniqueOrThrow({ where: { id: bookingId } }));
    const confirmed = await withActor(p1.manager, (tx) =>
      confirmBooking(tx, p1.manager, bookingId, { technicianId: tech1.id, date, start: "09:00", durationMin: 90, bufferBeforeMin: 30, bufferAfterMin: 30, expectedLockVersion: booking.lockVersion }),
    );
    // Stale lock version is rejected.
    await expectCode(
      withActor(p1.manager, (tx) =>
        confirmBooking(tx, p1.manager, bookingId, { technicianId: tech1.id, date, start: "09:00", durationMin: 90, bufferBeforeMin: 30, bufferAfterMin: 30, expectedLockVersion: booking.lockVersion }),
      ),
      "VERSION_CONFLICT",
    );

    // Worker closes competing offers without revealing prices.
    await drainOutbox();
    const p2After = await withActor(p2.manager, async (tx) => ({
      invitation: (await tx.requestInvitation.findUniqueOrThrow({ where: { id: inv2.id } })).status,
      version: (await tx.offerVersion.findUniqueOrThrow({ where: { id: d2.versionId } })).status,
      workOrders: await tx.workOrder.count({ where: { id: confirmed.workOrderId } }),
    }));
    expect(p2After).toEqual({ invitation: "CLOSED", version: "NOT_SELECTED", workOrders: 0 });

    // Assigned technician sees the job and site; the other technician does not.
    const t1View = await withActor(tech1.actor, async (tx) => ({
      wo: await tx.workOrder.count({ where: { id: confirmed.workOrderId } }),
      site: await tx.site.count({ where: { id: customer.site.id } }),
      payments: await tx.paymentRecord.count(),
      invitations: await tx.requestInvitation.count(),
    }));
    expect(t1View).toEqual({ wo: 1, site: 1, payments: 0, invitations: 0 });
    const t2View = await withActor(p1.technicians[1]!.actor, async (tx) => ({
      wo: await tx.workOrder.count({ where: { id: confirmed.workOrderId } }),
      booking: await tx.booking.count({ where: { id: bookingId } }),
      site: await tx.site.count({ where: { id: customer.site.id } }),
    }));
    expect(t2View).toEqual({ wo: 0, booking: 0, site: 0 });

    // Customer receives notifications created by the worker (in-app).
    const notes = await withActor(customer.owner, (tx) => tx.notification.findMany({ where: { userId: customer.owner.userId } }));
    expect(notes.some((n) => n.type === "bookingConfirmed")).toBe(true);
    // Re-running the worker does not duplicate notifications.
    await drainOutbox();
    const notesAgain = await withActor(customer.owner, (tx) => tx.notification.count({ where: { userId: customer.owner.userId } }));
    expect(notesAgain).toBe(notes.length);
  });

  it("public directory only exposes approved providers", async () => {
    const results = await withPublic((tx) => searchProviders(tx, { q: "Non approuvé" }));
    expect(results.total).toBe(0);
    const approved = await withPublic((tx) => searchProviders(tx, { q: p1.org.name }));
    expect(approved.total).toBe(1);
    expect(approved.items[0]!.displayName).toBe(p1.profile.displayName);
    // Anonymous context cannot read customers' data at all.
    const anon = await withPublic(async (tx) => ({ sites: await tx.site.count(), requests: await tx.serviceRequest.count(), users: await tx.user.count() }));
    expect(anon).toEqual({ sites: 0, requests: 0, users: 0 });
  });
});
