import { Inbox } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { t, te } from "@/lib/i18n";
import { formatMoney } from "@/lib/money";
import { formatDateTime } from "@/lib/time";
import { guard } from "@/server/auth/page-guard";
import { withActor } from "@/server/db/context";
import { listProviderInvitations } from "@/server/modules/requests";
import { FilterTabs } from "@/components/domain/booking-list";
import { StatusBadge } from "@/components/domain/status-badge";
import { EmptyState } from "@/components/ui/feedback";
import { PageHeader, Pagination, Table, Td, Th } from "@/components/ui/layout";

export const metadata: Metadata = { title: t("providerInvitations.title") };
const TABS = ["", "INVITED", "OFFERED", "DECLINED", "REVOKED", "CLOSED"];

export default async function ProviderInvitationsPage({ searchParams }: { searchParams: Promise<{ statut?: string; page?: string }> }) {
  const actor = await guard({ orgTypes: ["PROVIDER"], roles: ["provider_owner", "provider_dispatcher"] });
  const sp = await searchParams;
  const status = TABS.includes(sp.statut ?? "") ? (sp.statut ?? "") : "";
  const page = Math.max(1, Number(sp.page) || 1);
  const data = await withActor(actor, (tx) => listProviderInvitations(tx, actor, { status, page }));
  return (
    <>
      <PageHeader title={t("providerInvitations.title")} description={t("providerInvitations.intro")} />
      <FilterTabs label={t("providerInvitations.filterLabel")} tabs={TABS} current={status} hrefFor={(s) => (s ? `/prestataire/invitations?statut=${s}` : "/prestataire/invitations")} labelFor={(s) => te("status.invitation", s)} />
      {data.items.length === 0 ? (
        <EmptyState icon={Inbox} title={t("providerInvitations.empty")}>{t("providerInvitations.emptyBody")}</EmptyState>
      ) : (
        <Table
          caption={t("providerInvitations.title")}
          head={
            <tr>
              <Th>{t("common.reference")}</Th>
              <Th>{t("providerInvitations.subject")}</Th>
              <Th>{t("providerInvitations.where")}</Th>
              <Th>{t("providerInvitations.yourOffer")}</Th>
              <Th>{t("common.status")}</Th>
              <Th>{t("providerInvitations.received")}</Th>
            </tr>
          }
        >
          {data.items.map((i) => {
            const v = i.offer?.versions[0];
            return (
              <tr key={i.id}>
                <Td>
                  <Link href={`/prestataire/invitations/${i.id}`} className="font-semibold text-brand hover:underline">
                    {i.brief.reference}
                  </Link>
                  <span className="block text-xs text-muted">{te("enums.requestKind", i.brief.kind)}</span>
                </Td>
                <Td>
                  <span className="font-medium">{i.brief.title}</span>
                  <span className="block text-xs text-muted">{i.brief.equipmentCategory}</span>
                </Td>
                <Td>{i.brief.city}</Td>
                <Td className="text-sm">{v ? <>{formatMoney(v.totalMinor)} · <StatusBadge domain="offerVersion" status={v.status} /></> : "—"}</Td>
                <Td><StatusBadge domain="invitation" status={i.status} /></Td>
                <Td className="whitespace-nowrap text-sm">{formatDateTime(i.createdAt)}</Td>
              </tr>
            );
          })}
        </Table>
      )}
      <Pagination page={data.page} pageSize={data.pageSize} total={data.total} hrefFor={(n) => `/prestataire/invitations?${status ? `statut=${status}&` : ""}page=${n}`} />
    </>
  );
}
