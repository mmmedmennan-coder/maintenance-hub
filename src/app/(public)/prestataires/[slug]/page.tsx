import { BadgeCheck, MapPin } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { t, te } from "@/lib/i18n";
import { formatDate } from "@/lib/time";
import { getActor } from "@/server/auth/session";
import { withPublic } from "@/server/db/context";
import { DomainError } from "@/server/errors";
import { getPublicProvider } from "@/server/modules/providers";
import { RatingLine, ServiceHours } from "@/components/domain/provider-card";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert, Badge } from "@/components/ui/feedback";
import { Pagination } from "@/components/ui/layout";

async function load(slug: string, page: number) {
  try {
    return await withPublic((tx) => getPublicProvider(tx, slug, page));
  } catch (error) {
    if (error instanceof DomainError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const provider = await withPublic((tx) => getPublicProvider(tx, slug)).catch(() => null);
  return { title: provider?.displayName ?? t("public.directory.title") };
}

export default async function ProviderProfilePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ avis?: string }> }) {
  const { slug } = await params;
  const page = Math.max(1, Number((await searchParams).avis) || 1);
  const [p, actor] = await Promise.all([load(slug, page), getActor()]);
  const requestHref = actor?.orgType === "CUSTOMER" ? `/client/demandes/nouvelle?prestataire=${p.providerOrgId}` : `/connexion?next=${encodeURIComponent(`/client/demandes/nouvelle?prestataire=${p.providerOrgId}`)}`;
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-bold tracking-tight text-ink">{p.displayName}</h1>
            {p.isDemo ? <Badge tone="warn">{t("app.demoNotice")}</Badge> : null}
          </div>
          <p className="mt-2 flex items-center gap-1 text-muted">
            <MapPin aria-hidden className="size-4" /> {p.city}
          </p>
          <div className="mt-2">
            <RatingLine avg={p.ratingAvg} count={p.reviewCount} />
          </div>
        </div>
        {actor && actor.orgType !== "CUSTOMER" ? null : (
          <ButtonLink href={requestHref} size="lg">
            {t("provider.requestService")}
          </ButtonLink>
        )}
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader title={t("provider.about")} />
            <CardBody>
              <p className="font-medium text-ink">{p.summary}</p>
              <p className="prose-plain mt-3 text-sm text-ink-soft">{p.description}</p>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title={t("provider.checksTitle")} description={t("provider.checksIntro")} />
            <CardBody>
              {p.checks.length === 0 ? (
                <p className="text-sm text-muted">{t("provider.noChecks")}</p>
              ) : (
                <ul className="space-y-4">
                  {p.checks.map((c) => (
                    <li key={c.type} className="flex gap-3">
                      <BadgeCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-success" />
                      <div>
                        <p className="font-semibold text-ink">
                          {te("enums.checkType", c.type)}
                          {c.isDemo ? <span className="ml-2 text-xs font-normal text-warn">({t("provider.demoCheck")})</span> : null}
                        </p>
                        <p className="text-sm text-muted">{te("enums.checkMeaning", c.type)}</p>
                        {c.publicNote ? <p className="mt-1 text-sm text-ink-soft">{c.publicNote}</p> : null}
                        <p className="mt-1 text-xs text-muted">
                          {t("provider.checkedOn", { date: formatDate(c.checkedAt) })}
                          {c.expiresAt ? ` · ${t("provider.checkExpires", { date: formatDate(c.expiresAt) })}` : ""}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title={t("provider.reviewsTitle")} description={t("provider.reviewsIntro")} />
            <CardBody>
              {p.reviews.length === 0 ? (
                <p className="text-sm text-muted">{t("provider.noReviews")}</p>
              ) : (
                <ul className="divide-y divide-line">
                  {p.reviews.map((r) => (
                    <li key={r.id} className="py-4 first:pt-0">
                      <p className="flex items-center gap-2 text-sm font-semibold text-ink">
                        {t("provider.reviewRating", { rating: r.rating })}
                        <span className="font-normal text-muted">· {formatDate(r.createdAt)}</span>
                        {r.isDemo ? <Badge tone="warn">{t("app.demoBadge")}</Badge> : null}
                      </p>
                      {r.comment ? <p className="prose-plain mt-1 text-sm text-ink-soft">{r.comment}</p> : null}
                      {r.response ? (
                        <div className="mt-2 rounded-lg bg-subtle p-3 text-sm">
                          <p className="font-semibold text-ink-soft">{t("provider.providerReply")}</p>
                          <p className="prose-plain text-ink-soft">{r.response.body}</p>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
              <Pagination page={p.reviewPage} pageSize={p.reviewPageSize} total={p.reviewCount} hrefFor={(n) => `/prestataires/${p.slug}?avis=${n}`} />
            </CardBody>
          </Card>
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader title={t("provider.serviceHours")} description={t("provider.serviceHoursNote")} />
            <CardBody>
              <ServiceHours hours={p.serviceHours as Record<string, [number, number]>} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title={t("provider.areas")} />
            <CardBody className="space-y-3">
              {p.serviceAreas.map((a) => (
                <div key={a.serviceArea.name}>
                  <p className="font-semibold text-ink">{a.serviceArea.name}</p>
                  <p className="text-sm text-muted">{a.serviceArea.cities.join(", ")}</p>
                </div>
              ))}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title={t("provider.categories")} />
            <CardBody>
              <ul className="flex flex-wrap gap-1.5">
                {p.categories.map((c) => (
                  <li key={c.equipmentCategory.id}>
                    <Badge>{c.equipmentCategory.labelFr}</Badge>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
          <Alert tone="info">{t("provider.contactNote")}</Alert>
        </div>
      </div>
    </div>
  );
}
