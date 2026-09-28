import "server-only";
import type { z } from "zod";
import type { categorySchema, serviceAreaSchema } from "@/lib/schemas";
import { type Actor, can } from "@/server/auth/roles";
import type { Tx } from "@/server/db/context";
import { DomainError, forbidden, notFound } from "@/server/errors";
import { audit } from "@/server/lib/infra";

export async function listEquipmentCategories(tx: Tx, opts: { includeInactive?: boolean } = {}) {
  return tx.equipmentCategory.findMany({
    where: opts.includeInactive ? {} : { active: true },
    orderBy: [{ sortOrder: "asc" }, { labelFr: "asc" }],
    select: { id: true, code: true, labelFr: true, active: true, sortOrder: true, serviceCategoryId: true },
  });
}

export async function listServiceAreas(tx: Tx, opts: { includeInactive?: boolean } = {}) {
  return tx.serviceArea.findMany({
    where: opts.includeInactive ? {} : { active: true },
    orderBy: { name: "asc" },
    select: { id: true, code: true, name: true, cities: true, timezone: true, routingHours: true, active: true },
  });
}

/** Resolves the configured service area covering a city (case/accent-insensitive). */
export async function findServiceAreaForCity(tx: Tx, city: string) {
  const norm = normalizeCity(city);
  const areas = await listServiceAreas(tx);
  return areas.find((a) => a.cities.some((c) => normalizeCity(c) === norm)) ?? null;
}

export function normalizeCity(city: string) {
  return city
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}

export async function upsertEquipmentCategory(tx: Tx, actor: Actor, id: string | null, input: z.output<typeof categorySchema>) {
  if (!can.admin(actor)) throw forbidden();
  const service = await tx.serviceCategory.findFirst({ where: { code: "COMMERCIAL_REFRIGERATION" } });
  if (!service) throw new DomainError("INTERNAL", "Catégorie de service manquante.");
  const data = { labelFr: input.labelFr, code: input.code, active: input.active, sortOrder: input.sortOrder };
  const row = id
    ? await tx.equipmentCategory.update({ where: { id }, data })
    : await tx.equipmentCategory.create({ data: { ...data, serviceCategoryId: service.id } });
  await audit(tx, actor, { action: id ? "category.updated" : "category.created", targetType: "equipment_category", targetId: row.id, metadata: data });
  return row;
}

export async function upsertServiceArea(tx: Tx, actor: Actor, id: string | null, input: z.output<typeof serviceAreaSchema>) {
  if (!can.admin(actor)) throw forbidden();
  const data = { name: input.name, code: input.code, cities: input.cities, routingHours: input.routingHours, active: input.active };
  if (id) {
    const existing = await tx.serviceArea.findUnique({ where: { id } });
    if (!existing) throw notFound("Zone");
  }
  const row = id ? await tx.serviceArea.update({ where: { id }, data }) : await tx.serviceArea.create({ data });
  await audit(tx, actor, { action: id ? "service_area.updated" : "service_area.created", targetType: "service_area", targetId: row.id, metadata: { code: input.code } });
  return row;
}
