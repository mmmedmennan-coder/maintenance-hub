import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { t } from "@/lib/i18n";
import { can } from "@/server/auth/roles";
import { guard } from "@/server/auth/page-guard";
import { withActor } from "@/server/db/context";
import { DomainError } from "@/server/errors";
import { getSite } from "@/server/modules/assets";
import { listServiceAreas } from "@/server/modules/reference";
import { ArchiveToggle } from "@/features/archive-toggle";
import { SiteForm } from "@/features/asset-forms";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader, DescriptionList } from "@/components/ui/card";
import { Badge } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/layout";

export const metadata: Metadata = { title: t("customer.sites.detail") };

export default async function SitePage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await guard({ orgTypes: ["CUSTOMER"] });
  const { id } = await params;
  const data = await withActor(actor, async (tx) => ({ site: await getSite(tx, actor, id), areas: await listServiceAreas(tx) })).catch((e) => {
    if (e instanceof DomainError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const { site } = data;
  const writer = can.customerWrite(actor);
  return (
    <>
      <PageHeader
        title={site.name}
        description={`${site.addressLine}, ${site.city}`}
        back={{ href: "/client/sites", label: t("customer.sites.title") }}
        meta={site.archivedAt ? <Badge>{t("customer.assets.archived")}</Badge> : site.serviceArea ? <Badge tone="brand">{site.serviceArea.name}</Badge> : <Badge tone="warn">{t("customer.sites.outsideArea")}</Badge>}
        actions={writer ? <ArchiveToggle kind="sites" id={site.id} archived={!!site.archivedAt} /> : null}
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("customer.sites.equipmentTitle")} actions={writer && !site.archivedAt ? <ButtonLink size="sm" href={`/client/equipements/nouveau?site=${site.id}`}>{t("customer.equipment.new")}</ButtonLink> : null} />
          <CardBody>
            {site.equipment.length === 0 ? (
              <p className="text-sm text-muted">{t("customer.equipment.emptyBody")}</p>
            ) : (
              <ul className="divide-y divide-line">
                {site.equipment.map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-2 py-2.5">
                    <Link href={`/client/equipements/${e.id}`} className="font-medium hover:text-brand">
                      {e.label}
                      <span className="block text-xs font-normal text-muted">{e.category.labelFr}</span>
                    </Link>
                    {e.archivedAt ? <Badge>{t("customer.assets.archived")}</Badge> : null}
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={writer && !site.archivedAt ? t("customer.sites.edit") : t("customer.sites.detail")} />
          <CardBody>
            {writer && !site.archivedAt ? (
              <SiteForm
                cities={data.areas.flatMap((a) => a.cities)}
                site={{ id: site.id, version: site.version, name: site.name, addressLine: site.addressLine, city: site.city, accessNotes: site.accessNotes, contactName: site.contactName, contactPhone: site.contactPhone }}
              />
            ) : (
              <DescriptionList
                columns={1}
                items={[
                  { label: t("customer.sites.address"), value: `${site.addressLine}, ${site.city}` },
                  { label: t("customer.sites.accessNotes"), value: site.accessNotes },
                  { label: t("customer.sites.contactName"), value: site.contactName },
                  { label: t("customer.sites.contactPhone"), value: site.contactPhone },
                ]}
              />
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
