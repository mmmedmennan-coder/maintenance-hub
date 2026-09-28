import { CalendarDays } from "lucide-react";
import Link from "next/link";
import { t, te } from "@/lib/i18n";
import { formatMoney } from "@/lib/money";
import { formatDateTime, formatWindow } from "@/lib/time";
import type { listBookings } from "@/server/modules/bookings";
import { cn } from "@/components/ui/cn";
import { EmptyState } from "@/components/ui/feedback";
import { Pagination, Table, Td, Th } from "@/components/ui/layout";
import { StatusBadge } from "./status-badge";

export const BOOKING_TABS = ["", "PENDING_CONFIRMATION", "CONFIRMED", "COMPLETED", "CANCELLED", "DECLINED", "EXPIRED", "NO_SHOW"];

export function FilterTabs({ label, tabs, current, hrefFor, labelFor }: { label: string; tabs: string[]; current: string; hrefFor: (tab: string) => string; labelFor: (tab: string) => string }) {
  return (
    <nav aria-label={label} className="mb-4 flex flex-wrap gap-2">
      {tabs.map((s) => (
        <Link
          key={s || "all"}
          href={hrefFor(s)}
          aria-current={current === s ? "page" : undefined}
          className={cn("rounded-full border px-3 py-1 text-sm font-medium", current === s ? "border-brand bg-brand text-white" : "border-line-strong bg-surface hover:bg-subtle")}
        >
          {s ? labelFor(s) : t("common.all")}
        </Link>
      ))}
    </nav>
  );
}

/** Booking table shared by the customer and provider workspaces (rows already filtered by RLS). */
export function BookingList({ data, basePath, status, counterpart }: { data: Awaited<ReturnType<typeof listBookings>>; basePath: string; status: string; counterpart: "provider" | "customer" }) {
  return (
    <>
      <FilterTabs label={t("booking.filterLabel")} tabs={BOOKING_TABS} current={status} hrefFor={(s) => (s ? `${basePath}?statut=${s}` : basePath)} labelFor={(s) => te("status.booking", s)} />
      {data.items.length === 0 ? (
        <EmptyState icon={CalendarDays} title={t("booking.empty")}>
          {t(counterpart === "provider" ? "booking.emptyCustomer" : "booking.emptyProvider")}
        </EmptyState>
      ) : (
        <Table
          caption={t("booking.listTitle")}
          head={
            <tr>
              <Th>{t("common.reference")}</Th>
              <Th>{t("booking.slot")}</Th>
              <Th>{counterpart === "provider" ? t("booking.provider") : t("booking.customer")}</Th>
              <Th>{t("booking.equipment")}</Th>
              <Th>{t("booking.offerTotal")}</Th>
              <Th>{t("common.status")}</Th>
            </tr>
          }
        >
          {data.items.map((b) => (
            <tr key={b.id}>
              <Td>
                <Link href={`${basePath}/${b.id}`} className="font-semibold text-brand hover:underline">
                  {b.reference}
                </Link>
                <span className="block text-xs text-muted">{te("enums.offerKind", b.kind)}</span>
              </Td>
              <Td className="text-sm">
                {b.scheduledStart ? formatWindow(b.scheduledStart, b.scheduledEnd) : <span className="text-muted">{formatWindow(b.windowStart, b.windowEnd)}</span>}
                {b.status === "PENDING_CONFIRMATION" ? <span className="block text-xs text-warn">{t("booking.confirmBy", { date: formatDateTime(b.confirmationDeadline) })}</span> : null}
              </Td>
              <Td>{counterpart === "provider" ? b.providerName : b.customerName}</Td>
              <Td>
                {b.equipment.label}
                <span className="block text-xs text-muted">
                  {b.site.name} · {b.site.city}
                </span>
              </Td>
              <Td className="whitespace-nowrap tabular-nums">{formatMoney(b.offerVersion.totalMinor, b.offerVersion.currency)}</Td>
              <Td>
                <div className="flex flex-col items-start gap-1">
                  <StatusBadge domain="booking" status={b.status} />
                  {b.workOrder && b.status === "CONFIRMED" ? <StatusBadge domain="workOrder" status={b.workOrder.status} /> : null}
                  {b.workOrder?.acknowledgment === "PENDING" ? <StatusBadge domain="ack" status="PENDING" /> : null}
                </div>
              </Td>
            </tr>
          ))}
        </Table>
      )}
      <Pagination page={data.page} pageSize={data.pageSize} total={data.total} hrefFor={(n) => `${basePath}?${status ? `statut=${status}&` : ""}page=${n}`} />
    </>
  );
}
