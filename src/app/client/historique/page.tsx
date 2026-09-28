import { ScrollText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { t } from "@/lib/i18n";
import { formatDate } from "@/lib/time";
import { guard } from "@/server/auth/page-guard";
import { withActor } from "@/server/db/context";
import { serviceHistory } from "@/server/modules/dashboards";
import { StatusBadge } from "@/components/domain/status-badge";
import { EmptyState } from "@/components/ui/feedback";
import { PageHeader, Pagination, Table, Td, Th } from "@/components/ui/layout";

export const metadata: Metadata = { title: t("history.title") };

export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ equipement?: string; page?: string }> }) {
  const actor = await guard({ orgTypes: ["CUSTOMER"] });
  const sp = await searchParams;
  const equipmentId = sp.equipement && /^[0-9a-f-]{36}$/.test(sp.equipement) ? sp.equipement : undefined;
  const page = Math.max(1, Number(sp.page) || 1);
  const data = await withActor(actor, (tx) => serviceHistory(tx, actor, { equipmentId, page }));
  const base = `/client/historique?${equipmentId ? `equipement=${equipmentId}&` : ""}`;
  return (
    <>
      <PageHeader
        title={t("history.title")}
        description={t("history.intro")}
        meta={equipmentId && data.items[0] ? (
          <span className="text-sm">
            {t("history.filtered", { label: data.items[0].equipment.label })} · <Link href="/client/historique" className="font-semibold text-brand hover:underline">{t("history.clear")}</Link>
          </span>
        ) : null}
      />
      {data.items.length === 0 ? (
        <EmptyState icon={ScrollText} title={t("history.empty")}>{t("history.emptyBody")}</EmptyState>
      ) : (
        <Table
          caption={t("history.title")}
          head={
            <tr>
              <Th>{t("history.completed")}</Th>
              <Th>{t("booking.equipment")}</Th>
              <Th>{t("booking.provider")}</Th>
              <Th>{t("report.findings")}</Th>
              <Th>{t("report.nextServiceDate")}</Th>
              <Th>{t("history.documents")}</Th>
            </tr>
          }
        >
          {data.items.map((w) => (
            <tr key={w.id}>
              <Td className="whitespace-nowrap">
                {formatDate(w.completedAt)}
                <Link href={`/client/rendez-vous/${w.booking.id}`} className="block text-xs font-semibold text-brand hover:underline">
                  {w.reference}
                </Link>
              </Td>
              <Td>
                <Link href={`/client/historique?equipement=${w.equipment.id}`} className="font-medium hover:text-brand">{w.equipment.label}</Link>
                <span className="block text-xs text-muted">{w.site.name}</span>
              </Td>
              <Td>
                {w.providerName}
                {w.booking.technicianName ? <span className="block text-xs text-muted">{w.booking.technicianName}</span> : null}
              </Td>
              <Td className="max-w-sm text-sm">
                <span className="line-clamp-3">{w.report?.findings ?? "—"}</span>
                {w.report?.repairDeclined ? <span className="block text-xs text-warn">{t("history.repairDeclined")}</span> : null}
                {w.acknowledgment ? <span className="mt-1 block"><StatusBadge domain="ack" status={w.acknowledgment} /></span> : null}
              </Td>
              <Td className="whitespace-nowrap">{w.report?.nextServiceDate ? formatDate(w.report.nextServiceDate) : "—"}</Td>
              <Td>
                {w.report ? (
                  <a href={`/api/v1/reports/${w.report.id}/pdf`} className="text-sm font-semibold text-brand hover:underline">
                    {t("report.pdf")}
                  </a>
                ) : "—"}
              </Td>
            </tr>
          ))}
        </Table>
      )}
      <Pagination page={data.page} pageSize={data.pageSize} total={data.total} hrefFor={(n) => `${base}page=${n}`} />
    </>
  );
}
