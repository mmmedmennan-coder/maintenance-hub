import { FileText } from "lucide-react";
import type { Metadata } from "next";
import { t, te } from "@/lib/i18n";
import { guard } from "@/server/auth/page-guard";
import { withActor } from "@/server/db/context";
import { listVisibleDocuments } from "@/server/modules/dashboards";
import { DocumentsTable } from "@/components/domain/documents-table";
import { FilterTabs } from "@/components/domain/booking-list";
import { EmptyState } from "@/components/ui/feedback";
import { PageHeader, Pagination } from "@/components/ui/layout";

export const metadata: Metadata = { title: t("documents.title") };
const KINDS = ["", "PHOTO", "ATTACHMENT", "REPORT_PDF", "QUOTE_PDF", "PAYMENT_EVIDENCE"];

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<{ type?: string; page?: string }> }) {
  const actor = await guard({ orgTypes: ["CUSTOMER"] });
  const sp = await searchParams;
  const kind = KINDS.includes(sp.type ?? "") ? (sp.type ?? "") : "";
  const page = Math.max(1, Number(sp.page) || 1);
  const data = await withActor(actor, (tx) => listVisibleDocuments(tx, actor, { kind, page }));
  return (
    <>
      <PageHeader title={t("documents.title")} description={t("documents.intro")} />
      <FilterTabs label={t("documents.filterLabel")} tabs={KINDS} current={kind} hrefFor={(k) => (k ? `/client/documents?type=${k}` : "/client/documents")} labelFor={(k) => te("enums.documentKind", k)} />
      {data.items.length === 0 ? <EmptyState icon={FileText} title={t("documents.emptyTitle")}>{t("documents.emptyBody")}</EmptyState> : <DocumentsTable items={data.items} workspace="client" />}
      <Pagination page={data.page} pageSize={data.pageSize} total={data.total} hrefFor={(n) => `/client/documents?${kind ? `type=${kind}&` : ""}page=${n}`} />
    </>
  );
}
