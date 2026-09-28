import { Scale } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { t, te } from "@/lib/i18n";
import { formatDateTime } from "@/lib/time";
import { guard } from "@/server/auth/page-guard";
import { withActor } from "@/server/db/context";
import { listDisputes } from "@/server/modules/feedback";
import { FilterTabs } from "@/components/domain/booking-list";
import { StatusBadge } from "@/components/domain/status-badge";
import { EmptyState } from "@/components/ui/feedback";
import { PageHeader, Table, Td, Th } from "@/components/ui/layout";

export const metadata: Metadata = { title: t("admin.disputes.title") };
const TABS = ["", "OPEN", "UNDER_REVIEW", "RESOLVED", "WITHDRAWN"];

export default async function AdminDisputesPage({ searchParams }: { searchParams: Promise<{ statut?: string }> }) {
  const actor = await guard({ orgTypes: ["PLATFORM"], roles: ["platform_admin"] });
  const sp = await searchParams;
  const status = TABS.includes(sp.statut ?? "") ? (sp.statut ?? "") : "";
  const items = await withActor(actor, (tx) => listDisputes(tx, actor, status || undefined));
  return (
    <>
      <PageHeader title={t("admin.disputes.title")} description={t("admin.disputes.intro")} />
      <FilterTabs label={t("admin.disputes.filterLabel")} tabs={TABS} current={status} hrefFor={(s) => (s ? `/admin/litiges?statut=${s}` : "/admin/litiges")} labelFor={(s) => te("status.dispute", s)} />
      {items.length === 0 ? (
        <EmptyState icon={Scale} title={t("admin.disputes.empty")} />
      ) : (
        <Table caption={t("admin.disputes.title")} head={<tr><Th>{t("booking.workOrder")}</Th><Th>{t("admin.disputes.parties")}</Th><Th>{t("admin.disputes.reason")}</Th><Th>{t("common.date")}</Th><Th>{t("common.status")}</Th></tr>}>
          {items.map((d) => (
            <tr key={d.id}>
              <Td><Link href={`/admin/litiges/${d.id}`} className="font-semibold text-brand hover:underline">{d.workOrder.reference}</Link></Td>
              <Td className="text-sm">{d.customerName}<span className="block text-xs text-muted">{d.providerName}</span></Td>
              <Td className="max-w-md text-sm"><span className="line-clamp-2">{d.reason}</span></Td>
              <Td className="whitespace-nowrap text-sm">{formatDateTime(d.createdAt)}</Td>
              <Td><StatusBadge domain="dispute" status={d.status} /></Td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
