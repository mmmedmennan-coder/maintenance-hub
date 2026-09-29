import "server-only";
import type { z } from "zod";

import type { providerProfileSchema } from "@/lib/schemas";
import { type Actor, can } from "@/server/auth/roles";
import type { Tx } from "@/server/db/context";
import { DomainError, forbidden, notFound, validation } from "@/server/errors";
import { audit, emitEvent } from "@/server/lib/infra";

export const DIRECTORY_PAGE_SIZE = 9;

export type ProviderSearch = {
  categoryId?: string;
  serviceAreaId?: string;
  city?: string;
  weekday?: number;
  /** Local date (YYYY-MM-DD): provider declares an active technician available that day. */
  date?: string;
  q?: string;
  page?: number;
};

type SearchRow = {
  id: string;
  provider_org_id: string;
  slug: string;
  display_name: string;
  summary: string;
  city: string;
  service_hours: Record<string, [number, number]>;
  is_demo: boolean;
  review_count: bigint;
  rating_avg: number | null;
  total: bigint;
};

/**
 * Public directory search. Runs under row-level security in the caller's context, so only
 * APPROVED profiles are returned and counts cannot reveal unapproved providers.
 * Only public projections are selected (no contact details, no internal notes).
 * The `date` filter asks the trusted function `app.provider_declares_availability`, which returns
 * only a boolean (technician windows and time off stay private). It is declared, provisional
 * availability: capacity is only reserved when the provider confirms a booking.
 */
export async function searchProviders(tx: Tx, search: ProviderSearch) {
  const page = Math.max(1, search.page ?? 1);
  const offset = (page - 1) * DIRECTORY_PAGE_SIZE;
  const city = search.city?.trim() ? search.city.trim() : null;
  const q = search.q?.trim() ? `%${search.q.trim().replace(/[%_\\]/g, "")}%` : null;
  const rows = await tx.$queryRaw<SearchRow[]>`
    SELECT p.id, p.provider_org_id, p.slug, p.display_name, p.summary, p.city, p.service_hours, p.is_demo,
      (SELECT count(*) FROM review r WHERE r.provider_org_id = p.provider_org_id AND r.status = 'PUBLISHED') AS review_count,
      (SELECT avg(r.rating)::float FROM review r WHERE r.provider_org_id = p.provider_org_id AND r.status = 'PUBLISHED') AS rating_avg,
      count(*) OVER () AS total
    FROM provider_profile p
    WHERE p.status = 'APPROVED'
      AND (${search.categoryId ?? null}::text IS NULL OR EXISTS (
            SELECT 1 FROM provider_category pc WHERE pc.provider_profile_id = p.id AND pc.equipment_category_id = ${search.categoryId ?? null}::text))
      AND (${search.serviceAreaId ?? null}::text IS NULL OR EXISTS (
            SELECT 1 FROM provider_service_area psa WHERE psa.provider_profile_id = p.id AND psa.service_area_id = ${search.serviceAreaId ?? null}::text))
      AND (${city}::text IS NULL OR EXISTS (
            SELECT 1 FROM provider_service_area psa JOIN service_area sa ON sa.id = psa.service_area_id
            WHERE psa.provider_profile_id = p.id AND sa.active
              AND EXISTS (SELECT 1 FROM unnest(sa.cities) c WHERE lower(c) = lower(${city}::text))))
      AND (${search.weekday ?? null}::int IS NULL OR jsonb_exists(p.service_hours, ${search.weekday ? String(search.weekday) : null}::text))
      AND (${search.date ?? null}::date IS NULL
           OR app.provider_declares_availability(p.provider_org_id, ${search.date ?? null}::date, ${search.categoryId ?? null}::text))
      AND (${q}::text IS NULL OR p.display_name ILIKE ${q}::text OR p.summary ILIKE ${q}::text)
    ORDER BY p.display_name ASC
    LIMIT ${DIRECTORY_PAGE_SIZE} OFFSET ${offset}`;
  const total = rows.length ? Number(rows[0]!.total) : 0;
  const ids = rows.map((r) => r.id);
  const [areas, categories, checks] = ids.length
    ? await Promise.all([
        tx.providerServiceArea.findMany({ where: { providerProfileId: { in: ids } }, include: { serviceArea: { select: { name: true } } } }),
        tx.providerCategory.findMany({ where: { providerProfileId: { in: ids } }, include: { equipmentCategory: { select: { labelFr: true } } } }),
        tx.providerCheck.findMany({
          where: { providerProfileId: { in: ids }, status: "VERIFIED" },
          select: { providerProfileId: true, type: true, isDemo: true },
        }),
      ])
    : [[], [], []];
  return {
    total,
    page,
    pageSize: DIRECTORY_PAGE_SIZE,
    items: rows.map((r) => ({
      id: r.id,
      providerOrgId: r.provider_org_id,
      slug: r.slug,
      displayName: r.display_name,
      summary: r.summary,
      city: r.city,
      serviceHours: r.service_hours,
      isDemo: r.is_demo,
      reviewCount: Number(r.review_count),
      ratingAvg: r.rating_avg,
      areas: areas.filter((a) => a.providerProfileId === r.id).map((a) => a.serviceArea.name),
      categories: categories.filter((c) => c.providerProfileId === r.id).map((c) => c.equipmentCategory.labelFr),
      verifiedChecks: checks.filter((c) => c.providerProfileId === r.id).map((c) => ({ type: c.type, isDemo: c.isDemo })),
    })),
  };
}

export async function getPublicProvider(tx: Tx, slug: string, reviewPage = 1) {
  const profile = await tx.providerProfile.findFirst({
    where: { slug, status: "APPROVED" },
    select: {
      id: true,
      providerOrgId: true,
      slug: true,
      displayName: true,
      summary: true,
      description: true,
      city: true,
      serviceHours: true,
      isDemo: true,
      serviceAreas: { select: { serviceArea: { select: { name: true, cities: true } } } },
      categories: { select: { equipmentCategory: { select: { id: true, labelFr: true } } } },
      checks: {
        where: { status: "VERIFIED" },
        select: { type: true, publicNote: true, checkedAt: true, expiresAt: true, isDemo: true },
      },
    },
  });
  if (!profile) throw notFound("Prestataire");
  const pageSize = 5;
  const [reviews, reviewCount, aggregate] = await Promise.all([
    tx.review.findMany({
      where: { providerOrgId: profile.providerOrgId, status: "PUBLISHED" },
      orderBy: { createdAt: "desc" },
      skip: (reviewPage - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        rating: true,
        comment: true,
        createdAt: true,
        isDemo: true,
        response: { where: { hidden: false }, select: { body: true, createdAt: true } },
      },
    }),
    tx.review.count({ where: { providerOrgId: profile.providerOrgId, status: "PUBLISHED" } }),
    tx.review.aggregate({ where: { providerOrgId: profile.providerOrgId, status: "PUBLISHED" }, _avg: { rating: true } }),
  ]);
  return {
    ...profile,
    reviews,
    reviewCount,
    reviewPage,
    reviewPageSize: pageSize,
    ratingAvg: aggregate._avg.rating,
  };
}

/** Approved providers eligible for a request: category + service area. */
export async function eligibleProvidersForRequest(tx: Tx, equipmentCategoryId: string, serviceAreaId: string | null) {
  return tx.providerProfile.findMany({
    where: {
      status: "APPROVED",
      categories: { some: { equipmentCategoryId } },
      ...(serviceAreaId ? { serviceAreas: { some: { serviceAreaId } } } : {}),
    },
    orderBy: { displayName: "asc" },
    take: 50,
    select: {
      providerOrgId: true,
      slug: true,
      displayName: true,
      summary: true,
      city: true,
      isDemo: true,
      serviceHours: true,
      checks: { where: { status: "VERIFIED" }, select: { type: true } },
    },
  });
}

// --- Provider self-management -----------------------------------------------------------

export async function getOwnProfile(tx: Tx, actor: Actor) {
  if (!can.providerAny(actor)) throw forbidden();
  const profile = await tx.providerProfile.findFirst({
    where: { providerOrgId: actor.orgId },
    include: {
      serviceAreas: { select: { serviceAreaId: true } },
      categories: { select: { equipmentCategoryId: true } },
      checks: { select: { type: true, status: true, publicNote: true, checkedAt: true, expiresAt: true } },
    },
  });
  if (!profile) throw notFound("Profil prestataire");
  return profile;
}

export async function updateOwnProfile(tx: Tx, actor: Actor, input: z.output<typeof providerProfileSchema>) {
  if (!can.providerManage(actor)) throw forbidden();
  const profile = await tx.providerProfile.findFirst({ where: { providerOrgId: actor.orgId } });
  if (!profile) throw notFound("Profil prestataire");
  if (profile.version !== input.version) {
    throw new DomainError("VERSION_CONFLICT", "Le profil a été modifié entre-temps. Rechargez la page.");
  }
  const [areas, categories] = await Promise.all([
    tx.serviceArea.findMany({ where: { id: { in: input.serviceAreaIds }, active: true }, select: { id: true } }),
    tx.equipmentCategory.findMany({ where: { id: { in: input.categoryIds }, active: true }, select: { id: true } }),
  ]);
  if (areas.length !== new Set(input.serviceAreaIds).size) throw validation("Zone invalide.", { serviceAreaIds: ["Zone inconnue ou inactive."] });
  if (categories.length !== new Set(input.categoryIds).size) throw validation("Catégorie invalide.", { categoryIds: ["Catégorie inconnue."] });

  const updated = await tx.providerProfile.updateMany({
    where: { id: profile.id, version: input.version },
    data: {
      displayName: input.displayName,
      summary: input.summary,
      description: input.description,
      city: input.city,
      serviceHours: input.serviceHours,
      version: { increment: 1 },
    },
  });
  if (updated.count === 0) throw new DomainError("VERSION_CONFLICT", "Le profil a été modifié entre-temps. Rechargez la page.");
  await tx.providerServiceArea.deleteMany({ where: { providerProfileId: profile.id } });
  await tx.providerServiceArea.createMany({
    data: areas.map((a) => ({ providerProfileId: profile.id, serviceAreaId: a.id, providerOrgId: actor.orgId })),
  });
  await tx.providerCategory.deleteMany({ where: { providerProfileId: profile.id } });
  await tx.providerCategory.createMany({
    data: categories.map((c) => ({ providerProfileId: profile.id, equipmentCategoryId: c.id, providerOrgId: actor.orgId })),
  });
  await audit(tx, actor, { action: "provider_profile.updated", targetType: "provider_profile", targetId: profile.id });
  return { id: profile.id };
}

export async function submitProfileForReview(tx: Tx, actor: Actor) {
  if (!can.providerManage(actor)) throw forbidden();
  const profile = await getOwnProfile(tx, actor);
  if (!["DRAFT", "REJECTED"].includes(profile.status)) {
    throw new DomainError("INVALID_TRANSITION", "Le profil a déjà été soumis ou approuvé.");
  }
  const missing: string[] = [];
  if (profile.summary.length < 10) missing.push("résumé");
  if (profile.description.length < 30) missing.push("description");
  if (profile.serviceAreas.length === 0) missing.push("zones d'intervention");
  if (profile.categories.length === 0) missing.push("catégories d'équipement");
  const technicians = await tx.technicianProfile.count({ where: { providerOrgId: actor.orgId, active: true, windows: { some: {} } } });
  if (technicians === 0) missing.push("au moins un technicien avec des disponibilités");
  if (missing.length) {
    throw new DomainError("VALIDATION_ERROR", `Profil incomplet : ${missing.join(", ")}.`);
  }
  await tx.providerProfile.update({ where: { id: profile.id }, data: { status: "SUBMITTED", submittedAt: new Date() } });
  await audit(tx, actor, { action: "provider_profile.submitted", targetType: "provider_profile", targetId: profile.id });
  await emitEvent(tx, actor, { type: "provider.reviewed", aggregateType: "provider_profile", aggregateId: profile.id, payload: { status: "SUBMITTED" } });
}

export type Entitlement = { active: boolean; paidUntil: string | null; planName: string | null; maxStaff: number | null };

/** Provider software subscription status (manually recorded periods in the pilot). */
export async function getEntitlement(tx: Tx, providerOrgId: string): Promise<Entitlement> {
  const sub = await tx.providerSubscription.findUnique({ where: { providerOrgId }, include: { plan: true } });
  if (!sub) return { active: false, paidUntil: null, planName: null, maxStaff: null };
  const paidUntil = sub.paidUntil ? sub.paidUntil.toISOString().slice(0, 10) : null;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Casablanca" }).format(new Date());
  return { active: !!paidUntil && paidUntil >= today, paidUntil, planName: sub.plan.name, maxStaff: sub.plan.maxStaff };
}

/**
 * Entitlement rule: an expired or missing subscription blocks NEW commercial actions
 * (issuing offers, proposing maintenance plans). History stays readable and ongoing
 * jobs (confirmation of an already-selected offer, work, reports, payments) continue.
 */
export async function assertEntitled(tx: Tx, actor: Actor) {
  const entitlement = await getEntitlement(tx, actor.orgId);
  if (!entitlement.active) {
    throw new DomainError(
      "ENTITLEMENT_REQUIRED",
      "Votre abonnement logiciel n'est pas actif : l'émission de nouvelles offres est suspendue. Vos dossiers et interventions en cours restent accessibles.",
    );
  }
}

