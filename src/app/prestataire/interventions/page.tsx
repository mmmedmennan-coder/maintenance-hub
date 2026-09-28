import { Wrench } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { t, te } from "@/lib/i18n";
import { formatDateTime } from "@/lib/time";
import { guard } from "@/server/auth/page-guard";
import { withActor } from "@/server/db/context";
import { listProviderWorkOrders } from "@/server/modules/work";
import { FilterTabs } from "@/components/domain/booking-list";
import { StatusBadge } from "@/components/domain/status-badge";
import { EmptyState } from "@/components/ui/feedback";
import { PageHeader, Table, Td, Th } from "@/components/ui/layout";

export const metadata: Metadata = { title: t("workOrders.title") };
const TABS = ["", "SCHEDULED", "EN_ROUTE", "ON_SITE", "AWAITING_APPROVAL", "DIAGNOSED", "AWAITING_PARTS", "IN_PROGRESS", "REPORT_SUBMITTED", "CANCELLED"];

export default async function ProviderWorkOrdersPage({ searchParams }: { searchParams: Promise<{ statut?: string }> }) {
  const actor = await guard({ orgTypes: ["PROVIDER"], roles: ["provider_owner", "provider_dispatcher"] });
  const sp = await searchParams;
  const status = TABS.includes(sp.statut ?? "") ? (sp.statut ?? "") : "";
  const items = await withActor(actor, (tx) => listProviderWorkOrders(tx, actor, { status }));
  return (
    <>
      <PageHeader title={t("workOrders.title")} description={t("workOrders.intro")} />
      <FilterTabs label={t("workOrders.filterLabel")} tabs={TABS} current={status} hrefFor={(s) => (s ? `/prestataire/interventions?statut=${s}` : "/prestataire/interventions")} labelFor={(s) => te("status.workOrder", s)} />
      {items.length === 0 ? (
        <EmptyState icon={Wrench} title={t("workOrders.empty")} />
      ) : (
        <Table
          caption={t("workOrders.title")}
          head={
            <tr>
              <Th>{t("common.reference")}</Th>
              <Th>{t("booking.scheduled")}</Th>
              <Th>{t("booking.technician")}</Th>
              <Th>{t("booking.site")}</Th>
              <Th>{t("common.status")}</Th>
            </tr>
          }
        >
          {items.map((w) => (
            <tr key={w.id}>
              <Td>
                <Link href={`/prestataire/rendez-vous/${w.booking.id}`} className="font-semibold text-brand hover:underline">
                  {w.reference}
                </Link>
                <span className="block text-xs text-muted">{w.booking.reference} · {te("enums.offerKind", w.kind)}</span>
              </Td>
              <Td className="whitespace-nowrap text-sm">{formatDateTime(w.booking.scheduledStart)}</Td>
              <Td>{w.booking.technicianName ?? "—"}</Td>
              <Td>
                {w.equipment.label}
                <span className="block text-xs text-muted">{w.site.name} · {w.site.city}</span>
              </Td>
              <Td>
                <StatusBadge domain="workOrder" status={w.status} />
                {w.acknowledgment ? <span className="mt-1 block"><StatusBadge domain="ack" status={w.acknowledgment} /></span> : null}
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
