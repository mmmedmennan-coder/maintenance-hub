/**
 * Reference data required by every environment (idempotent upserts through the owner
 * connection): the commercial-refrigeration service category, equipment categories, the
 * initial configurable service area (Rabat-Salé) and the pilot subscription plan.
 * Used by `npm run db:seed`, `npm run admin:create` and the integration tests.
 */
import type { PrismaClient } from "@/generated/prisma/client";

export const SERVICE_CATEGORY_CODE = "COMMERCIAL_REFRIGERATION";
export const DEFAULT_AREA_CODE = "RABAT_SALE";
export const PILOT_PLAN_CODE = "PILOT_399";

export const EQUIPMENT_CATEGORIES = [
  { code: "DISPLAY_CABINET", labelFr: "Vitrine réfrigérée", sortOrder: 10 },
  { code: "REACH_IN", labelFr: "Armoire réfrigérée", sortOrder: 20 },
  { code: "COLD_ROOM_POSITIVE", labelFr: "Chambre froide positive", sortOrder: 30 },
  { code: "COLD_ROOM_NEGATIVE", labelFr: "Chambre froide négative", sortOrder: 40 },
  { code: "FREEZER", labelFr: "Congélateur professionnel", sortOrder: 50 },
  { code: "ICE_MACHINE", labelFr: "Machine à glaçons", sortOrder: 60 },
  { code: "CONDENSING_UNIT", labelFr: "Groupe frigorifique", sortOrder: 70 },
] as const;

const WEEKDAY_HOURS = { "1": [480, 1080], "2": [480, 1080], "3": [480, 1080], "4": [480, 1080], "5": [480, 1080], "6": [540, 780] };

export async function ensureReferenceData(db: PrismaClient) {
  const service = await db.serviceCategory.upsert({
    where: { code: SERVICE_CATEGORY_CODE },
    create: { code: SERVICE_CATEGORY_CODE, labelFr: "Froid commercial" },
    update: {},
  });
  for (const c of EQUIPMENT_CATEGORIES) {
    await db.equipmentCategory.upsert({
      where: { code: c.code },
      create: { ...c, serviceCategoryId: service.id },
      update: {},
    });
  }
  const area = await db.serviceArea.upsert({
    where: { code: DEFAULT_AREA_CODE },
    create: {
      code: DEFAULT_AREA_CODE,
      name: "Rabat-Salé",
      cities: ["Rabat", "Salé", "Témara", "Skhirat"],
      routingHours: WEEKDAY_HOURS,
    },
    update: {},
  });
  const plan = await db.subscriptionPlan.upsert({
    where: { code: PILOT_PLAN_CODE },
    create: {
      code: PILOT_PLAN_CODE,
      name: "Pilote prestataire",
      priceMinor: 39900,
      currency: "MAD",
      period: "MONTH",
      maxStaff: 3,
      taxNote: "Hors taxes applicables. Prix pilote à valider.",
    },
    update: {},
  });
  const categories = await db.equipmentCategory.findMany({ orderBy: { sortOrder: "asc" } });
  return { service, area, plan, categories };
}
