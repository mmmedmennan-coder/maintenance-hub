import "server-only";
import type { z } from "zod";
import type { maintenancePlanSchema, planDecisionSchema } from "@/lib/schemas";
import { dateOnly, localDateString } from "@/lib/time";
import { type Actor, can } from "@/server/auth/roles";
import type { Tx } from "@/server/db/context";
import { forbidden, invalidTransition, notFound, validation } from "@/server/errors";
import { audit, emitEvent } from "@/server/lib/infra";
import { lockForUpdate } from "@/server/lib/locks";
import { assertEntitled } from "./providers";

/**
 * A provider proposes a recurrence (entered by the competent provider — the software never
 * invents intervals) for equipment it has serviced; the customer must consent. Active plans
 * generate reminders and DRAFT requests only — never a confirmed or billable visit.
 */
export async function proposePlan(tx: Tx, actor: Actor, input: z.output<typeof maintenancePlanSchema>) {
  if (!can.providerManage(actor)) throw forbidden();
  await assertEntitled(tx, actor);
  const booking = await tx.booking.findFirst({
    where: { providerOrgId: actor.orgId, equipmentId: input.equipmentId, status: { in: ["CONFIRMED", "COMPLETED"] } },
    select: { customerOrgId: true, siteId: true },
  });
  if (!booking) throw validation("Équipement invalide.", { equipmentId: ["Proposez un plan uniquement pour un équipement que vous avez déjà pris en charge."] });
  const today = localDateString(new Date());
  if (input.firstDueDate <= today) throw validation("Date passée.", { firstDueDate: ["Choisissez une date future."] });
  const existing = await tx.maintenancePlan.count({
    where: { providerOrgId: actor.orgId, equipmentId: input.equipmentId, status: { in: ["PROPOSED", "ACTIVE", "PAUSED"] } },
  });
  if (existing) throw invalidTransition("Un plan est déjà proposé ou actif pour cet équipement.");
  const plan = await tx.maintenancePlan.create({
    data: {
      customerOrgId: booking.customerOrgId,
      providerOrgId: actor.orgId,
      equipmentId: input.equipmentId,
      siteId: booking.siteId,
      title: input.title,
      scope: input.scope,
      intervalMonths: input.intervalMonths,
      reminderLeadDays: input.reminderLeadDays,
      firstDueDate: dateOnly(input.firstDueDate),
      proposedById: actor.userId,
    },
    select: { id: true },
  });
  await audit(tx, actor, { action: "maintenance_plan.proposed", targetType: "maintenance_plan", targetId: plan.id });
  await emitEvent(tx, actor, { type: "maintenance_plan.proposed", aggregateType: "maintenance_plan", aggregateId: plan.id });
  return plan;
}

export async function decidePlan(tx: Tx, actor: Actor, planId: string, input: z.output<typeof planDecisionSchema>) {
  if (!(await lockForUpdate(tx, "maintenance_plan", planId))) throw notFound("Plan");
  const plan = await tx.maintenancePlan.findUniqueOrThrow({ where: { id: planId } });
  const asCustomer = plan.customerOrgId === actor.orgId && can.customerWrite(actor);
  const asProvider = plan.providerOrgId === actor.orgId && can.providerManage(actor);
  if (!asCustomer && !asProvider) throw forbidden();
  const now = new Date();
  const transitions: Record<string, { from: string[]; to: "ACTIVE" | "DECLINED" | "PAUSED" | "ENDED"; customerOnly?: boolean }> = {
    CONSENT: { from: ["PROPOSED"], to: "ACTIVE", customerOnly: true },
    DECLINE: { from: ["PROPOSED"], to: "DECLINED", customerOnly: true },
    PAUSE: { from: ["ACTIVE"], to: "PAUSED" },
    RESUME: { from: ["PAUSED"], to: "ACTIVE", customerOnly: true },
    END: { from: ["PROPOSED", "ACTIVE", "PAUSED"], to: "ENDED" },
  };
  const rule = transitions[input.action]!;
  if (rule.customerOnly && !asCustomer) throw forbidden("Cette décision appartient au client.");
  if (!rule.from.includes(plan.status)) throw invalidTransition("Cette action n'est pas possible pour ce plan.");
  const firstDue = plan.firstDueDate.toISOString().slice(0, 10);
  await tx.maintenancePlan.update({
    where: { id: planId },
    data: {
      status: rule.to,
      statusNote: input.note,
      ...(input.action === "CONSENT" ? { consentedById: actor.userId, consentedAt: now, nextDueDate: dateOnly(firstDue) } : {}),
    },
  });
  await audit(tx, actor, { action: `maintenance_plan.${input.action.toLowerCase()}`, targetType: "maintenance_plan", targetId: planId, reason: input.note });
  await emitEvent(tx, actor, { type: "maintenance_plan.updated", aggregateType: "maintenance_plan", aggregateId: planId, payload: { status: rule.to } });
  return { status: rule.to };
}

export async function listPlans(tx: Tx, actor: Actor) {
  if (can.technician(actor)) throw forbidden();
  const where = actor.orgType === "CUSTOMER" ? { customerOrgId: actor.orgId } : { providerOrgId: actor.orgId };
  const plans = await tx.maintenancePlan.findMany({
    where,
    orderBy: [{ status: "asc" }, { nextDueDate: "asc" }],
    include: {
      equipment: { select: { id: true, label: true, brand: true, model: true } },
      occurrences: { orderBy: { dueDate: "desc" }, take: 3 },
    },
  });
  const orgIds = [...new Set(plans.flatMap((p) => [p.customerOrgId, p.providerOrgId]))];
  const orgs = orgIds.length ? await tx.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } }) : [];
  const names = new Map(orgs.map((o) => [o.id, o.name]));
  return plans.map((p) => ({ ...p, customerName: names.get(p.customerOrgId) ?? "—", providerName: names.get(p.providerOrgId) ?? "—" }));
}

/** Equipment a provider may propose plans for (serviced by it). */
export async function serviceableEquipment(tx: Tx, actor: Actor) {
  if (!can.providerManage(actor)) throw forbidden();
  const bookings = await tx.booking.findMany({
    where: { providerOrgId: actor.orgId, status: { in: ["CONFIRMED", "COMPLETED"] } },
    distinct: ["equipmentId"],
    select: { equipment: { select: { id: true, label: true, brand: true, model: true } }, site: { select: { name: true, city: true } } },
  });
  return bookings.map((b) => ({ ...b.equipment, siteName: b.site.name, city: b.site.city }));
}
