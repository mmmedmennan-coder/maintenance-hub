import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import type { Actor, Role } from "@/server/auth/roles";
import { withActor } from "@/server/db/context";
import { ensureMembership, ensureOrganization, ensureUser } from "@/server/fixtures/identity";
import { DEFAULT_AREA_CODE, PILOT_PLAN_CODE } from "@/server/fixtures/reference-data";
import { createEquipment, createSite } from "@/server/modules/assets";
import { addDaysToDateString, localDateString } from "@/lib/time";

let owner: PrismaClient | undefined;
export function ownerDb() {
  owner ??= new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.MIGRATION_DATABASE_URL!, max: 3 }) });
  return owner;
}

export const uid = () => randomUUID().slice(0, 8);

export async function makeUser(orgId: string, orgName: string, orgType: Actor["orgType"], role: Role, name = `User ${uid()}`): Promise<Actor> {
  const db = ownerDb();
  const email = `${role}.${uid()}@test.maintenance-hub.test`;
  const user = await ensureUser(db, { email, name, password: "Test-password-123" });
  await ensureMembership(db, orgId, user.id, role);
  return { userId: user.id, userName: name, userEmail: email, orgId, orgName, orgType, role };
}

export async function categories() {
  return ownerDb().equipmentCategory.findMany({ orderBy: { sortOrder: "asc" } });
}

export async function makeCustomer(label = "Client") {
  const db = ownerDb();
  const name = `${label} ${uid()}`;
  const org = await ensureOrganization(db, { slug: `c-${uid()}`, name, type: "CUSTOMER", city: "Rabat" });
  const ownerActor = await makeUser(org.id, name, "CUSTOMER", "customer_owner");
  const viewer = await makeUser(org.id, name, "CUSTOMER", "customer_viewer");
  const [cat] = await categories();
  const site = await withActor(ownerActor, (tx) =>
    createSite(tx, ownerActor, { name: "Site principal", addressLine: "12 avenue de France", city: "Rabat", accessNotes: "Code portail 1234", contactName: "Nadia", contactPhone: "0600000000" }),
  );
  const equipment = await withActor(ownerActor, (tx) =>
    createEquipment(tx, ownerActor, { siteId: site.id, categoryId: cat!.id, label: "Vitrine 1", brand: "Frigo", model: "V200", serialNumber: null, installedYear: 2020, notes: null }),
  );
  return { org, owner: ownerActor, viewer, site, equipment, categoryId: cat!.id };
}

/**
 * Approved provider with an active subscription, one dispatcher and two technicians who are
 * available 06:00–22:00 every day (local time).
 */
export async function makeProvider(label = "Prestataire", opts: { approved?: boolean; subscribed?: boolean } = {}) {
  const db = ownerDb();
  const name = `${label} ${uid()}`;
  const org = await ensureOrganization(db, { slug: `p-${uid()}`, name, type: "PROVIDER", city: "Rabat" });
  const manager = await makeUser(org.id, name, "PROVIDER", "provider_owner");
  const techUser1 = await makeUser(org.id, name, "PROVIDER", "technician", "Tech Un");
  const techUser2 = await makeUser(org.id, name, "PROVIDER", "technician", "Tech Deux");
  const area = await db.serviceArea.findUniqueOrThrow({ where: { code: DEFAULT_AREA_CODE } });
  const cats = await categories();
  const profile = await db.providerProfile.create({
    data: {
      providerOrgId: org.id,
      slug: `prov-${uid()}`,
      displayName: name,
      summary: "Maintenance froid commercial",
      description: "Entreprise de test pour les scénarios d'intégration, froid commercial.",
      city: "Rabat",
      serviceHours: { "1": [480, 1080] },
      status: opts.approved === false ? "DRAFT" : "APPROVED",
    },
  });
  await db.providerServiceArea.create({ data: { providerProfileId: profile.id, serviceAreaId: area.id, providerOrgId: org.id } });
  await db.providerCategory.createMany({ data: cats.map((c) => ({ providerProfileId: profile.id, equipmentCategoryId: c.id, providerOrgId: org.id })) });
  const technicians = [];
  for (const u of [techUser1, techUser2]) {
    const tech = await db.technicianProfile.create({ data: { providerOrgId: org.id, userId: u.userId, displayName: u.userName } });
    await db.availabilityWindow.createMany({
      data: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ providerOrgId: org.id, technicianId: tech.id, weekday, startMinute: 360, endMinute: 1320 })),
    });
    technicians.push({ actor: u, id: tech.id });
  }
  if (opts.subscribed !== false) {
    const plan = await db.subscriptionPlan.findUniqueOrThrow({ where: { code: PILOT_PLAN_CODE } });
    const today = localDateString(new Date());
    await db.providerSubscription.create({ data: { providerOrgId: org.id, planId: plan.id, paidUntil: new Date(`${addDaysToDateString(today, 30)}T00:00:00Z`) } });
  }
  return { org, manager, technicians, profile };
}

export async function makeAdmin() {
  const db = ownerDb();
  const org = await ensureOrganization(db, { slug: "plateforme-test", name: "Plateforme", type: "PLATFORM" });
  return makeUser(org.id, org.name, "PLATFORM", "platform_admin", "Admin Test");
}

/** Local date string N days from today (Africa/Casablanca). */
export function inDays(n: number) {
  return addDaysToDateString(localDateString(new Date()), n);
}

export async function expectCode(promise: Promise<unknown>, code: string) {
  try {
    await promise;
  } catch (error) {
    const actual = (error as { code?: string }).code;
    if (actual !== code) throw new Error(`Expected ${code} but got ${actual}: ${(error as Error).message}`);
    return error;
  }
  throw new Error(`Expected ${code} but the operation succeeded`);
}
