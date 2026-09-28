import { ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { t, te } from "@/lib/i18n";
import { formatDateTime } from "@/lib/time";
import { guard } from "@/server/auth/page-guard";
import { withActor } from "@/server/db/context";
import { listProvidersForReview } from "@/server/modules/admin";
import { FilterTabs } from "@/components/domain/booking-list";
import { StatusBadge } from "@/components/domain/status-badge";
import { Badge, EmptyState } from "@/components/ui/feedback";
import { PageHeader, Table, Td, Th } from "@/components/ui/layout";

export const metadata: Metadata = { title: t("admin.providers.title") };
const TABS = ["", "SUBMITTED", "APPROVED", "DRAFT", "REJECTED", "SUSPENDED"];

export default async function AdminProvidersPage({ searchParams }: { searchParams: Promise<{ statut?: string }> }) {
  const actor = await guard({ orgTypes: ["PLATFORM"], roles: ["platform_admin"] });
  const sp = await searchParams;
  const status = TABS.includes(sp.statut ?? "") ? (sp.statut ?? "") : "";
  const items = await withActor(actor, (tx) => listProvidersForReview(tx, actor, status || undefined));
  return (
    <>
      <PageHeader title={t("admin.providers.title")} description={t("admin.providers.intro")} />
      <FilterTabs label={t("admin.providers.filterLabel")} tabs={TABS} current={status} hrefFor={(s) => (s ? `/admin/prestataires?statut=${s}` : "/admin/prestataires")} labelFor={(s) => te("status.provider", s)} />
      {items.length === 0 ? (
        <EmptyState icon={ShieldCheck} title={t("admin.providers.empty")} />
      ) : (
        <Table caption={t("admin.providers.title")} head={<tr><Th>{t("admin.providers.name")}</Th><Th>{t("admin.providers.areas")}</Th><Th>{t("admin.providers.checks")}</Th><Th>{t("admin.providers.submitted")}</Th><Th>{t("common.status")}</Th></tr>}>
          {items.map((p) => (
            <tr key={p.id}>
              <Td>
                <Link href={`/admin/prestataires/${p.id}`} className="font-semibold text-brand hover:underline">{p.displayName}</Link>
                {p.organization.isDemo ? <Badge tone="warn" className="ml-2">{t("app.demoBadge")}</Badge> : null}
                <span className="block text-xs text-muted">{p.organization.name} · {p.city}</span>
              </Td>
              <Td className="text-sm">{p.serviceAreas.map((a) => a.serviceArea.name).join(", ") || "—"}</Td>
              <Td className="text-sm">{p.checks.filter((c) => c.status === "VERIFIED").map((c) => te("enums.checkType", c.type)).join(", ") || "—"}</Td>
              <Td className="whitespace-nowrap text-sm">{p.submittedAt ? formatDateTime(p.submittedAt) : "—"}</Td>
              <Td><StatusBadge domain="provider" status={p.status} /></Td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
