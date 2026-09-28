import { beforeAll, describe, expect, it } from "vitest";
import { localToUtc } from "@/lib/time";
import { withActor } from "@/server/db/context";
import { findIdempotentOutcome, idempotent } from "@/server/lib/infra";
import { cancelBooking, proposeReschedule, respondToReschedule } from "@/server/modules/bookings";
import { issueOffer, saveOfferDraft, selectOfferVersion } from "@/server/modules/offers";
import { createRequestDraft, inviteProviders, submitRequest } from "@/server/modules/requests";
import { confirm, confirmedBooking, offerFor, pendingBooking } from "./flows";
import { expectCode, inDays, makeCustomer, makeProvider } from "./helpers";

describe("booking concurrency and capacity (exclusion constraint)", () => {
  let provider: Awaited<ReturnType<typeof makeProvider>>;
  let c1: Awaited<ReturnType<typeof makeCustomer>>;
  let c2: Awaited<ReturnType<typeof makeCustomer>>;

  beforeAll(async () => {
    provider = await makeProvider("Capacité");
    c1 = await makeCustomer("Boulangerie");
    c2 = await makeCustomer("Boucherie");
  });

  it("concurrent confirmations of the same technician/time: exactly one succeeds", async () => {
    const date = inDays(4);
    const b1 = await pendingBooking(c1, provider, date);
    const b2 = await pendingBooking(c2, provider, date);
    const results = await Promise.allSettled([confirm(provider, b1.bookingId, date, "10:00"), confirm(provider, b2.bookingId, date, "10:30")]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect((failed[0]!.reason as { code: string }).code).toBe("SLOT_CONFLICT");
    // Travel buffers count: 11:15 overlaps the 30-minute buffer of a 10:00–11:00 slot.
    const loser = results[0]!.status === "rejected" ? b1 : b2;
    await expectCode(confirm(provider, loser.bookingId, date, "11:15"), "SLOT_CONFLICT");
    // A different technician at the same time is fine.
    await expect(confirm(provider, loser.bookingId, date, "10:00", 1)).resolves.toBeTruthy();
  });

  it("concurrent selections of two offers for one request create a single booking", async () => {
    const date = inDays(5);
    const other = await makeProvider("Concurrent");
    const request = await withActor(c1.owner, (tx) =>
      createRequestDraft(tx, c1.owner, {
        equipmentId: c1.equipment.id,
        kind: "DIAGNOSTIC",
        title: "Chambre froide en alarme",
        symptoms: "Alarme haute température toutes les nuits.",
        preferredWindows: [{ date, start: "08:00", end: "12:00" }],
      }),
    );
    await withActor(c1.owner, (tx) => submitRequest(tx, c1.owner, request.id));
    await withActor(c1.owner, (tx) => inviteProviders(tx, c1.owner, request.id, { providerOrgIds: [provider.org.id, other.org.id] }));
    const versions: string[] = [];
    for (const p of [provider, other]) {
      const inv = await withActor(p.manager, (tx) => tx.requestInvitation.findFirstOrThrow({ where: { requestId: request.id } }));
      const d = await withActor(p.manager, (tx) => saveOfferDraft(tx, p.manager, inv.id, offerFor(date)));
      await withActor(p.manager, (tx) => issueOffer(tx, p.manager, d.offerId));
      versions.push(d.versionId);
    }
    const results = await Promise.allSettled(versions.map((v) => withActor(c1.owner, (tx) => selectOfferVersion(tx, c1.owner, v))));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const active = await withActor(c1.owner, (tx) => tx.booking.count({ where: { requestId: request.id, status: "PENDING_CONFIRMATION" } }));
    expect(active).toBe(1);
  });

  it("identical concurrent retries with one idempotency key produce one booking", async () => {
    const date = inDays(6);
    const p = await makeProvider("Idem");
    const request = await withActor(c2.owner, (tx) =>
      createRequestDraft(tx, c2.owner, {
        equipmentId: c2.equipment.id,
        kind: "DIAGNOSTIC",
        title: "Congélateur givré",
        symptoms: "Givre important sur l'évaporateur.",
        preferredWindows: [{ date, start: "08:00", end: "12:00" }],
      }),
    );
    await withActor(c2.owner, (tx) => submitRequest(tx, c2.owner, request.id));
    await withActor(c2.owner, (tx) => inviteProviders(tx, c2.owner, request.id, { providerOrgIds: [p.org.id] }));
    const inv = await withActor(p.manager, (tx) => tx.requestInvitation.findFirstOrThrow({ where: { requestId: request.id } }));
    const d = await withActor(p.manager, (tx) => saveOfferDraft(tx, p.manager, inv.id, offerFor(date)));
    await withActor(p.manager, (tx) => issueOffer(tx, p.manager, d.offerId));
    const call = () =>
      withActor(c2.owner, (tx) => idempotent(tx, c2.owner, "offer.select", "same-key-123456", { versionId: d.versionId }, () => selectOfferVersion(tx, c2.owner, d.versionId))).catch(
        async (error) => {
          // Lost the race on the idempotency row: return the committed outcome.
          const replay = await withActor(c2.owner, (tx) => findIdempotentOutcome<{ bookingId: string }>(tx, c2.owner, "offer.select", "same-key-123456", { versionId: d.versionId }));
          if (replay) return replay;
          throw error;
        },
      );
    const [a, b] = await Promise.all([call(), call()]);
    expect(a.body.bookingId).toBe(b.body.bookingId);
    expect(await withActor(c2.owner, (tx) => tx.booking.count({ where: { requestId: request.id } }))).toBe(1);
  });

  it("cancellation releases capacity; a conflicting reschedule keeps the original slot", async () => {
    const date = inDays(8);
    const a = await confirmedBooking(c1, provider, date, "14:00");
    const b = await confirmedBooking(c2, provider, date, "16:00");
    // Customer proposes moving A onto B's slot; provider accepts → conflict, A unchanged.
    const proposal = await withActor(c1.owner, (tx) => proposeReschedule(tx, c1.owner, a.bookingId, { date, start: "16:00", durationMin: 60, technicianId: null, reason: "Livraison le matin" }));
    await expectCode(withActor(provider.manager, (tx) => respondToReschedule(tx, provider.manager, proposal.id, true)), "SLOT_CONFLICT");
    const stillA = await withActor(provider.manager, (tx) =>
      tx.appointmentReservation.findMany({ where: { bookingId: a.bookingId, status: "ACTIVE" } }),
    );
    expect(stillA).toHaveLength(1);
    expect(stillA[0]!.startsAt.toISOString()).toBe((await withActor(c1.owner, (tx) => tx.booking.findUniqueOrThrow({ where: { id: a.bookingId } }))).scheduledStart!.toISOString());
    // Cancel B → its slot is released and A can move there.
    await withActor(c2.owner, (tx) => cancelBooking(tx, c2.owner, b.bookingId, "Magasin fermé ce jour-là"));
    const released = await withActor(provider.manager, (tx) => tx.appointmentReservation.findFirstOrThrow({ where: { bookingId: b.bookingId } }));
    expect(released.status).toBe("RELEASED");
    await withActor(provider.manager, (tx) => respondToReschedule(tx, provider.manager, proposal.id, true));
    const moved = await withActor(c1.owner, (tx) => tx.booking.findUniqueOrThrow({ where: { id: a.bookingId } }));
    expect(moved.scheduledStart!.toISOString()).toBe(localToUtc(date, "16:00").toISOString());
    const reservations = await withActor(provider.manager, (tx) => tx.appointmentReservation.findMany({ where: { bookingId: a.bookingId }, orderBy: { createdAt: "asc" } }));
    expect(reservations.map((r) => r.status)).toEqual(["RELEASED", "ACTIVE"]);
    // The cancelled booking kept its history (who/why) and created no charge.
    const cancelled = await withActor(c2.owner, (tx) => tx.booking.findUniqueOrThrow({ where: { id: b.bookingId } }));
    expect(cancelled.cancelledBySide).toBe("CUSTOMER");
    expect(await withActor(c2.owner, (tx) => tx.paymentRecord.count({ where: { bookingId: b.bookingId } }))).toBe(0);
  });

  it("an expired offer cannot be selected; a superseded version reports a version conflict", async () => {
    const date = inDays(9);
    const p = await makeProvider("Expiration");
    const request = await withActor(c1.owner, (tx) =>
      createRequestDraft(tx, c1.owner, {
        equipmentId: c1.equipment.id,
        kind: "DIAGNOSTIC",
        title: "Bruit anormal compresseur",
        symptoms: "Cliquetis au démarrage du compresseur.",
        preferredWindows: [{ date, start: "08:00", end: "12:00" }],
      }),
    );
    await withActor(c1.owner, (tx) => submitRequest(tx, c1.owner, request.id));
    await withActor(c1.owner, (tx) => inviteProviders(tx, c1.owner, request.id, { providerOrgIds: [p.org.id] }));
    const inv = await withActor(p.manager, (tx) => tx.requestInvitation.findFirstOrThrow({ where: { requestId: request.id } }));
    const v1 = await withActor(p.manager, (tx) => saveOfferDraft(tx, p.manager, inv.id, offerFor(date)));
    await withActor(p.manager, (tx) => issueOffer(tx, p.manager, v1.offerId));
    const v2 = await withActor(p.manager, (tx) => saveOfferDraft(tx, p.manager, inv.id, offerFor(date, "DIAGNOSTIC", { serviceFee: 22_000 })));
    await withActor(p.manager, (tx) => issueOffer(tx, p.manager, v2.offerId));
    expect(v2.versionId).not.toBe(v1.versionId);
    await expectCode(withActor(c1.owner, (tx) => selectOfferVersion(tx, c1.owner, v1.versionId)), "VERSION_CONFLICT");
    // Simulate expiry of v2 (owner connection) — selection re-checks synchronously.
    const { ownerDb } = await import("./helpers");
    await ownerDb().$executeRaw`ALTER TABLE offer_version DISABLE TRIGGER offer_version_guard`;
    await ownerDb().offerVersion.update({ where: { id: v2.versionId }, data: { expiresAt: new Date(Date.now() - 60_000) } });
    await ownerDb().$executeRaw`ALTER TABLE offer_version ENABLE TRIGGER offer_version_guard`;
    await expectCode(withActor(c1.owner, (tx) => selectOfferVersion(tx, c1.owner, v2.versionId)), "INVALID_TRANSITION");
  });
});
