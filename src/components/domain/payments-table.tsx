import Link from "next/link";
import { t, te } from "@/lib/i18n";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/time";
import type { listOrgPayments } from "@/server/modules/payments";
import { PaymentDecision } from "@/features/payment-actions";
import { Stat } from "@/components/ui/feedback";
import { Table, Td, Th } from "@/components/ui/layout";
import { StatusBadge } from "./status-badge";

type Data = Awaited<ReturnType<typeof listOrgPayments>>;

export function PaymentTotals({ sums }: { sums: Data["sums"] }) {
  return (
    <div className="mb-6 grid gap-3 sm:grid-cols-3">
      <Stat label={t("payment.confirmed")} value={formatMoney(sums.CONFIRMED ?? 0)} tone="success" />
      <Stat label={t("payment.reportedPending")} value={formatMoney(sums.REPORTED ?? 0)} tone="warn" />
      <Stat label={t("payment.reversedTotal")} value={formatMoney(sums.REVERSED ?? 0)} />
    </div>
  );
}

/** Direct-payment records (the platform never holds funds). Provider managers act on them. */
export function PaymentsTable({ items, basePath, canDecide }: { items: Data["items"]; basePath: string; canDecide: boolean }) {
  return (
    <Table
      caption={t("payment.title")}
      head={
        <tr>
          <Th>{t("payment.booking")}</Th>
          <Th>{t("payment.amount")}</Th>
          <Th>{t("payment.method")}</Th>
          <Th>{t("payment.paidOn")}</Th>
          <Th>{t("payment.recordedBy")}</Th>
          <Th>{t("common.status")}</Th>
          {canDecide ? <Th>{t("common.actions")}</Th> : null}
        </tr>
      }
    >
      {items.map((p) => (
        <tr key={p.id}>
          <Td>
            <Link href={`${basePath}/${p.booking.id}#paiements`} className="font-semibold text-brand hover:underline">
              {p.booking.reference}
            </Link>
            {p.externalReference ? <span className="block text-xs text-muted">{p.externalReference}</span> : null}
          </Td>
          <Td className="whitespace-nowrap font-semibold tabular-nums">{formatMoney(p.amountMinor, p.currency)}</Td>
          <Td>{te("enums.paymentMethod", p.method)}</Td>
          <Td className="whitespace-nowrap">{formatDate(p.paidOn)}</Td>
          <Td>{te("enums.partySide", p.reportedSide)}</Td>
          <Td>
            <StatusBadge domain="payment" status={p.status} />
            {p.rejectionReason || p.reversalReason ? <span className="mt-1 block text-xs text-danger">{p.rejectionReason ?? p.reversalReason}</span> : null}
          </Td>
          {canDecide ? (
            <Td>
              <PaymentDecision paymentId={p.id} status={p.status} />
            </Td>
          ) : null}
        </tr>
      ))}
    </Table>
  );
}
