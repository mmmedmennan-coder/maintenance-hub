import { Building, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { t } from "@/lib/i18n";
import { can } from "@/server/auth/roles";
import { guard } from "@/server/auth/page-guard";
import { withActor } from "@/server/db/context";
import { listSites } from "@/server/modules/assets";
import { ButtonLink } from "@/components/ui/button";
import { Badge, EmptyState } from "@/components/ui/feedback";
import { PageHeader, Table, Td, Th } from "@/components/ui/layout";

export const metadata: Metadata = { title: t("customer.sites.title") };

export default async function SitesPage({ searchParams }: { searchParams: Promise<{ archives?: string }> }) {
  const actor = await guard({ orgTypes: ["CUSTOMER"] });
  const showArchived = (await searchParams).archives === "1";
  const sites = await withActor(actor, (tx) => listSites(tx, actor, { includeArchived: showArchived }));
  return (
    <>
      <PageHeader
        title={t("customer.sites.title")}
        description={t("customer.sites.intro")}
        actions={can.customerWrite(actor) ? <ButtonLink href="/client/sites/nouveau" icon={<Plus aria-hidden className="size-4" />}>{t("customer.sites.new")}</ButtonLink> : null}
      />
      <p className="mb-3 text-sm">
        <Link href={showArchived ? "/client/sites" : "/client/sites?archives=1"} className="font-medium text-brand hover:underline">
          {showArchived ? t("customer.assets.hideArchived") : t("customer.assets.showArchived")}
        </Link>
      </p>
      {sites.length === 0 ? (
        <EmptyState icon={Building} title={t("customer.sites.empty")} action={can.customerWrite(actor) ? <ButtonLink href="/client/sites/nouveau">{t("customer.sites.new")}</ButtonLink> : null}>
          {t("customer.sites.emptyBody")}
        </EmptyState>
      ) : (
        <Table caption={t("customer.sites.title")} head={<tr><Th>{t("customer.sites.name")}</Th><Th>{t("customer.sites.city")}</Th><Th>{t("customer.sites.area")}</Th><Th>{t("customer.sites.equipmentCount")}</Th><Th>{t("common.status")}</Th></tr>}>
          {sites.map((s) => (
            <tr key={s.id}>
              <Td>
                <Link href={`/client/sites/${s.id}`} className="font-semibold text-ink hover:text-brand hover:underline">
                  {s.name}
                </Link>
                <span className="block text-xs text-muted">{s.addressLine}</span>
              </Td>
              <Td>{s.city}</Td>
              <Td>{s.serviceArea?.name ?? <Badge tone="warn">{t("customer.sites.outsideArea")}</Badge>}</Td>
              <Td className="tabular">{s._count.equipment}</Td>
              <Td>{s.archivedAt ? <Badge>{t("customer.assets.archived")}</Badge> : <Badge tone="success">{t("customer.assets.active")}</Badge>}</Td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
