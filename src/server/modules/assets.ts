import "server-only";
import type { z } from "zod";
import type { equipmentSchema, equipmentUpdateSchema, siteSchema, siteUpdateSchema } from "@/lib/schemas";
import { type Actor, can } from "@/server/auth/roles";
import type { Tx } from "@/server/db/context";
import { DomainError, forbidden, notFound, validation } from "@/server/errors";
import { audit } from "@/server/lib/infra";
import { findServiceAreaForCity } from "./reference";

const PAGE_SIZE = 20;

function assertWriter(actor: Actor) {
  if (!can.customerWrite(actor)) throw forbidden("Votre rôle permet uniquement la consultation.");
}

// --- Sites --------------------------------------------------------------------------

export async function listSites(tx: Tx, actor: Actor, opts: { includeArchived?: boolean } = {}) {
  if (!can.customerRead(actor)) throw forbidden();
  return tx.site.findMany({
    where: { customerOrgId: actor.orgId, ...(opts.includeArchived ? {} : { archivedAt: null }) },
    orderBy: [{ archivedAt: "asc" }, { name: "asc" }],
    include: {
      serviceArea: { select: { name: true } },
      _count: { select: { equipment: { where: { archivedAt: null } } } },
    },
  });
}

export async function getSite(tx: Tx, actor: Actor, siteId: string) {
  const site = await tx.site.findFirst({
    where: { id: siteId, customerOrgId: actor.orgId },
    include: {
      serviceArea: { select: { name: true } },
      equipment: { orderBy: [{ archivedAt: "asc" }, { label: "asc" }], include: { category: { select: { labelFr: true } } } },
    },
  });
  if (!site) throw notFound("Site");
  return site;
}

export async function createSite(tx: Tx, actor: Actor, input: z.output<typeof siteSchema>) {
  assertWriter(actor);
  const area = await findServiceAreaForCity(tx, input.city);
  const site = await tx.site.create({
    data: { ...input, customerOrgId: actor.orgId, serviceAreaId: area?.id ?? null },
    select: { id: true, serviceAreaId: true },
  });
  await audit(tx, actor, { action: "site.created", targetType: "site", targetId: site.id });
  return site;
}

export async function updateSite(tx: Tx, actor: Actor, siteId: string, input: z.output<typeof siteUpdateSchema>) {
  assertWriter(actor);
  const { version, ...data } = input;
  const area = await findServiceAreaForCity(tx, data.city);
  const result = await tx.site.updateMany({
    where: { id: siteId, customerOrgId: actor.orgId, version },
    data: { ...data, serviceAreaId: area?.id ?? null, version: { increment: 1 } },
  });
  if (result.count === 0) {
    const exists = await tx.site.count({ where: { id: siteId, customerOrgId: actor.orgId } });
    if (!exists) throw notFound("Site");
    throw new DomainError("VERSION_CONFLICT", "Ce site a été modifié entre-temps. Rechargez la page pour voir la dernière version.");
  }
  await audit(tx, actor, { action: "site.updated", targetType: "site", targetId: siteId });
  return { id: siteId };
}

export async function setSiteArchived(tx: Tx, actor: Actor, siteId: string, archived: boolean) {
  assertWriter(actor);
  const site = await tx.site.findFirst({ where: { id: siteId, customerOrgId: actor.orgId } });
  if (!site) throw notFound("Site");
  if (archived) {
    const active = await tx.serviceRequest.count({ where: { siteId, status: { in: ["DRAFT", "OPEN", "BOOKING"] } } });
    if (active > 0) throw new DomainError("INVALID_TRANSITION", "Ce site a des demandes en cours. Clôturez-les avant d'archiver.");
  }
  await tx.site.update({ where: { id: siteId }, data: { archivedAt: archived ? new Date() : null, version: { increment: 1 } } });
  if (archived) {
    await tx.equipment.updateMany({ where: { siteId, archivedAt: null }, data: { archivedAt: new Date() } });
  }
  await audit(tx, actor, { action: archived ? "site.archived" : "site.restored", targetType: "site", targetId: siteId });
}

// --- Equipment ----------------------------------------------------------------------

export async function listEquipment(
  tx: Tx,
  actor: Actor,
  opts: { siteId?: string; categoryId?: string; includeArchived?: boolean; page?: number } = {},
) {
  if (!can.customerRead(actor)) throw forbidden();
  const where = {
    customerOrgId: actor.orgId,
    ...(opts.siteId ? { siteId: opts.siteId } : {}),
    ...(opts.categoryId ? { categoryId: opts.categoryId } : {}),
    ...(opts.includeArchived ? {} : { archivedAt: null }),
  };
  const page = opts.page ?? 1;
  const [items, total] = await Promise.all([
    tx.equipment.findMany({
      where,
      orderBy: [{ archivedAt: "asc" }, { label: "asc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        site: { select: { id: true, name: true, city: true } },
        category: { select: { id: true, labelFr: true } },
      },
    }),
    tx.equipment.count({ where }),
  ]);
  const ids = items.map((e) => e.id);
  const [lastWork, openRequests] = await Promise.all([
    ids.length
      ? tx.workOrder.findMany({
          where: { equipmentId: { in: ids }, status: "REPORT_SUBMITTED" },
          orderBy: { completedAt: "desc" },
          distinct: ["equipmentId"],
          select: { equipmentId: true, completedAt: true },
        })
      : [],
    ids.length
      ? tx.serviceRequest.groupBy({ by: ["equipmentId"], where: { equipmentId: { in: ids }, status: { in: ["OPEN", "BOOKING"] } }, _count: true })
      : [],
  ]);
  const lastByEquipment = new Map(lastWork.map((w) => [w.equipmentId, w.completedAt]));
  const openByEquipment = new Map(openRequests.map((r) => [r.equipmentId, r._count]));
  return {
    items: items.map((e) => ({ ...e, lastServiceAt: lastByEquipment.get(e.id) ?? null, openRequests: openByEquipment.get(e.id) ?? 0 })),
    total,
    page,
    pageSize: PAGE_SIZE,
  };
}

export async function getEquipment(tx: Tx, actor: Actor, equipmentId: string) {
  const equipment = await tx.equipment.findFirst({
    where: { id: equipmentId, customerOrgId: actor.orgId },
    include: {
      site: { select: { id: true, name: true, city: true, archivedAt: true } },
      category: { select: { id: true, labelFr: true } },
    },
  });
  if (!equipment) throw notFound("Équipement");
  return equipment;
}

/** Complete service history of one asset: work orders, reports, approved scopes, plans. */
export async function getEquipmentHistory(tx: Tx, actor: Actor, equipmentId: string) {
  await getEquipment(tx, actor, equipmentId);
  const [workOrders, requests, plans] = await Promise.all([
    tx.workOrder.findMany({
      where: { equipmentId, customerOrgId: actor.orgId },
      orderBy: { createdAt: "desc" },
      include: {
        booking: { select: { reference: true, scheduledStart: true, technicianName: true, providerOrgId: true, status: true } },
        report: { select: { id: true, findings: true, workPerformed: true, nextServiceDate: true, submittedAt: true, repairDeclined: true } },
        repairQuotes: {
          include: { versions: { where: { status: { in: ["APPROVED", "REJECTED"] } }, select: { id: true, versionNo: true, status: true, totalMinor: true, currency: true } } },
        },
      },
    }),
    tx.serviceRequest.findMany({
      where: { equipmentId, customerOrgId: actor.orgId },
      orderBy: { createdAt: "desc" },
      select: { id: true, reference: true, title: true, kind: true, status: true, createdAt: true },
    }),
    tx.maintenancePlan.findMany({
      where: { equipmentId, customerOrgId: actor.orgId },
      orderBy: { createdAt: "desc" },
      select: { id: true, title: true, status: true, intervalMonths: true, nextDueDate: true, providerOrgId: true },
    }),
  ]);
  const providerIds = [...new Set([...workOrders.map((w) => w.booking.providerOrgId), ...plans.map((p) => p.providerOrgId)])];
  const providers = providerIds.length
    ? await tx.organization.findMany({ where: { id: { in: providerIds } }, select: { id: true, name: true } })
    : [];
  const providerName = new Map(providers.map((p) => [p.id, p.name]));
  return {
    workOrders: workOrders.map((w) => ({ ...w, providerName: providerName.get(w.booking.providerOrgId) ?? "—" })),
    requests,
    plans: plans.map((p) => ({ ...p, providerName: providerName.get(p.providerOrgId) ?? "—" })),
  };
}

export async function createEquipment(tx: Tx, actor: Actor, input: z.output<typeof equipmentSchema>) {
  assertWriter(actor);
  const site = await tx.site.findFirst({ where: { id: input.siteId, customerOrgId: actor.orgId, archivedAt: null } });
  if (!site) throw validation("Site invalide.", { siteId: ["Choisissez un site actif de votre entreprise."] });
  const category = await tx.equipmentCategory.findFirst({ where: { id: input.categoryId, active: true } });
  if (!category) throw validation("Catégorie invalide.", { categoryId: ["Catégorie inconnue."] });
  const equipment = await tx.equipment.create({
    data: { ...input, customerOrgId: actor.orgId },
    select: { id: true },
  });
  await audit(tx, actor, { action: "equipment.created", targetType: "equipment", targetId: equipment.id });
  return equipment;
}

export async function updateEquipment(tx: Tx, actor: Actor, equipmentId: string, input: z.output<typeof equipmentUpdateSchema>) {
  assertWriter(actor);
  const { version, ...data } = input;
  const category = await tx.equipmentCategory.findFirst({ where: { id: data.categoryId } });
  if (!category) throw validation("Catégorie invalide.", { categoryId: ["Catégorie inconnue."] });
  const result = await tx.equipment.updateMany({
    where: { id: equipmentId, customerOrgId: actor.orgId, version, archivedAt: null },
    data: { ...data, version: { increment: 1 } },
  });
  if (result.count === 0) {
    const exists = await tx.equipment.findFirst({ where: { id: equipmentId, customerOrgId: actor.orgId } });
    if (!exists) throw notFound("Équipement");
    if (exists.archivedAt) throw new DomainError("INVALID_TRANSITION", "Un équipement archivé ne peut pas être modifié.");
    throw new DomainError("VERSION_CONFLICT", "Cet équipement a été modifié entre-temps. Rechargez la page.");
  }
  await audit(tx, actor, { action: "equipment.updated", targetType: "equipment", targetId: equipmentId });
  return { id: equipmentId };
}

/** Assets involved in historical jobs are archived, never deleted. */
export async function setEquipmentArchived(tx: Tx, actor: Actor, equipmentId: string, archived: boolean) {
  assertWriter(actor);
  const equipment = await tx.equipment.findFirst({ where: { id: equipmentId, customerOrgId: actor.orgId }, include: { site: true } });
  if (!equipment) throw notFound("Équipement");
  if (archived) {
    const active = await tx.serviceRequest.count({ where: { equipmentId, status: { in: ["DRAFT", "OPEN", "BOOKING"] } } });
    if (active > 0) throw new DomainError("INVALID_TRANSITION", "Cet équipement a des demandes en cours.");
  } else if (equipment.site.archivedAt) {
    throw new DomainError("INVALID_TRANSITION", "Restaurez d'abord le site de cet équipement.");
  }
  await tx.equipment.update({ where: { id: equipmentId }, data: { archivedAt: archived ? new Date() : null, version: { increment: 1 } } });
  await audit(tx, actor, { action: archived ? "equipment.archived" : "equipment.restored", targetType: "equipment", targetId: equipmentId });
}
