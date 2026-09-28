import type { Metadata } from "next";
import Link from "next/link";
import { t, te } from "@/lib/i18n";
import { formatDate, formatDateTime } from "@/lib/time";
import { can } from "@/server/auth/roles";
import { guard } from "@/server/auth/page-guard";
import { withActor } from "@/server/db/context";
import { getOwnProfile } from "@/server/modules/providers";
import { listEquipmentCategories, listServiceAreas } from "@/server/modules/reference";
import { StatusBadge } from "@/components/domain/status-badge";
import { ProviderProfileForm, SubmitProfileButton } from "@/features/provider-profile-form";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/layout";

export const metadata: Metadata = { title: t("providerProfile.title") };

export default async function ProviderProfilePage() {
  const actor = await guard({ orgTypes: ["PROVIDER"], roles: ["provider_owner", "provider_dispatcher"] });
  const { profile, areas, categories } = await withActor(actor, async (tx) => ({
    profile: await getOwnProfile(tx, actor),
    areas: await listServiceAreas(tx),
    categories: await listEquipmentCategories(tx),
  }));
  const manager = can.providerManage(actor);
  return (
    <>
      <PageHeader
        title={t("providerProfile.title")}
        description={t("providerProfile.intro")}
        meta={<StatusBadge domain="provider" status={profile.status} />}
        actions={
          profile.status === "APPROVED" ? (
            <Link href={`/prestataires/${profile.slug}`} className="text-sm font-semibold text-brand hover:underline">
              {t("providerProfile.viewPublic")}
            </Link>
          ) : null
        }
      />
      <Alert tone={profile.status === "APPROVED" ? "success" : profile.status === "REJECTED" || profile.status === "SUSPENDED" ? "danger" : "info"} title={t(`providerDashboard.profile.${profile.status}`)} className="mb-6">
        {t(`providerProfile.statusHelp.${profile.status}`)}
        {profile.statusReason ? ` ${t("booking.reason")} : ${profile.statusReason}` : ""}
        {profile.submittedAt ? ` · ${t("providerProfile.submittedAt", { date: formatDateTime(profile.submittedAt) })}` : ""}
      </Alert>
      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <Card>
          <CardHeader title={t("providerProfile.edit")} />
          <CardBody>
            <ProviderProfileForm
              readOnly={!manager}
              areas={areas.map((a) => ({ id: a.id, name: a.name, cities: a.cities }))}
              categories={categories.map((c) => ({ id: c.id, labelFr: c.labelFr }))}
              profile={{
                displayName: profile.displayName,
                summary: profile.summary,
                description: profile.description,
                city: profile.city,
                serviceHours: profile.serviceHours as Record<string, [number, number]>,
                serviceAreaIds: profile.serviceAreas.map((a) => a.serviceAreaId),
                categoryIds: profile.categories.map((c) => c.equipmentCategoryId),
                version: profile.version,
              }}
            />
          </CardBody>
        </Card>
        <div className="space-y-6">
          {manager && ["DRAFT", "REJECTED"].includes(profile.status) ? (
            <Card>
              <CardHeader title={t("providerProfile.submitTitle")} description={t("providerProfile.submitIntro")} />
              <CardBody>
                <SubmitProfileButton />
              </CardBody>
            </Card>
          ) : null}
          <Card>
            <CardHeader title={t("provider.checksTitle")} description={t("providerProfile.checksIntro")} />
            <CardBody>
              {profile.checks.length === 0 ? (
                <p className="text-sm text-muted">{t("provider.noChecks")}</p>
              ) : (
                <ul className="space-y-3">
                  {profile.checks.map((c) => (
                    <li key={c.type} className="text-sm">
                      <p className="flex flex-wrap items-center gap-2 font-medium">
                        {te("enums.checkType", c.type)} <StatusBadge domain="check" status={c.status} />
                      </p>
                      <p className="text-xs text-muted">{te("enums.checkMeaning", c.type)}</p>
                      {c.publicNote ? <p className="text-xs">{c.publicNote}</p> : null}
                      {c.checkedAt ? <p className="text-xs text-muted">{t("provider.checkedOn", { date: formatDate(c.checkedAt) })}</p> : null}
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
