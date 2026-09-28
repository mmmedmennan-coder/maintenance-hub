import { Receipt } from "lucide-react";
import type { Metadata } from "next";
import { t } from "@/lib/i18n";
import { can } from "@/server/auth/roles";
import { guard } from "@/server/auth/page-guard";
import { withActor } from "@/server/db/context";
import { listOrgPayments } from "@/server/modules/payments";
import { PaymentTotals, PaymentsTable } from "@/components/domain/payments-table";
import { Alert, EmptyState } from "@/components/ui/feedback";
import { PageHeader, Pagination } from "@/components/ui/layout";

export const metadata: Metadata = { title: t("payment.title") };

export default async function ProviderPaymentsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const actor = await guard({ orgTypes: ["PROVIDER"], roles: ["provider_owner", "provider_dispatcher"] });
  const page = Math.max(1, Number((await searchParams).page) || 1);
  const data = await withActor(actor, (tx) => listOrgPayments(tx, actor, page));
  return (
    <>
      <PageHeader title={t("payment.title")} description={t("payment.providerPageIntro")} />
      <Alert tone="info" className="mb-6">{t("payment.noFunds")}</Alert>
      <PaymentTotals sums={data.sums} />
      {data.items.length === 0 ? <EmptyState icon={Receipt} title={t("payment.none")} /> : <PaymentsTable items={data.items} basePath="/prestataire/rendez-vous" canDecide={can.providerManage(actor)} />}
      <Pagination page={data.page} pageSize={data.pageSize} total={data.total} hrefFor={(n) => `/prestataire/paiements?page=${n}`} />
    </>
  );
}
