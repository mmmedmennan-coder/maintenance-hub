import { beforeAll, describe, expect, it } from "vitest";
import { workerDb } from "@/server/db/clients";
import { withActor } from "@/server/db/context";
import { decidePlan, proposePlan } from "@/server/modules/maintenance";
import { processEmailBatch, processOutboxBatch } from "@/server/worker/queue";
import { expireOverdueBookings, generateMaintenanceOccurrences } from "@/server/worker/scheduler";
import { confirmedBooking, pendingBooking } from "./flows";
import { expectCode, inDays, makeCustomer, makeProvider, ownerDb } from "./helpers";

describe("maintenance plans, booking expiry and worker durability", () => {
  let customer: Awaited<ReturnType<typeof makeCustomer>>;
  let provider: Awaited<ReturnType<typeof makeProvider>>;

  beforeAll(async () => {
    customer = await makeCustomer("Épicerie");
    provider = await makeProvider("Plans");
  });

  it("plans need customer consent and generate exactly one draft per due date", async () => {
    await confirmedBooking(customer, provider, inDays(3), "10:00", "MAINTENANCE");
    // Unserviced equipment cannot receive a plan from this provider.
    const stranger = await makeCustomer("Autre magasin");
    await expectCode(
      withActor(provider.manager, (tx) =>
        proposePlan(tx, provider.manager, { equipmentId: stranger.equipment.id, title: "Entretien", scope: "Nettoyage condenseur", intervalMonths: 6, reminderLeadDays: 14, firstDueDate: inDays(10) }),
      ),
      "VALIDATION_ERROR",
    );
    const plan = await withActor(provider.manager, (tx) =>
      proposePlan(tx, provider.manager, { equipmentId: customer.equipment.id, title: "Entretien semestriel", scope: "Nettoyage condenseur et contrôle de charge", intervalMonths: 6, reminderLeadDays: 14, firstDueDate: inDays(10) }),
    );
    // Provider cannot consent on the customer's behalf.
    await expectCode(withActor(provider.manager, (tx) => decidePlan(tx, provider.manager, plan.id, { action: "CONSENT", note: null })), "FORBIDDEN");
    // Before consent nothing is generated.
    await generateMaintenanceOccurrences(workerDb());
    expect(await ownerDb().maintenanceOccurrence.count({ where: { planId: plan.id } })).toBe(0);
    await withActor(customer.owner, (tx) => decidePlan(tx, customer.owner, plan.id, { action: "CONSENT", note: null }));
    // Concurrent / repeated scheduler runs → one occurrence and one draft.
    await Promise.all([generateMaintenanceOccurrences(workerDb()), generateMaintenanceOccurrences(workerDb())]);
    await generateMaintenanceOccurrences(workerDb());
    const occurrences = await ownerDb().maintenanceOccurrence.findMany({ where: { planId: plan.id } });
    expect(occurrences).toHaveLength(1);
    const drafts = await withActor(customer.owner, (tx) => tx.serviceRequest.findMany({ where: { maintenancePlanId: plan.id } }));
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.status).toBe("DRAFT");
    expect(drafts[0]!.source).toBe("MAINTENANCE_PLAN");
    // No booking is created automatically.
    expect(await withActor(customer.owner, (tx) => tx.booking.count({ where: { requestId: drafts[0]!.id } }))).toBe(0);
    const updated = await ownerDb().maintenancePlan.findUniqueOrThrow({ where: { id: plan.id } });
    expect(updated.nextDueDate!.toISOString().slice(0, 10) > inDays(150)).toBe(true);
  });

  it("pending bookings expire after the deadline and can be re-chosen", async () => {
    const pending = await pendingBooking(customer, provider, inDays(12));
    await ownerDb().booking.update({ where: { id: pending.bookingId }, data: { confirmationDeadline: new Date(Date.now() - 1000) } });
    expect(await expireOverdueBookings(workerDb())).toBeGreaterThanOrEqual(1);
    expect(await expireOverdueBookings(workerDb())).toBe(0);
    const state = await withActor(customer.owner, async (tx) => ({
      booking: await tx.booking.findUniqueOrThrow({ where: { id: pending.bookingId } }),
      version: await tx.offerVersion.findUniqueOrThrow({ where: { id: pending.versionId } }),
      notes: await tx.notification.count({ where: { type: "bookingExpired" } }),
    }));
    expect(state.booking.status).toBe("EXPIRED");
    expect(state.version.status).toBe("RELEASED");
    expect(state.notes).toBeGreaterThanOrEqual(1);
  });

  it("a crashed worker's lease is reclaimed and processing stays idempotent", async () => {
    const pending = await pendingBooking(customer, provider, inDays(14));
    // Simulate a worker that claimed events then died: rows stuck in PROCESSING with an old lease.
    await ownerDb().$executeRaw`UPDATE outbox_event SET status = 'PROCESSING', locked_by = 'dead-worker', locked_at = now() - interval '10 minutes' WHERE status = 'PENDING'`;
    const result = await processOutboxBatch(workerDb(), "fresh-worker", 50);
    expect(result.claimed).toBeGreaterThan(0);
    const stuck = await ownerDb().outboxEvent.count({ where: { status: "PROCESSING" } });
    expect(stuck).toBe(0);
    const notes = await withActor(provider.manager, (tx) => tx.notification.count({ where: { type: "bookingRequested", link: `/prestataire/rendez-vous/${pending.bookingId}` } }));
    expect(notes).toBe(1);
    // E-mail delivery: a failing transport retries with backoff and never marks as sent.
    const failing = await processEmailBatch(workerDb(), "mail-worker", 5, async () => {
      throw new Error("SMTP down for bob@example.com");
    });
    expect(failing.sent).toBe(0);
    const failed = await ownerDb().emailDelivery.findFirst({ where: { status: "FAILED" } });
    expect(failed?.lastError).toContain("[email]");
    expect(failed?.lastError).not.toContain("bob@example.com");
    const sentLog: string[] = [];
    await ownerDb().emailDelivery.updateMany({ where: { status: "FAILED" }, data: { availableAt: new Date(Date.now() - 1000) } });
    for (let i = 0; i < 10; i++) await processEmailBatch(workerDb(), "mail-worker", 20, async (m) => void sentLog.push(m.to));
    const delivered = await ownerDb().emailDelivery.findMany({ where: { status: "DONE" } });
    expect(delivered.length).toBeGreaterThan(0);
    expect(delivered.every((d) => d.textBody.startsWith("[contenu"))).toBe(true);
  });
});
