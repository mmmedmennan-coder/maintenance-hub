import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import { addMonthsToDateString, dateOnly, localDateString, localToUtc, addDaysToDateString } from "@/lib/time";
import { formatDateTime } from "@/lib/time";
import { getStorage } from "@/server/storage";
import { CUSTOMER_WRITERS, PROVIDER_MANAGERS, notify, orgRecipients } from "./notify";

/**
 * Pending bookings past their confirmation deadline expire. The selection is released so the
 * customer can reopen the request and choose another valid offer. Idempotent per booking.
 */
export async function expireOverdueBookings(db: PrismaClient, now = new Date()) {
  const overdue = await db.booking.findMany({
    where: { status: "PENDING_CONFIRMATION", confirmationDeadline: { lt: now } },
    select: { id: true },
    take: 100,
  });
  let expired = 0;
  for (const { id } of overdue) {
    const booking = await db.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM booking WHERE id = ${id} AND status = 'PENDING_CONFIRMATION' FOR UPDATE`;
      if (!locked.length) return null;
      const b = await tx.booking.update({ where: { id }, data: { status: "EXPIRED", lockVersion: { increment: 1 } } });
      await tx.offerVersion.updateMany({ where: { id: b.offerVersionId, status: "SELECTED" }, data: { status: "RELEASED" } });
      await tx.offer.updateMany({ where: { id: b.offerId, status: "SELECTED" }, data: { status: "CLOSED" } });
      await tx.jobEvent.create({
        data: {
          bookingId: b.id,
          customerOrgId: b.customerOrgId,
          providerOrgId: b.providerOrgId,
          type: "BOOKING_EXPIRED",
          fromStatus: "PENDING_CONFIRMATION",
          toStatus: "EXPIRED",
          actorSide: "PLATFORM",
          actorName: "Système",
          note: "Délai de confirmation dépassé",
        },
      });
      return b;
    });
    if (!booking) continue;
    expired++;
    const eventId = `expire-${booking.id}`;
    const vars = { ref: booking.reference, deadline: formatDateTime(booking.confirmationDeadline) };
    await notify(db, eventId, await orgRecipients(db, booking.customerOrgId, CUSTOMER_WRITERS), {
      key: "bookingExpired",
      vars,
      link: `/client/demandes/${booking.requestId}`,
      email: true,
    });
    await notify(db, eventId, await orgRecipients(db, booking.providerOrgId, PROVIDER_MANAGERS), { key: "bookingExpired", vars, link: `/prestataire/rendez-vous/${booking.id}` });
  }
  return expired;
}

/** Display-only housekeeping: selection re-checks expiry synchronously anyway. */
export async function markExpiredOffers(db: PrismaClient, now = new Date()) {
  const result = await db.offerVersion.updateMany({ where: { status: "ISSUED", expiresAt: { lt: now } }, data: { status: "EXPIRED" } });
  return result.count;
}

/**
 * Active maintenance plans produce one occurrence per due date (unique occurrence key), a
 * DRAFT request for the customer to review and submit, and reminders. Never a confirmed or
 * billable visit. Safe under retries and concurrent workers.
 */
export async function generateMaintenanceOccurrences(db: PrismaClient, now = new Date()) {
  const today = localDateString(now);
  const plans = await db.maintenancePlan.findMany({
    where: { status: "ACTIVE", nextDueDate: { not: null } },
    include: { equipment: { include: { site: true } } },
    take: 500,
  });
  let created = 0;
  for (const plan of plans) {
    const due = plan.nextDueDate!.toISOString().slice(0, 10);
    const remindFrom = addDaysToDateString(due, -plan.reminderLeadDays);
    if (remindFrom > today) continue;
    const occurrenceKey = `${plan.id}:${due}`;
    const result = await db.$transaction(async (tx) => {
      const inserted = await tx.maintenanceOccurrence.createMany({
        data: [{ planId: plan.id, customerOrgId: plan.customerOrgId, providerOrgId: plan.providerOrgId, dueDate: dateOnly(due), occurrenceKey }],
        skipDuplicates: true,
      });
      // Advance the plan in any case so a pre-existing occurrence does not block the schedule.
      await tx.maintenancePlan.update({ where: { id: plan.id }, data: { nextDueDate: dateOnly(addMonthsToDateString(due, plan.intervalMonths)) } });
      if (inserted.count === 0) return null;
      let draftId: string | null = null;
      if (!plan.equipment.archivedAt && !plan.equipment.site.archivedAt && plan.consentedById) {
        const windowDate = due > today ? due : addDaysToDateString(today, 1);
        const draft = await tx.serviceRequest.create({
          data: {
            customerOrgId: plan.customerOrgId,
            siteId: plan.siteId,
            equipmentId: plan.equipmentId,
            equipmentCategoryId: plan.equipment.categoryId,
            serviceAreaId: plan.equipment.site.serviceAreaId,
            city: plan.equipment.site.city,
            kind: "MAINTENANCE",
            source: "MAINTENANCE_PLAN",
            title: plan.title,
            symptoms: `Maintenance planifiée — ${plan.scope}`,
            preferredWindows: [{ start: localToUtc(windowDate, "09:00").toISOString(), end: localToUtc(windowDate, "12:00").toISOString() }],
            createdById: plan.consentedById,
            maintenancePlanId: plan.id,
          },
          select: { id: true },
        });
        draftId = draft.id;
        await tx.maintenanceOccurrence.update({ where: { occurrenceKey }, data: { draftRequestId: draftId } });
      }
      return { draftId };
    });
    if (!result) continue;
    created++;
    const eventId = `occurrence-${occurrenceKey}`;
    const vars = { title: plan.title, date: due };
    await notify(db, eventId, await orgRecipients(db, plan.customerOrgId, CUSTOMER_WRITERS), {
      key: "maintenanceDue",
      vars,
      link: result.draftId ? `/client/demandes/${result.draftId}` : "/client/plans",
      email: true,
    });
    await notify(db, eventId, await orgRecipients(db, plan.providerOrgId, PROVIDER_MANAGERS), { key: "maintenanceDueProvider", vars, link: "/prestataire/plans" });
  }
  return created;
}

/** Uploads never finalized within two hours are marked FAILED and their objects removed. */
export async function cleanupAbandonedUploads(db: PrismaClient, now = new Date()) {
  const stale = await db.document.findMany({
    where: { status: "PENDING", createdAt: { lt: new Date(now.getTime() - 2 * 3600_000) } },
    select: { id: true, storageKey: true },
    take: 200,
  });
  for (const doc of stale) {
    await getStorage().delete(doc.storageKey).catch(() => undefined);
    await db.document.updateMany({ where: { id: doc.id, status: "PENDING" }, data: { status: "FAILED", failureReason: "abandoned" } });
  }
  return stale.length;
}

export async function runScheduledTasks(db: PrismaClient, now = new Date()) {
  const results = {
    expiredBookings: await expireOverdueBookings(db, now),
    expiredOffers: await markExpiredOffers(db, now),
    maintenanceOccurrences: await generateMaintenanceOccurrences(db, now),
    abandonedUploads: await cleanupAbandonedUploads(db, now),
  };
  return results;
}
