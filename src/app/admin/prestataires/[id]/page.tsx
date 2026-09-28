import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { t, te } from "@/lib/i18n";
import { formatCalendarDate, formatDate, formatDateTime, minutesToLabel } from "@/lib/time";
import { guard } from "@/server/auth/page-guard";
import { withActor } from "@/server/db/context";
import { DomainError } from "@/server/errors";
import { getProviderForReview } from "@/server/modules/admin";
import { ServiceHours } from "@/components/domain/provider-card";
import { StatusBadge } from "@/components/domain/status-badge";
import { ProviderCheckForm, ProviderReviewActions } from "@/features/admin-actions";
import { Card, CardBody, CardHeader, DescriptionList } from "@/components/ui/card";
import { Alert, Badge } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/layout";

export const metadata: Metadata = { title: t("admin.providers.detailTitle") };

export default async function AdminProviderPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await guard({ orgTypes: ["PLATFORM"], roles: ["platform_admin"] });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const { profile, technicians, subscription } = await withActor(actor, (tx) => getProviderForReview(tx, actor, id)).catch((e) => {
    if (e instanceof DomainError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  return (
    <>
      <PageHeader
        title={profile.displayName}
        back={{ href: "/admin/prestataires", label: t("admin.providers.title") }}
        meta={
          <>
            <StatusBadge domain="provider" status={profile.status} />
            {profile.isDemo ? <Badge tone="warn">{t("app.demoBadge")}</Badge> : null}
          </>
        }
      />
      {profile.statusReason ? <Alert tone="info" className="mb-6">{t("booking.reason")} : {profile.statusReason}</Alert> : null}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader title={t("admin.providers.decisionTitle")} description={t("admin.providers.decisionIntro")} />
            <CardBody>
              <ProviderReviewActions profileId={profile.id} status={profile.status} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title={t("admin.providers.profile")} />
            <CardBody className="space-y-4">
              <DescriptionList
                items={[
                  { label: t("admin.providers.organization"), value: profile.organization.name },
                  { label: t("providerProfile.city"), value: profile.city },
                  { label: t("providerProfile.summary"), value: profile.summary, wide: true },
                  { label: t("providerProfile.description"), value: profile.description, wide: true },
                  { label: t("providerProfile.areas"), value: profile.serviceAreas.map((a) => a.serviceArea.name).join(", ") },
                  { label: t("providerProfile.categories"), value: profile.categories.map((c) => c.equipmentCategory.labelFr).join(", ") },
                  { label: t("admin.providers.submitted"), value: profile.submittedAt ? formatDateTime(profile.submittedAt) : null },
                  { label: t("admin.providers.reviewed"), value: profile.reviewedAt ? formatDateTime(profile.reviewedAt) : null },
                ]}
              />
              <ServiceHours hours={profile.serviceHours as Record<string, [number, number]>} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title={t("admin.providers.technicians")} />
            <CardBody>
              {technicians.length === 0 ? (
                <p className="text-sm text-warn">{t("admin.providers.noTechnicians")}</p>
              ) : (
                <ul className="divide-y divide-line text-sm">
                  {technicians.map((tech) => (
                    <li key={tech.id} className="py-2">
                      <span className="font-medium">{tech.displayName}</span> {tech.active ? null : <Badge>{t("technicians.inactiveBadge")}</Badge>}
                      <span className="block text-xs text-muted">
                        {tech.windows.map((w) => `${te("enums.weekdayShort", String(w.weekday))} ${minutesToLabel(w.startMinute)}–${minutesToLabel(w.endMinute)}`).join(" · ") || t("technicians.noWindows")}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader title={t("provider.checksTitle")} description={t("admin.checks.intro")} />
            <CardBody className="space-y-4">
              {profile.checks.length === 0 ? <p className="text-sm text-muted">{t("provider.noChecks")}</p> : null}
              <ul className="space-y-3">
                {profile.checks.map((c) => (
                  <li key={c.id} className="rounded-lg border border-line p-3 text-sm">
                    <p className="flex flex-wrap items-center gap-2 font-medium">
                      {te("enums.checkType", c.type)} <StatusBadge domain="check" status={c.status} />
                    </p>
                    {c.publicNote ? <p className="text-xs">{t("admin.checks.publicNote")} : {c.publicNote}</p> : null}
                    {c.internalNote ? <p className="text-xs text-muted">{t("admin.checks.internalNote")} : {c.internalNote}</p> : null}
                    <p className="text-xs text-muted">
                      {c.checkedAt ? formatDate(c.checkedAt) : "—"}
                      {c.expiresAt ? ` · ${t("provider.checkExpires", { date: formatCalendarDate(c.expiresAt) })}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
              <details>
                <summary className="cursor-pointer text-sm font-semibold text-brand">{t("admin.checks.record")}</summary>
                <div className="mt-3">
                  <ProviderCheckForm profileId={profile.id} />
                </div>
              </details>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title={t("subscription.title")} />
            <CardBody className="text-sm">
              {subscription ? (
                <p>
                  {subscription.plan.name} · {subscription.paidUntil ? t("subscription.paidUntil", { date: formatCalendarDate(subscription.paidUntil) }) : t("subscription.never")}
                </p>
              ) : (
                <p className="text-muted">{t("subscription.never")}</p>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
