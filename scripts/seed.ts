/**
 * Development/demo seed — synthetic, clearly labelled data for local use only.
 *
 *   npm run db:seed
 *
 * Refuses to run when NODE_ENV=production or when ALLOW_DEMO_SEED is not "true". Idempotent:
 * accounts, organisations, sites, equipment and technicians are created only if missing, and
 * the workflow scenarios are replayed only when the demo customer has no request yet (use
 * `npm run db:reset-dev -- --yes && npm run db:migrate && npm run db:seed` to start over).
 *
 * Every scenario goes through the real domain services (row-level security, triggers,
 * immutable versions, hashes). Past visits are replayed with a process-local demo clock so
 * that dates are relative to the day the seed runs.
 */
import { realNow, resetClock, setClock } from "./lib/demo-clock";
import { loadEnv } from "./lib/load-env";
import { ownerDb } from "./lib/owner-db";
import type { PrismaClient } from "@/generated/prisma/client";
import { addDaysToDateString, isoWeekday, localDateString, localTimeString, localToUtc } from "@/lib/time";
import type { Actor, Role } from "@/server/auth/roles";
import { disconnectAll, workerDb } from "@/server/db/clients";
import { withActor } from "@/server/db/context";
import { ensureMembership, ensureOrganization, ensureUser } from "@/server/fixtures/identity";
import { DEFAULT_AREA_CODE, ensureReferenceData } from "@/server/fixtures/reference-data";
import { recordSubscriptionPeriod, reviewProvider, upsertProviderCheck } from "@/server/modules/admin";
import { createEquipment, createSite } from "@/server/modules/assets";
import { confirmBooking } from "@/server/modules/bookings";
import { createReview, moderateReview } from "@/server/modules/feedback";
import { decidePlan, proposePlan } from "@/server/modules/maintenance";
import { issueOffer, saveOfferDraft, selectOfferVersion } from "@/server/modules/offers";
import { paymentSummary, recordPayment, updatePayment } from "@/server/modules/payments";
import { createRequestDraft, inviteProviders, submitRequest } from "@/server/modules/requests";
import { addAvailabilityWindow, createTechnician } from "@/server/modules/technicians";
import { decideRepairQuote, issueRepairQuote, performWorkAction, respondToReport, saveRepairQuoteDraft, submitReport } from "@/server/modules/work";
import { processOutboxBatch } from "@/server/worker/queue";
import { runScheduledTasks } from "@/server/worker/scheduler";

const DOMAIN = "demo.maintenance-hub.test";
const DEMO_NOTE = "Données de démonstration : aucun contrôle réel n'a été effectué.";

type Db = PrismaClient;
type Tech = { id: string; actor: Actor | null };

// --- Dates relative to today (Africa/Casablanca) ----------------------------------------------

const today = () => localDateString(realNow());
const weekday = (date: string) => isoWeekday(new Date(`${date}T12:00:00Z`), "UTC");
/** Nearest Monday–Saturday on or before `date`. */
function workdayOnOrBefore(date: string) {
  let d = date;
  while (weekday(d) === 7) d = addDaysToDateString(d, -1);
  return d;
}
function workdayOnOrAfter(date: string) {
  let d = date;
  while (weekday(d) === 7) d = addDaysToDateString(d, 1);
  return d;
}
const at = (date: string, time: string) => localToUtc(date, time);
/** Moves the demo clock to a local date/time, then runs the step. */
async function when<T>(date: string, time: string, step: () => Promise<T>): Promise<T> {
  setClock(at(date, time));
  return step();
}

// --- Identity -----------------------------------------------------------------------------------

async function member(db: Db, org: { id: string; name: string; type: Actor["orgType"] }, email: string, name: string, role: Role, password: string): Promise<Actor> {
  const user = await ensureUser(db, { email: `${email}@${DOMAIN}`, name, password, verified: true });
  await ensureMembership(db, org.id, user.id, role);
  return { userId: user.id, userName: user.name, userEmail: user.email, orgId: org.id, orgName: org.name, orgType: org.type, role };
}

async function organization(db: Db, slug: string, name: string, type: Actor["orgType"], city?: string) {
  const org = await ensureOrganization(db, { slug, name, type, city, isDemo: type !== "PLATFORM" });
  return { id: org.id, name: org.name, type };
}

// --- Assets ---------------------------------------------------------------------------------------

async function site(db: Db, owner: Actor, input: { name: string; addressLine: string; city: string; accessNotes: string; contactName: string; contactPhone: string }) {
  const existing = await db.site.findFirst({ where: { customerOrgId: owner.orgId, name: input.name } });
  if (existing) return existing.id;
  return (await withActor(owner, (tx) => createSite(tx, owner, input))).id;
}

async function equipment(db: Db, owner: Actor, siteId: string, categoryId: string, input: { label: string; brand: string | null; model: string | null; serialNumber: string | null; installedYear: number | null }) {
  const existing = await db.equipment.findFirst({ where: { customerOrgId: owner.orgId, label: input.label } });
  if (existing) return existing.id;
  return (await withActor(owner, (tx) => createEquipment(tx, owner, { siteId, categoryId, notes: null, ...input }))).id;
}

// --- Providers ------------------------------------------------------------------------------------

async function providerProfile(
  db: Db,
  admin: Actor,
  org: { id: string; name: string },
  input: { slug: string; displayName: string; summary: string; description: string; city: string; categoryIds: string[]; approve: boolean },
) {
  const existing = await db.providerProfile.findFirst({ where: { providerOrgId: org.id } });
  if (existing) return existing.id;
  const area = await db.serviceArea.findUniqueOrThrow({ where: { code: DEFAULT_AREA_CODE } });
  const hours = Object.fromEntries(["1", "2", "3", "4", "5", "6"].map((d) => [d, [480, 1080]]));
  const profile = await db.providerProfile.create({
    data: {
      providerOrgId: org.id,
      slug: input.slug,
      displayName: input.displayName,
      summary: input.summary,
      description: input.description,
      city: input.city,
      serviceHours: hours,
      status: "SUBMITTED",
      submittedAt: new Date(),
      isDemo: true,
    },
  });
  await db.providerServiceArea.create({ data: { providerProfileId: profile.id, serviceAreaId: area.id, providerOrgId: org.id } });
  await db.providerCategory.createMany({ data: input.categoryIds.map((id) => ({ providerProfileId: profile.id, equipmentCategoryId: id, providerOrgId: org.id })) });
  if (input.approve) {
    await withActor(admin, async (tx) => {
      await upsertProviderCheck(tx, admin, profile.id, { type: "BUSINESS_IDENTITY", status: "VERIFIED", publicNote: DEMO_NOTE, internalNote: "Seed de démonstration.", expiresAt: null });
      await upsertProviderCheck(tx, admin, profile.id, { type: "TECHNICAL_EXPERIENCE", status: "VERIFIED", publicNote: DEMO_NOTE, internalNote: "Seed de démonstration.", expiresAt: null });
      await reviewProvider(tx, admin, profile.id, { decision: "APPROVE", reason: "Profil de démonstration." });
      const start = addDaysToDateString(today(), -75);
      await recordSubscriptionPeriod(tx, admin, org.id, {
        periodStart: start,
        periodEnd: addDaysToDateString(today(), 20),
        amount: 39900 * 3,
        reference: "DEMO",
        reason: "Période de démonstration — aucun paiement réel.",
      });
    });
  }
  return profile.id;
}

async function technician(db: Db, manager: Actor, name: string, account: Actor | null, skillIds: string[], days: number[], start = "08:00", end = "18:00"): Promise<Tech> {
  const existing = await db.technicianProfile.findFirst({ where: { providerOrgId: manager.orgId, displayName: name } });
  if (existing) return { id: existing.id, actor: account };
  const tech = await withActor(manager, (tx) => createTechnician(tx, manager, { displayName: name, phone: null, userId: account?.userId ?? null, skillIds, active: true }));
  for (const d of days) await withActor(manager, (tx) => addAvailabilityWindow(tx, manager, { technicianId: tech.id, weekday: d, start, end }));
  return { id: tech.id, actor: account };
}

// --- Workflow steps (all through domain services) ---------------------------------------------------

type Window = { date: string; start: string; end: string };

async function newRequest(customer: Actor, equipmentId: string, kind: "DIAGNOSTIC" | "MAINTENANCE" | "BREAKDOWN", title: string, symptoms: string, windows: Window[], submit = true) {
  const r = await withActor(customer, (tx) => createRequestDraft(tx, customer, { equipmentId, kind, title, symptoms, preferredWindows: windows }));
  if (submit) await withActor(customer, (tx) => submitRequest(tx, customer, r.id));
  return r.id;
}

async function invite(customer: Actor, requestId: string, providers: string[]) {
  await withActor(customer, (tx) => inviteProviders(tx, customer, requestId, { providerOrgIds: providers }));
}

type OfferInput = { kind: "DIAGNOSTIC" | "MAINTENANCE"; scope: string; callout: number | null; fee: number; date: string; from: string; to: string; duration: number; exclusions?: string; warranty?: string };

async function offer(manager: Actor, requestId: string, o: OfferInput) {
  const invitation = await withActor(manager, (tx) => tx.requestInvitation.findFirstOrThrow({ where: { requestId, providerOrgId: manager.orgId } }));
  const draft = await withActor(manager, (tx) =>
    saveOfferDraft(tx, manager, invitation.id, {
      kind: o.kind,
      scope: o.scope,
      calloutFee: o.callout,
      serviceFee: o.fee,
      taxRate: 2000,
      taxNote: null,
      windowDate: o.date,
      windowStart: o.from,
      windowEnd: o.to,
      estimatedDurationMin: o.duration,
      exclusions: o.exclusions ?? "Pièces et fluide frigorigène non inclus.",
      cancellationTerms: "Annulation sans frais jusqu'à 24 h avant le rendez-vous ; au-delà, frais de déplacement dus.",
      warrantyTerms: o.warranty ?? null,
      validDays: 7,
    }),
  );
  await withActor(manager, (tx) => issueOffer(tx, manager, draft.offerId));
  return draft;
}

async function select(customer: Actor, versionId: string) {
  return (await withActor(customer, (tx) => selectOfferVersion(tx, customer, versionId))).bookingId;
}

async function confirm(manager: Actor, bookingId: string, tech: Tech, date: string, start: string, durationMin: number) {
  const booking = await withActor(manager, (tx) => tx.booking.findUniqueOrThrow({ where: { id: bookingId } }));
  return withActor(manager, (tx) =>
    confirmBooking(tx, manager, bookingId, { technicianId: tech.id, date, start, durationMin, bufferBeforeMin: 30, bufferAfterMin: 30, expectedLockVersion: booking.lockVersion }),
  );
}

async function work(actor: Actor, workOrderId: string, action: "START_TRAVEL" | "ARRIVE" | "START_WORK" | "WAIT_FOR_PARTS", note: string | null = null) {
  const wo = await withActor(actor, (tx) => tx.workOrder.findUniqueOrThrow({ where: { id: workOrderId } }));
  await withActor(actor, (tx) => performWorkAction(tx, actor, workOrderId, { action, note, expectedLockVersion: wo.lockVersion }));
}

type Line = { kind: "PART" | "LABOR" | "TRAVEL" | "OTHER"; description: string; quantity: number; unitPrice: number };

async function quote(actor: Actor, workOrderId: string, scopeSummary: string, lines: Line[], extra: { timingNote?: string; warrantyTerms?: string; exclusions?: string } = {}) {
  const draft = await withActor(actor, (tx) =>
    saveRepairQuoteDraft(tx, actor, workOrderId, null, {
      title: undefined,
      scopeSummary,
      estimatedDurationMin: 120,
      timingNote: extra.timingNote ?? null,
      exclusions: extra.exclusions ?? null,
      warrantyTerms: extra.warrantyTerms ?? "Pièces garanties 6 mois, main-d'œuvre 3 mois.",
      validDays: 7,
      revisionReason: null,
      lines: lines.map((l) => ({ ...l, taxRate: 2000 })),
    }),
  );
  const issued = await withActor(actor, (tx) => issueRepairQuote(tx, actor, draft.versionId));
  return { versionId: draft.versionId, hash: issued.snapshotHash };
}

async function decide(customer: Actor, q: { versionId: string; hash: string }, decision: "APPROVED" | "REJECTED", reason: string | null = null) {
  await withActor(customer, (tx) => decideRepairQuote(tx, customer, q.versionId, { decision, expectedSnapshotHash: q.hash, reason }));
}

async function report(actor: Actor, workOrderId: string, r: { findings: string; workPerformed: string; partsUsed?: string; recommendations?: string; nextServiceDate?: string }) {
  await withActor(actor, (tx) =>
    submitReport(tx, actor, workOrderId, {
      findings: r.findings,
      workPerformed: r.workPerformed,
      partsUsed: r.partsUsed ?? null,
      recommendations: r.recommendations ?? null,
      nextServiceDate: r.nextServiceDate ?? null,
      photoDocumentIds: [],
    }),
  );
}

async function pay(actor: Actor, bookingId: string, method: "CASH" | "BANK_TRANSFER" | "CHEQUE", paidOn: string, reference: string | null, amount?: number) {
  const summary = await withActor(actor, (tx) => paymentSummary(tx, bookingId));
  return withActor(actor, (tx) =>
    recordPayment(tx, actor, bookingId, { amount: amount ?? summary.outstandingMinor, method, paidOn, externalReference: reference, note: null, evidenceDocumentId: null }),
  );
}

async function review(db: Db, customer: Actor, admin: Actor | null, bookingId: string, rating: number, comment: string) {
  const r = await withActor(customer, (tx) => createReview(tx, customer, bookingId, { rating, comment }));
  // Demo reviews are flagged so that public pages label them as demonstration content.
  await db.review.update({ where: { id: r.id }, data: { isDemo: true } });
  if (admin) await withActor(admin, (tx) => moderateReview(tx, admin, r.id, { decision: "PUBLISH", note: null }));
}

// --- Main ----------------------------------------------------------------------------------------

async function main() {
  const file = loadEnv();
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed demo data with NODE_ENV=production.");
  if (process.env.ALLOW_DEMO_SEED !== "true") throw new Error("Set ALLOW_DEMO_SEED=true in your local environment file to load demo data.");
  const password = process.env.DEMO_PASSWORD ?? "Demo-Pilote-2026";
  const db = ownerDb();
  try {
    await ensureReferenceData(db);
    const cats = Object.fromEntries((await db.equipmentCategory.findMany()).map((c) => [c.code, c.id])) as Record<string, string>;
    const allCats = Object.values(cats);

    // Platform
    const platform = await organization(db, "plateforme", "Équipe plateforme", "PLATFORM");
    const admin = await member(db, platform, "admin", "Admin Démo", "platform_admin", password);

    // Customers
    const c1 = await organization(db, "demo-superette-al-amal", "Supérette Al Amal (démo)", "CUSTOMER", "Rabat");
    const salma = await member(db, c1, "client", "Salma Benali", "customer_owner", password);
    const youssef = await member(db, c1, "responsable", "Youssef Tazi", "customer_manager", password);
    await member(db, c1, "lecteur", "Imane El Idrissi", "customer_viewer", password);
    const c2 = await organization(db, "demo-restaurant-la-corniche", "Restaurant La Corniche (démo)", "CUSTOMER", "Témara");
    const karim = await member(db, c2, "restaurant", "Karim Alaoui", "customer_owner", password);

    // Providers (staff limit of the pilot plan: 3 members)
    const p1 = await organization(db, "demo-froid-atlas", "Froid Atlas Services (démo)", "PROVIDER", "Rabat");
    const hicham = await member(db, p1, "prestataire", "Hicham Berrada", "provider_owner", password);
    const leila = await member(db, p1, "planificateur", "Leila Chraibi", "provider_dispatcher", password);
    const ahmedUser = await member(db, p1, "technicien", "Ahmed Ouazzani", "technician", password);
    const p2 = await organization(db, "demo-bouregreg-refrigeration", "Bouregreg Réfrigération (démo)", "PROVIDER", "Salé");
    const nabil = await member(db, p2, "prestataire2", "Nabil Sqalli", "provider_owner", password);
    const rachidUser = await member(db, p2, "technicien2", "Rachid Fassi", "technician", password);
    const p3 = await organization(db, "demo-clim-froid-temara", "Clim & Froid Témara (démo)", "PROVIDER", "Témara");
    await member(db, p3, "prestataire3", "Samir Kettani", "provider_owner", password);

    await providerProfile(db, admin, p1, {
      slug: "froid-atlas-services-demo",
      displayName: "Froid Atlas Services (démo)",
      summary: "Maintenance et dépannage de froid commercial à Rabat, Salé et Témara.",
      description:
        "Entreprise fictive de démonstration. Entretien préventif de chambres froides, vitrines et groupes frigorifiques pour commerces de proximité et restauration. Diagnostic sur site, devis détaillé avant toute réparation.",
      city: "Rabat",
      categoryIds: allCats,
      approve: true,
    });
    await providerProfile(db, admin, p2, {
      slug: "bouregreg-refrigeration-demo",
      displayName: "Bouregreg Réfrigération (démo)",
      summary: "Frigoriste pour vitrines, armoires et chambres froides.",
      description:
        "Entreprise fictive de démonstration. Interventions sur vitrines réfrigérées, armoires et chambres froides positives et négatives. Remplacement de ventilateurs, contacteurs, recherche de fuites.",
      city: "Salé",
      categoryIds: [cats.DISPLAY_CABINET!, cats.REACH_IN!, cats.COLD_ROOM_POSITIVE!, cats.COLD_ROOM_NEGATIVE!, cats.FREEZER!, cats.CONDENSING_UNIT!],
      approve: true,
    });
    await providerProfile(db, admin, p3, {
      slug: "clim-froid-temara-demo",
      displayName: "Clim & Froid Témara (démo)",
      summary: "Machines à glaçons et groupes frigorifiques (profil en attente de vérification).",
      description: "Entreprise fictive de démonstration dont le profil a été soumis et attend la vérification de l'équipe de la plateforme.",
      city: "Témara",
      categoryIds: [cats.ICE_MACHINE!, cats.CONDENSING_UNIT!],
      approve: false,
    });

    const ahmed = await technician(db, leila, "Ahmed Ouazzani", ahmedUser, allCats, [1, 2, 3, 4, 5, 6]);
    await technician(db, leila, "Omar Lahlou (sans compte)", null, [cats.DISPLAY_CABINET!, cats.REACH_IN!, cats.FREEZER!], [1, 2, 3, 4, 5], "08:30", "17:00");
    const rachid = await technician(db, nabil, "Rachid Fassi", rachidUser, [cats.DISPLAY_CABINET!, cats.REACH_IN!, cats.COLD_ROOM_POSITIVE!, cats.COLD_ROOM_NEGATIVE!, cats.FREEZER!], [1, 2, 3, 4, 5, 6]);

    // Sites & equipment
    const agdal = await site(db, salma, { name: "Supérette Al Amal — Agdal", addressLine: "14 rue Oued Sebou, Agdal", city: "Rabat", accessNotes: "Livraison par l'arrière, sonner à la réserve. Accès toiture par l'échelle du dépôt.", contactName: "Youssef Tazi", contactPhone: "0600000001" });
    const depot = await site(db, salma, { name: "Dépôt Hay Salam", addressLine: "Lot 27, zone d'activités Hay Salam", city: "Salé", accessNotes: "Ouvert de 7 h à 16 h. Badge à demander au gardien.", contactName: "Salma Benali", contactPhone: "0600000002" });
    const cuisine = await site(db, karim, { name: "La Corniche — cuisine", addressLine: "3 boulevard de la Plage", city: "Témara", accessNotes: "Entrée du personnel côté parking.", contactName: "Karim Alaoui", contactPhone: "0600000003" });
    const e = {
      coldRoom: await equipment(db, salma, agdal, cats.COLD_ROOM_POSITIVE!, { label: "Chambre froide positive — réserve", brand: "Frigotechnic", model: "CFP-12", serialNumber: "DEMO-CFP-0012", installedYear: 2017 }),
      vitrine: await equipment(db, salma, agdal, cats.DISPLAY_CABINET!, { label: "Vitrine réfrigérée fruits et légumes", brand: "Vitrafroid", model: "VM-250", serialNumber: "DEMO-VM-2501", installedYear: 2020 }),
      freezer: await equipment(db, salma, agdal, cats.FREEZER!, { label: "Congélateur coffre glaces", brand: "Polaris", model: "CC-400", serialNumber: null, installedYear: 2021 }),
      condenser: await equipment(db, salma, agdal, cats.CONDENSING_UNIT!, { label: "Groupe frigorifique — toiture", brand: "Coldline", model: "GC-3HP", serialNumber: "DEMO-GC-3303", installedYear: 2016 }),
      saladette: await equipment(db, salma, agdal, cats.REACH_IN!, { label: "Saladette comptoir", brand: null, model: null, serialNumber: null, installedYear: null }),
      negative: await equipment(db, salma, depot, cats.COLD_ROOM_NEGATIVE!, { label: "Chambre froide négative — dépôt", brand: "Frigotechnic", model: "CFN-20", serialNumber: "DEMO-CFN-0020", installedYear: 2015 }),
      ice: await equipment(db, karim, cuisine, cats.ICE_MACHINE!, { label: "Machine à glaçons bar", brand: "Glacis", model: "MG-45", serialNumber: "DEMO-MG-4501", installedYear: 2019 }),
      kitchenNeg: await equipment(db, karim, cuisine, cats.COLD_ROOM_NEGATIVE!, { label: "Chambre froide négative cuisine", brand: null, model: null, serialNumber: null, installedYear: 2018 }),
      pastry: await equipment(db, karim, cuisine, cats.REACH_IN!, { label: "Armoire réfrigérée pâtisserie", brand: "Polaris", model: "AR-700", serialNumber: null, installedYear: 2022 }),
      drinks: await equipment(db, karim, cuisine, cats.DISPLAY_CABINET!, { label: "Vitrine boissons salle", brand: "Vitrafroid", model: "VB-120", serialNumber: null, installedYear: 2021 }),
    };

    const already = await db.serviceRequest.count({ where: { customerOrgId: c1.id } });
    if (already > 0) {
      console.log(`[seed] ${file}: scénarios déjà présents (${already} demande(s)) — rien à rejouer.`);
    } else {
      await scenarios({ db, admin, salma, youssef, karim, hicham, leila, nabil, ahmed, rachid, p1: p1.id, p2: p2.id, e });
    }
    resetClock();

    // Let the worker's handlers run once (notifications, PDFs, competing offers closed, plans).
    for (let i = 0; i < 100; i++) if ((await processOutboxBatch(workerDb(), "seed", 50)).claimed === 0) break;
    await runScheduledTasks(workerDb());
    for (let i = 0; i < 100; i++) if ((await processOutboxBatch(workerDb(), "seed", 50)).claimed === 0) break;

    console.log(`[seed] ${file}: données de démonstration prêtes. Mot de passe commun : ${process.env.DEMO_PASSWORD ? "(DEMO_PASSWORD)" : password}`);
    console.log(
      [
        "  admin@", "client@ (propriétaire client)", "responsable@ (responsable client)", "lecteur@ (lecteur client)", "restaurant@ (2e client)",
        "prestataire@ (propriétaire prestataire)", "planificateur@", "technicien@", "prestataire2@", "technicien2@", "prestataire3@ (profil à vérifier)",
      ]
        .map((s) => `  - ${s.replace("@", `@${DOMAIN}`)}`)
        .join("\n"),
    );
  } finally {
    resetClock();
    await db.$disconnect();
    await disconnectAll();
  }
}

async function scenarios(ctx: {
  db: Db;
  admin: Actor;
  salma: Actor;
  youssef: Actor;
  karim: Actor;
  hicham: Actor;
  leila: Actor;
  nabil: Actor;
  ahmed: Tech;
  rachid: Tech;
  p1: string;
  p2: string;
  e: Record<"coldRoom" | "vitrine" | "freezer" | "condenser" | "saladette" | "negative" | "ice" | "kitchenNeg" | "pastry" | "drinks", string>;
}) {
  const { db, admin, salma, youssef, karim, hicham, leila, nabil, ahmed, rachid, p1, p2, e } = ctx;
  const ahmedActor = ahmed.actor!;
  const rachidActor = rachid.actor!;
  const D = today();
  const day = (n: number) => addDaysToDateString(D, n);

  // H1 — preventive maintenance ~2 months ago, report acknowledged, payment confirmed, review published.
  {
    const d = workdayOnOrBefore(day(-58));
    const req = await when(day(-61), "09:00", () =>
      newRequest(salma, e.coldRoom, "MAINTENANCE", "Entretien préventif chambre froide", "Entretien annuel : nettoyage de l'évaporateur et du condenseur, contrôle des températures et du dégivrage.", [
        { date: d, start: "08:00", end: "12:00" },
      ]),
    );
    await when(day(-61), "09:05", () => invite(salma, req, [p1]));
    const o = await when(day(-61), "15:30", () =>
      offer(hicham, req, { kind: "MAINTENANCE", scope: "Nettoyage évaporateur et condenseur, contrôle des pressions, du dégivrage et des sondes, relevé de températures.", callout: null, fee: 60000, date: d, from: "08:00", to: "12:00", duration: 120, warranty: "Intervention garantie 1 mois." }),
    );
    const bookingId = await when(day(-60), "10:00", () => select(salma, o.versionId));
    const { workOrderId } = await when(day(-60), "11:00", () => confirm(leila, bookingId, ahmed, d, "09:00", 120));
    await when(d, "08:35", () => work(ahmedActor, workOrderId, "START_TRAVEL"));
    await when(d, "09:04", () => work(ahmedActor, workOrderId, "ARRIVE"));
    await when(d, "09:10", () => work(ahmedActor, workOrderId, "START_WORK"));
    await when(d, "10:55", () =>
      report(ahmedActor, workOrderId, {
        findings: "Évaporateur partiellement encrassé, condenseur poussiéreux. Température stable à +3 °C après intervention. Joint de porte en bon état.",
        workPerformed: "Nettoyage évaporateur et condenseur, contrôle des pressions (conformes), vérification des sondes et du cycle de dégivrage.",
        recommendations: "Prévoir un entretien tous les 3 mois compte tenu de l'environnement poussiéreux de la réserve.",
        nextServiceDate: addDaysToDateString(d, 90),
      }),
    );
    await when(d, "17:30", () => withActor(salma, (tx) => respondToReport(tx, salma, workOrderId, { decision: "ACKNOWLEDGE", reason: null })));
    await when(addDaysToDateString(d, 1), "10:00", () => pay(salma, bookingId, "BANK_TRANSFER", addDaysToDateString(d, 1), "VIR-DEMO-0001"));
    await when(addDaysToDateString(d, 1), "18:00", () => review(db, salma, null, bookingId, 5, "Technicien ponctuel, explications claires et rapport détaillé."));
    await when(addDaysToDateString(d, 2), "09:15", async () => {
      const payment = await withActor(hicham, (tx) => tx.paymentRecord.findFirstOrThrow({ where: { bookingId } }));
      await withActor(hicham, (tx) => updatePayment(tx, hicham, payment.id, { action: "CONFIRM", reason: null }));
    });
    await when(addDaysToDateString(d, 2), "11:00", async () => {
      const r = await db.review.findFirstOrThrow({ where: { bookingId } });
      await withActor(admin, (tx) => moderateReview(tx, admin, r.id, { decision: "PUBLISH", note: null }));
    });
  }

  // H2 — diagnosis ~4 weeks ago with two competing offers, repair quote approved, work done, payment recorded.
  {
    const d = workdayOnOrBefore(day(-28));
    const req = await when(day(-31), "08:40", () =>
      newRequest(salma, e.vitrine, "DIAGNOSTIC", "Vitrine qui ne descend plus sous 8 °C", "La vitrine affiche 8 à 9 °C l'après-midi. Le ventilateur intérieur semble bruyant.", [
        { date: d, start: "09:00", end: "13:00" },
        { date: addDaysToDateString(d, 1), start: "09:00", end: "13:00" },
      ]),
    );
    await when(day(-31), "08:45", () => invite(salma, req, [p1, p2]));
    await when(day(-31), "14:00", () =>
      offer(hicham, req, { kind: "DIAGNOSTIC", scope: "Diagnostic complet du circuit et de la ventilation, mesures de températures et pressions.", callout: 15000, fee: 25000, date: d, from: "09:00", to: "13:00", duration: 60 }),
    );
    const o2 = await when(day(-31), "16:20", () =>
      offer(nabil, req, { kind: "DIAGNOSTIC", scope: "Diagnostic de la vitrine (ventilation, sondes, circuit frigorifique) et compte rendu écrit.", callout: 10000, fee: 20000, date: d, from: "09:00", to: "13:00", duration: 60 }),
    );
    const bookingId = await when(day(-30), "09:30", () => select(salma, o2.versionId));
    const { workOrderId } = await when(day(-30), "10:15", () => confirm(nabil, bookingId, rachid, d, "10:00", 60));
    await when(d, "09:35", () => work(rachidActor, workOrderId, "START_TRAVEL"));
    await when(d, "10:03", () => work(rachidActor, workOrderId, "ARRIVE"));
    const q = await when(d, "10:40", () =>
      quote(rachidActor, workOrderId, "Moteur du ventilateur d'évaporateur en fin de vie (roulements) : remplacement du moteur, nettoyage et contrôle du fonctionnement.", [
        { kind: "PART", description: "Moteur de ventilateur d'évaporateur 10 W", quantity: 1000, unitPrice: 42000 },
        { kind: "LABOR", description: "Remplacement et essais (heures)", quantity: 1500, unitPrice: 25000 },
      ], { timingNote: "Pièce disponible dans le véhicule." }),
    );
    await when(d, "11:10", () => decide(youssef, q, "APPROVED"));
    await when(d, "11:20", () => work(rachidActor, workOrderId, "START_WORK"));
    await when(d, "12:35", () =>
      report(rachidActor, workOrderId, {
        findings: "Roulements du moteur de ventilateur usés, débit d'air insuffisant sur l'évaporateur.",
        workPerformed: "Remplacement du moteur de ventilateur, nettoyage de l'évaporateur, contrôle : +4 °C atteints en 40 minutes.",
        partsUsed: "1 moteur de ventilateur 10 W",
        recommendations: "Éviter de charger la vitrine au-dessus de la ligne de charge.",
      }),
    );
    await when(d, "18:10", () => withActor(youssef, (tx) => respondToReport(tx, youssef, workOrderId, { decision: "ACKNOWLEDGE", reason: null })));
    await when(addDaysToDateString(d, 1), "09:00", () => pay(nabil, bookingId, "CHEQUE", d, "CHQ-DEMO-4471"));
    await when(addDaysToDateString(d, 1), "12:00", () => review(db, salma, admin, bookingId, 4, "Diagnostic rapide et devis clair. Pièce remplacée le jour même."));
  }

  // H3 — ~2 weeks ago: repair quote rejected, report disputed, cash payment reported (awaiting confirmation).
  {
    const d = workdayOnOrBefore(day(-12));
    const req = await when(day(-14), "11:00", () =>
      newRequest(karim, e.ice, "DIAGNOSTIC", "Machine à glaçons : production très faible", "La machine produit moitié moins de glaçons depuis une semaine, dépôt blanc visible sur l'évaporateur.", [
        { date: d, start: "14:00", end: "17:00" },
      ]),
    );
    await when(day(-14), "11:05", () => invite(karim, req, [p1]));
    const o = await when(day(-14), "17:00", () =>
      offer(hicham, req, { kind: "DIAGNOSTIC", scope: "Diagnostic de la machine à glaçons (alimentation en eau, pompe, évaporateur, dureté de l'eau).", callout: 10000, fee: 20000, date: d, from: "14:00", to: "17:00", duration: 90 }),
    );
    const bookingId = await when(day(-13), "09:00", () => select(karim, o.versionId));
    const { workOrderId } = await when(day(-13), "09:40", () => confirm(hicham, bookingId, ahmed, d, "14:00", 90));
    await when(d, "13:35", () => work(ahmedActor, workOrderId, "START_TRAVEL"));
    await when(d, "14:06", () => work(ahmedActor, workOrderId, "ARRIVE"));
    const q = await when(d, "14:50", () =>
      quote(ahmedActor, workOrderId, "Détartrage complet et remplacement de la pompe de circulation.", [
        { kind: "PART", description: "Pompe de circulation", quantity: 1000, unitPrice: 78000 },
        { kind: "OTHER", description: "Produit détartrant alimentaire", quantity: 2000, unitPrice: 9000 },
        { kind: "LABOR", description: "Main-d'œuvre (heures)", quantity: 2000, unitPrice: 25000 },
      ]),
    );
    await when(d, "15:10", () => decide(karim, q, "REJECTED", "Nous préférons étudier le remplacement de la machine."));
    await when(d, "15:30", () =>
      report(ahmedActor, workOrderId, {
        findings: "Entartrage important de l'évaporateur et pompe de circulation bruyante. Eau d'alimentation très calcaire.",
        workPerformed: "Diagnostic réalisé, devis de réparation proposé (refusé par le client). Machine laissée en fonctionnement.",
        recommendations: "Installer un adoucisseur en amont de la machine.",
      }),
    );
    await when(addDaysToDateString(d, 1), "10:00", () =>
      withActor(karim, (tx) =>
        respondToReport(tx, karim, workOrderId, { decision: "DISPUTE", reason: "Le rapport n'indique pas la mesure de dureté de l'eau annoncée dans l'offre ; nous contestons le montant du diagnostic." }),
      ),
    );
    await when(addDaysToDateString(d, 1), "10:20", () => pay(karim, bookingId, "CASH", d, null));
    await when(addDaysToDateString(d, 1), "10:30", () => review(db, karim, null, bookingId, 2, "Diagnostic rapide mais compte rendu incomplet."));
  }

  // S6 — yesterday (last working day): on site, repair quote awaiting the customer's approval.
  {
    const d = workdayOnOrBefore(day(-1));
    const req = await when(addDaysToDateString(d, -2), "09:00", () =>
      newRequest(salma, e.negative, "DIAGNOSTIC", "Chambre froide négative à −12 °C", "La chambre froide du dépôt ne descend plus sous −12 °C (consigne −20 °C). Givre anormal sur l'évaporateur.", [
        { date: d, start: "09:00", end: "12:00" },
      ]),
    );
    await when(addDaysToDateString(d, -2), "09:10", () => invite(salma, req, [p1]));
    const o = await when(addDaysToDateString(d, -2), "16:00", () =>
      offer(hicham, req, { kind: "DIAGNOSTIC", scope: "Diagnostic du circuit frigorifique, recherche de fuite et contrôle du dégivrage.", callout: 15000, fee: 30000, date: d, from: "09:00", to: "12:00", duration: 90 }),
    );
    const bookingId = await when(addDaysToDateString(d, -1), "09:00", () => select(salma, o.versionId));
    const { workOrderId } = await when(addDaysToDateString(d, -1), "10:00", () => confirm(leila, bookingId, ahmed, d, "10:00", 90));
    await when(d, "09:30", () => work(ahmedActor, workOrderId, "START_TRAVEL"));
    await when(d, "10:02", () => work(ahmedActor, workOrderId, "ARRIVE"));
    await when(d, "11:05", () =>
      quote(ahmedActor, workOrderId, "Fuite sur un raccord de la ligne liquide et contacteur du compresseur usé : réparation du raccord, remplacement du contacteur, tirage au vide et recharge.", [
        { kind: "PART", description: "Contacteur de puissance compresseur", quantity: 1000, unitPrice: 68000 },
        { kind: "PART", description: "Fluide frigorigène (kg)", quantity: 2500, unitPrice: 38000 },
        { kind: "LABOR", description: "Main-d'œuvre (heures)", quantity: 3000, unitPrice: 25000 },
        { kind: "TRAVEL", description: "Second déplacement", quantity: 1000, unitPrice: 10000 },
      ], { timingNote: "Intervention possible sous 48 h après approbation.", exclusions: "Remplacement du compresseur non inclus." }),
    );
  }

  // S7 — three working days ago: repair approved, work started, waiting for parts.
  {
    const d = workdayOnOrBefore(day(-3));
    const req = await when(addDaysToDateString(d, -1), "08:30", () =>
      newRequest(karim, e.kitchenNeg, "DIAGNOSTIC", "Chambre froide cuisine : alarme température", "Alarme haute température plusieurs fois par jour, ventilateur d'évaporateur à l'arrêt par moments.", [
        { date: d, start: "13:00", end: "17:00" },
      ]),
    );
    await when(addDaysToDateString(d, -1), "08:35", () => invite(karim, req, [p2]));
    const o = await when(addDaysToDateString(d, -1), "12:00", () =>
      offer(nabil, req, { kind: "DIAGNOSTIC", scope: "Diagnostic ventilation et régulation de la chambre froide négative.", callout: 10000, fee: 25000, date: d, from: "13:00", to: "17:00", duration: 60 }),
    );
    const bookingId = await when(addDaysToDateString(d, -1), "14:00", () => select(karim, o.versionId));
    const { workOrderId } = await when(addDaysToDateString(d, -1), "15:00", () => confirm(nabil, bookingId, rachid, d, "14:00", 60));
    await when(d, "13:40", () => work(rachidActor, workOrderId, "START_TRAVEL"));
    await when(d, "14:05", () => work(rachidActor, workOrderId, "ARRIVE"));
    const q = await when(d, "14:45", () =>
      quote(rachidActor, workOrderId, "Moteur de ventilateur d'évaporateur défaillant : remplacement du moteur et de l'hélice.", [
        { kind: "PART", description: "Moteur de ventilateur basse température", quantity: 1000, unitPrice: 95000 },
        { kind: "PART", description: "Hélice 300 mm", quantity: 1000, unitPrice: 18000 },
        { kind: "LABOR", description: "Main-d'œuvre (heures)", quantity: 2000, unitPrice: 25000 },
      ], { timingNote: "Pièce à commander, délai fournisseur 5 à 7 jours." }),
    );
    await when(d, "15:05", () => decide(karim, q, "APPROVED"));
    await when(d, "15:15", () => work(rachidActor, workOrderId, "START_WORK"));
    await when(d, "15:45", () => work(rachidActor, workOrderId, "WAIT_FOR_PARTS", "Moteur commandé chez le fournisseur ; ventilateur provisoirement remis en marche."));
  }

  resetClock();

  // S1 — draft not yet sent.
  await newRequest(salma, e.freezer, "DIAGNOSTIC", "Congélateur : givre et couvercle qui ferme mal", "Formation de givre importante en 3 jours, le couvercle ne revient pas bien en position fermée.", [
    { date: workdayOnOrAfter(day(3)), start: "08:00", end: "12:00" },
  ], false);

  // S2 — open request with two competing offers (one revised).
  {
    const d = workdayOnOrAfter(day(4));
    setClock(new Date(Date.now() - 26 * 3600_000));
    const req = await newRequest(salma, e.condenser, "DIAGNOSTIC", "Groupe frigorifique en sécurité l'après-midi", "Le groupe en toiture se met en sécurité haute pression vers 15 h les jours de chaleur, puis redémarre.", [
      { date: d, start: "08:00", end: "12:00" },
      { date: addDaysToDateString(d, 1), start: "14:00", end: "17:00" },
    ]);
    await invite(salma, req, [p1, p2]);
    setClock(new Date(Date.now() + 5 * 3600_000));
    await offer(hicham, req, { kind: "DIAGNOSTIC", scope: "Diagnostic du groupe : pressions, propreté du condenseur, ventilateurs, pressostat HP.", callout: 15000, fee: 35000, date: d, from: "08:00", to: "12:00", duration: 90 });
    setClock(new Date(Date.now() + 2 * 3600_000));
    await offer(nabil, req, { kind: "DIAGNOSTIC", scope: "Diagnostic du groupe frigorifique en toiture et compte rendu.", callout: 20000, fee: 30000, date: d, from: "08:00", to: "12:00", duration: 90 });
    resetClock();
    // Bouregreg revises its offer (new version, the previous one stays in the history).
    const inv = await withActor(nabil, (tx) => tx.requestInvitation.findFirstOrThrow({ where: { requestId: req, providerOrgId: p2 } }));
    const draft = await withActor(nabil, (tx) =>
      saveOfferDraft(tx, nabil, inv.id, {
        kind: "DIAGNOSTIC",
        scope: "Diagnostic du groupe frigorifique en toiture et compte rendu. Déplacement réduit (déjà sur Agdal ce jour-là).",
        calloutFee: 10000,
        serviceFee: 30000,
        taxRate: 2000,
        taxNote: null,
        windowDate: d,
        windowStart: "08:00",
        windowEnd: "12:00",
        estimatedDurationMin: 90,
        exclusions: "Pièces et fluide frigorigène non inclus.",
        cancellationTerms: "Annulation sans frais jusqu'à 24 h avant le rendez-vous ; au-delà, frais de déplacement dus.",
        warrantyTerms: null,
        validDays: 7,
      }),
    );
    await withActor(nabil, (tx) => issueOffer(tx, nabil, draft.offerId));
  }

  // S3 — breakdown waiting for human-assisted routing (no provider invited yet).
  await newRequest(karim, e.pastry, "BREAKDOWN", "Armoire pâtisserie à +12 °C", "Depuis ce matin l'armoire ne refroidit plus, le compresseur ne démarre pas. Produits déplacés en chambre froide.", [
    { date: workdayOnOrAfter(day(1)), start: "08:00", end: "18:00" },
  ]);

  // S4 — offer selected, waiting for the provider's confirmation.
  {
    const d = workdayOnOrAfter(day(5));
    const req = await newRequest(karim, e.drinks, "MAINTENANCE", "Entretien vitrine boissons", "Entretien avant l'été : nettoyage du condenseur et contrôle de la température.", [{ date: d, start: "09:00", end: "12:00" }]);
    await invite(karim, req, [p1]);
    const o = await offer(hicham, req, { kind: "MAINTENANCE", scope: "Nettoyage du condenseur et de l'évaporateur, contrôle du thermostat et des joints.", callout: null, fee: 45000, date: d, from: "09:00", to: "12:00", duration: 60 });
    await select(karim, o.versionId);
  }

  // S5 — confirmed maintenance visit in a few days.
  {
    const d = workdayOnOrAfter(day(2));
    const req = await newRequest(salma, e.saladette, "MAINTENANCE", "Entretien saladette", "Entretien préventif : la saladette givre sur la partie haute.", [{ date: d, start: "10:00", end: "13:00" }]);
    await invite(salma, req, [p2]);
    const o = await offer(nabil, req, { kind: "MAINTENANCE", scope: "Dégivrage, nettoyage, contrôle du thermostat et des joints.", callout: null, fee: 35000, date: d, from: "10:00", to: "13:00", duration: 60 });
    const bookingId = await select(salma, o.versionId);
    await confirm(nabil, bookingId, rachid, d, "10:30", 60);
  }

  // S8 — confirmed diagnosis for the technician's next working slot (today if possible).
  {
    const now = realNow();
    const hour = Number(localTimeString(now).slice(0, 2));
    const todayOk = weekday(D) !== 7 && hour < 15;
    const d = todayOk ? D : workdayOnOrAfter(day(1));
    const start = todayOk ? `${String(Math.max(8, hour + 2)).padStart(2, "0")}:00` : "09:00";
    const req = await newRequest(salma, e.coldRoom, "DIAGNOSTIC", "Joint de porte de chambre froide abîmé", "Le joint de la porte est déchiré sur 20 cm, condensation à l'intérieur.", [{ date: d, start, end: "18:00" }]);
    await invite(salma, req, [p1]);
    const o = await offer(hicham, req, { kind: "DIAGNOSTIC", scope: "Contrôle de la porte et des joints, devis de remplacement si nécessaire.", callout: 10000, fee: 15000, date: d, from: start, to: "18:00", duration: 60 });
    const bookingId = await select(salma, o.versionId);
    await confirm(leila, bookingId, ahmed, d, start, 60);
  }

  // Maintenance plan proposed after the H1 visit and accepted by the customer; its first visit is
  // due soon, so the scheduler prepares a draft request for the customer to review.
  const plan = await withActor(hicham, (tx) =>
    proposePlan(tx, hicham, {
      equipmentId: e.coldRoom,
      title: "Entretien trimestriel chambre froide",
      scope: "Nettoyage évaporateur et condenseur, contrôle des pressions, du dégivrage et des sondes.",
      intervalMonths: 3,
      reminderLeadDays: 14,
      firstDueDate: day(10),
    }),
  );
  await withActor(salma, (tx) => decidePlan(tx, salma, plan.id, { action: "CONSENT", note: null }));

  // One visitor message for the support inbox.
  await db.supportMessage.create({
    data: {
      name: "Visiteur (démo)",
      email: `visiteur@${DOMAIN}`,
      organizationName: "Boulangerie fictive",
      topic: "CUSTOMER",
      message: "Bonjour, couvrez-vous Skhirat pour l'entretien de deux vitrines ? (message de démonstration)",
    },
  });
}

main().catch((error) => {
  resetClock();
  console.error("[seed] échec :", error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : error);
  process.exit(1);
});
