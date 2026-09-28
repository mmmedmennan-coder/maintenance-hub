import { Route } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { t, te } from "@/lib/i18n";
import { formatDateTime } from "@/lib/time";
import { guard } from "@/server/auth/page-guard";
import { withActor } from "@/server/db/context";
import { listUnmatchedRequests } from "@/server/modules/requests";
import { Badge, EmptyState } from "@/components/ui/feedback";
import { PageHeader, Table, Td, Th } from "@/components/ui/layout";

export const metadata: Metadata = { title: t("admin.routing.title") };

/** Human-assisted routing queue: breakdowns first. No response time is promised to customers. */
export default async function AdminRoutingPage() {
  const actor = await guard({ orgTypes: ["PLATFORM"], roles: ["platform_admin"] });
  const items = await withActor(actor, (tx) => listUnmatchedRequests(tx, actor));
  return (
    <>
      <PageHeader title={t("admin.routing.title")} description={t("admin.routing.intro")} />
      {items.length === 0 ? (
        <EmptyState icon={Route} title={t("admin.routing.empty")} />
      ) : (
        <Table caption={t("admin.routing.title")} head={<tr><Th>{t("common.reference")}</Th><Th>{t("admin.routing.kind")}</Th><Th>{t("booking.category")}</Th><Th>{t("admin.routing.area")}</Th><Th>{t("admin.routing.submitted")}</Th><Th>{t("admin.routing.history")}</Th></tr>}>
          {items.map((r) => (
            <tr key={r.id}>
              <Td>
                <Link href={`/admin/routage/${r.id}`} className="font-semibold text-brand hover:underline">{r.reference}</Link>
                <span className="block text-xs text-muted">{r.title}</span>
              </Td>
              <Td>{r.kind === "BREAKDOWN" ? <Badge tone="danger">{te("enums.requestKind", r.kind)}</Badge> : te("enums.requestKind", r.kind)}</Td>
              <Td>{r.equipmentCategory.labelFr}</Td>
              <Td>{r.serviceArea?.name ?? t("customer.sites.outsideArea")}</Td>
              <Td className="whitespace-nowrap text-sm">{formatDateTime(r.submittedAt)}</Td>
              <Td className="text-sm">{r.invitations.length ? t("admin.routing.previous", { n: r.invitations.length }) : "—"}</Td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
