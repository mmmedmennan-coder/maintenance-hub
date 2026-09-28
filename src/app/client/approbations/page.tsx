import { SquareCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { t, te } from "@/lib/i18n";
import { formatMoney, formatQuantity } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/time";
import { can } from "@/server/auth/roles";
import { guard } from "@/server/auth/page-guard";
import { withActor } from "@/server/db/context";
import { pendingApprovals } from "@/server/modules/dashboards";
import { QuoteDecisionPanel } from "@/features/quote-actions";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert, EmptyState } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/layout";

export const metadata: Metadata = { title: t("approvals.title") };

export default async function ApprovalsPage() {
  const actor = await guard({ orgTypes: ["CUSTOMER"] });
  const items = await withActor(actor, (tx) => pendingApprovals(tx, actor));
  const writer = can.customerWrite(actor);
  return (
    <>
      <PageHeader title={t("approvals.title")} description={t("approvals.intro")} />
      {!writer ? <Alert tone="info" className="mb-4">{t("quote.viewerNote")}</Alert> : null}
      {items.length === 0 ? (
        <EmptyState icon={SquareCheck} title={t("approvals.empty")}>{t("approvals.emptyBody")}</EmptyState>
      ) : (
        <div className="space-y-4">
          {items.map((v) => {
            const wo = v.repairQuote.workOrder;
            return (
              <Card key={v.id}>
                <CardHeader
                  title={`${v.repairQuote.title} · ${t("quote.version", { n: v.versionNo })}`}
                  description={`${wo.reference} · ${wo.equipment.label} · ${wo.site.name}`}
                  actions={<span className="text-lg font-bold tabular-nums">{formatMoney(v.totalMinor, v.currency)}</span>}
                />
                <CardBody className="space-y-3">
                  <p className="whitespace-pre-line text-sm text-ink-soft">{v.scopeSummary}</p>
                  <ul className="divide-y divide-line rounded-lg border border-line text-sm">
                    {v.lines.map((l) => (
                      <li key={l.id} className="flex flex-wrap justify-between gap-2 px-3 py-2">
                        <span>
                          <span className="text-xs text-muted">{te("enums.lineKind", l.kind)} · </span>
                          {l.description} × {formatQuantity(l.quantityMilli)}
                        </span>
                        <span className="tabular-nums">{formatMoney(l.totalMinor, v.currency)}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs text-muted">
                    {t("quote.issuedOn", { date: formatDateTime(v.issuedAt) })}
                    {v.validUntil ? ` · ${t("quote.validUntil", { date: formatDate(v.validUntil) })}` : ""}
                  </p>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    {writer && v.snapshotHash ? <QuoteDecisionPanel versionId={v.id} snapshotHash={v.snapshotHash} totalMinor={v.totalMinor} currency={v.currency} /> : <span />}
                    <Link href={`/client/rendez-vous/${wo.booking.id}#devis`} className="text-sm font-semibold text-brand hover:underline">
                      {t("approvals.openJob", { ref: wo.booking.reference })}
                    </Link>
                  </div>
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
