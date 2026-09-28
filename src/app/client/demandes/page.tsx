import { ClipboardList, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { t, te } from "@/lib/i18n";
import { formatDate } from "@/lib/time";
import { can } from "@/server/auth/roles";
import { guard } from "@/server/auth/page-guard";
import { withActor } from "@/server/db/context";
import { listCustomerRequests } from "@/server/modules/requests";
import { StatusBadge } from "@/components/domain/status-badge";
import { ButtonLink } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { EmptyState } from "@/components/ui/feedback";
import { PageHeader, Pagination, Table, Td, Th } from "@/components/ui/layout";

export const metadata: Metadata = { title: t("customer.requests.title") };

const TABS = ["", "DRAFT", "OPEN", "BOOKING", "CLOSED", "CANCELLED"];

export default async function RequestsPage({ searchParams }: { searchParams: Promise<{ statut?: string; page?: string }> }) {
  const actor = await guard({ orgTypes: ["CUSTOMER"] });
  const sp = await searchParams;
  const status = TABS.includes(sp.statut ?? "") ? sp.statut : "";
  const page = Math.max(1, Number(sp.page) || 1);
  const data = await withActor(actor, (tx) => listCustomerRequests(tx, actor, { status, page }));
  return (
    <>
      <PageHeader
        title={t("customer.requests.title")}
        description={t("customer.requests.intro")}
        actions={can.customerWrite(actor) ? <ButtonLink href="/client/demandes/nouvelle" icon={<Plus aria-hidden className="size-4" />}>{t("customer.requests.new")}</ButtonLink> : null}
      />
      <nav aria-label={t("customer.requests.filterLabel")} className="mb-4 flex flex-wrap gap-2">
        {TABS.map((s) => (
          <Link key={s || "all"} href={s ? `/client/demandes?statut=${s}` : "/client/demandes"} aria-current={status === s ? "page" : undefined} className={cn("rounded-full border px-3 py-1 text-sm font-medium", status === s ? "border-brand bg-brand text-white" : "border-line-strong bg-surface hover:bg-subtle")}>
            {s ? te("status.request", s) : t("common.all")}
          </Link>
        ))}
      </nav>
      {data.items.length === 0 ? (
        <EmptyState icon={ClipboardList} title={t("customer.requests.empty")}>{t("customer.requests.emptyBody")}</EmptyState>
      ) : (
        <Table caption={t("customer.requests.title")} head={<tr><Th>{t("common.reference")}</Th><Th>{t("customer.requests.subject")}</Th><Th>{t("customer.requests.kind")}</Th><Th>{t("customer.requests.progress")}</Th><Th>{t("common.status")}</Th><Th>{t("common.date")}</Th></tr>}>
          {data.items.map((r) => (
            <tr key={r.id}>
              <Td><Link href={`/client/demandes/${r.id}`} className="font-semibold text-brand hover:underline">{r.reference}</Link></Td>
              <Td><span className="font-medium text-ink">{r.title}</span><span className="block text-xs text-muted">{r.equipment.label} · {r.site.name}</span></Td>
              <Td>{te("enums.requestKind", r.kind)}</Td>
              <Td className="text-sm">
                {r.status === "OPEN" ? t("customer.requests.progressOpen", { invited: r._count.invitations, offers: r.issuedOffers }) : r.bookings[0] ? <StatusBadge domain="booking" status={r.bookings[0].status} /> : "—"}
              </Td>
              <Td><StatusBadge domain="request" status={r.status} /></Td>
              <Td className="whitespace-nowrap">{formatDate(r.createdAt)}</Td>
            </tr>
          ))}
        </Table>
      )}
      <Pagination page={data.page} pageSize={data.pageSize} total={data.total} hrefFor={(n) => `/client/demandes?${status ? `statut=${status}&` : ""}page=${n}`} />
    </>
  );
}
