import "server-only";
import type { z } from "zod";
import type { availabilityWindowSchema, technicianSchema, timeOffSchema } from "@/lib/schemas";
import { TIMEZONE, isoWeekday, localToUtc, minutesOfDay, localDateString } from "@/lib/time";
import { type Actor, can } from "@/server/auth/roles";
import { authDb } from "@/server/db/clients";
import type { Tx } from "@/server/db/context";
import { DomainError, forbidden, notFound, validation } from "@/server/errors";
import { audit } from "@/server/lib/infra";

function assertManager(actor: Actor) {
  if (!can.providerManage(actor)) throw forbidden();
}

export async function listTechnicians(tx: Tx, actor: Actor, opts: { activeOnly?: boolean } = {}) {
  if (!can.providerAny(actor)) throw forbidden();
  return tx.technicianProfile.findMany({
    where: { providerOrgId: actor.orgId, ...(opts.activeOnly ? { active: true } : {}) },
    orderBy: [{ active: "desc" }, { displayName: "asc" }],
    include: {
      skills: { include: { equipmentCategory: { select: { id: true, labelFr: true } } } },
      windows: { orderBy: [{ weekday: "asc" }, { startMinute: "asc" }] },
      timeOff: { where: { endsAt: { gt: new Date() } }, orderBy: { startsAt: "asc" } },
    },
  });
}

export async function createTechnician(tx: Tx, actor: Actor, input: z.output<typeof technicianSchema>) {
  assertManager(actor);
  if (input.userId) await assertTechnicianMember(actor.orgId, input.userId);
  const profile = await tx.technicianProfile.create({
    data: { providerOrgId: actor.orgId, displayName: input.displayName, phone: input.phone, userId: input.userId ?? null, active: input.active },
    select: { id: true },
  });
  await setSkills(tx, actor, profile.id, input.skillIds);
  await audit(tx, actor, { action: "technician.created", targetType: "technician_profile", targetId: profile.id });
  return profile;
}

export async function updateTechnician(tx: Tx, actor: Actor, technicianId: string, input: z.output<typeof technicianSchema>) {
  assertManager(actor);
  const existing = await tx.technicianProfile.findFirst({ where: { id: technicianId, providerOrgId: actor.orgId } });
  if (!existing) throw notFound("Technicien");
  if (input.userId && input.userId !== existing.userId) await assertTechnicianMember(actor.orgId, input.userId);
  await tx.technicianProfile.update({
    where: { id: technicianId },
    data: { displayName: input.displayName, phone: input.phone, active: input.active, ...(input.userId !== undefined ? { userId: input.userId } : {}) },
  });
  await setSkills(tx, actor, technicianId, input.skillIds);
  await audit(tx, actor, { action: "technician.updated", targetType: "technician_profile", targetId: technicianId });
  return { id: technicianId };
}

async function assertTechnicianMember(orgId: string, userId: string) {
  const member = await authDb().member.findFirst({ where: { organizationId: orgId, userId } });
  if (!member) throw validation("Compte invalide.", { userId: ["Ce compte n'est pas membre de votre entreprise."] });
}

async function setSkills(tx: Tx, actor: Actor, technicianId: string, skillIds: string[]) {
  const categories = await tx.equipmentCategory.findMany({ where: { id: { in: skillIds } }, select: { id: true } });
  await tx.technicianSkill.deleteMany({ where: { technicianId, providerOrgId: actor.orgId } });
  if (categories.length) {
    await tx.technicianSkill.createMany({
      data: categories.map((c) => ({ technicianId, equipmentCategoryId: c.id, providerOrgId: actor.orgId })),
    });
  }
}

export async function addAvailabilityWindow(tx: Tx, actor: Actor, input: z.output<typeof availabilityWindowSchema>) {
  assertManager(actor);
  const tech = await tx.technicianProfile.findFirst({ where: { id: input.technicianId, providerOrgId: actor.orgId } });
  if (!tech) throw notFound("Technicien");
  const [sh, sm] = input.start.split(":").map(Number) as [number, number];
  const [eh, em] = input.end.split(":").map(Number) as [number, number];
  const startMinute = sh * 60 + sm;
  const endMinute = eh * 60 + em;
  const overlapping = await tx.availabilityWindow.count({
    where: { technicianId: tech.id, weekday: input.weekday, startMinute: { lt: endMinute }, endMinute: { gt: startMinute } },
  });
  if (overlapping) throw validation("Chevauchement.", { start: ["Cette plage chevauche une disponibilité existante."] });
  const row = await tx.availabilityWindow.create({
    data: { providerOrgId: actor.orgId, technicianId: tech.id, weekday: input.weekday, startMinute, endMinute },
    select: { id: true },
  });
  await audit(tx, actor, { action: "availability.added", targetType: "technician_profile", targetId: tech.id });
  return row;
}

export async function removeAvailabilityWindow(tx: Tx, actor: Actor, windowId: string) {
  assertManager(actor);
  const result = await tx.availabilityWindow.deleteMany({ where: { id: windowId, providerOrgId: actor.orgId } });
  if (!result.count) throw notFound("Disponibilité");
}

export async function addTimeOff(tx: Tx, actor: Actor, input: z.output<typeof timeOffSchema>) {
  assertManager(actor);
  const tech = await tx.technicianProfile.findFirst({ where: { id: input.technicianId, providerOrgId: actor.orgId } });
  if (!tech) throw notFound("Technicien");
  const startsAt = localToUtc(input.startDate, input.startTime);
  const endsAt = localToUtc(input.endDate, input.endTime);
  const row = await tx.timeOff.create({
    data: { providerOrgId: actor.orgId, technicianId: tech.id, startsAt, endsAt, reason: input.reason, createdById: actor.userId },
    select: { id: true },
  });
  const conflicts = await tx.appointmentReservation.count({
    where: { technicianId: tech.id, status: "ACTIVE", blockedStart: { lt: endsAt }, blockedEnd: { gt: startsAt } },
  });
  await audit(tx, actor, { action: "time_off.added", targetType: "technician_profile", targetId: tech.id });
  return { ...row, conflictingAppointments: conflicts };
}

export async function removeTimeOff(tx: Tx, actor: Actor, timeOffId: string) {
  assertManager(actor);
  const result = await tx.timeOff.deleteMany({ where: { id: timeOffId, providerOrgId: actor.orgId } });
  if (!result.count) throw notFound("Absence");
}

/**
 * Validates a slot against a technician's declared availability (local time) and time off.
 * Overlap with other appointments is enforced atomically by the exclusion constraint.
 */
export async function assertSlotAvailable(
  tx: Tx,
  providerOrgId: string,
  technicianId: string,
  startsAt: Date,
  endsAt: Date,
  equipmentCategoryId: string | null,
) {
  const tech = await tx.technicianProfile.findFirst({
    where: { id: technicianId, providerOrgId },
    include: { windows: true, skills: true },
  });
  if (!tech) throw validation("Technicien invalide.", { technicianId: ["Technicien inconnu dans votre entreprise."] });
  if (!tech.active) throw validation("Technicien inactif.", { technicianId: ["Ce technicien est désactivé."] });
  if (equipmentCategoryId && tech.skills.length > 0 && !tech.skills.some((s) => s.equipmentCategoryId === equipmentCategoryId)) {
    throw validation("Compétence manquante.", { technicianId: ["Ce technicien n'est pas déclaré pour cette catégorie d'équipement."] });
  }
  if (startsAt.getTime() <= Date.now()) {
    throw validation("Créneau passé.", { date: ["Choisissez un créneau dans le futur."] });
  }
  if (localDateString(startsAt, TIMEZONE) !== localDateString(new Date(endsAt.getTime() - 1), TIMEZONE)) {
    throw validation("Créneau invalide.", { start: ["Un rendez-vous doit se terminer le même jour."] });
  }
  const weekday = isoWeekday(startsAt);
  const startMin = minutesOfDay(startsAt);
  const endMin = startMin + Math.round((endsAt.getTime() - startsAt.getTime()) / 60000);
  const fits = tech.windows.some((w) => w.weekday === weekday && w.startMinute <= startMin && endMin <= w.endMinute);
  if (!fits) {
    throw new DomainError("SLOT_CONFLICT", "Ce créneau est en dehors des disponibilités déclarées du technicien.", {
      fields: { start: ["Hors des disponibilités déclarées."] },
    });
  }
  const off = await tx.timeOff.count({ where: { technicianId, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } } });
  if (off) throw new DomainError("SLOT_CONFLICT", "Le technicien est absent sur ce créneau.", { fields: { start: ["Technicien absent."] } });
}

/** Week calendar for a provider (or one technician): reservations, windows and time off. */
export async function getCalendar(tx: Tx, actor: Actor, weekStartLocal: string, technicianId?: string) {
  if (!can.providerAny(actor)) throw forbidden();
  const from = localToUtc(weekStartLocal, "00:00");
  const to = new Date(from.getTime() + 7 * 24 * 3600_000);
  const techFilter = can.technician(actor)
    ? { userId: actor.userId }
    : technicianId
      ? { id: technicianId }
      : {};
  const technicians = await tx.technicianProfile.findMany({
    where: { providerOrgId: actor.orgId, active: true, ...techFilter },
    orderBy: { displayName: "asc" },
    include: {
      windows: { orderBy: [{ weekday: "asc" }, { startMinute: "asc" }] },
      timeOff: { where: { startsAt: { lt: to }, endsAt: { gt: from } } },
    },
  });
  const reservations = await tx.appointmentReservation.findMany({
    where: {
      providerOrgId: actor.orgId,
      status: "ACTIVE",
      technicianId: { in: technicians.map((t) => t.id) },
      blockedStart: { lt: to },
      blockedEnd: { gt: from },
    },
    orderBy: { startsAt: "asc" },
    include: {
      booking: {
        select: {
          id: true,
          reference: true,
          kind: true,
          status: true,
          workOrder: { select: { id: true, status: true } },
          site: { select: { name: true, city: true } },
        },
      },
    },
  });
  return { from, to, technicians, reservations };
}

export async function technicianIdForActor(tx: Tx, actor: Actor): Promise<string | null> {
  const profile = await tx.technicianProfile.findFirst({ where: { providerOrgId: actor.orgId, userId: actor.userId }, select: { id: true } });
  return profile?.id ?? null;
}
