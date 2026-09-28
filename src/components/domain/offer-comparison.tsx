"use client";

import { BadgeCheck, Star } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api-client";
import { t, te } from "@/lib/i18n";
import { formatMoney, formatRate } from "@/lib/money";
import { durationLabel, formatDateTime, formatWindow } from "@/lib/time";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Dialog, errorMessage, useIdempotencyKey } from "@/components/ui/dialog";
import { Alert, Badge } from "@/components/ui/feedback";
import { FormError } from "@/components/ui/field";

export type ComparableOffer = {
  versionId: string;
  providerName: string;
  providerSlug: string | null;
  providerIsDemo: boolean;
  verifiedChecks: string[];
  rating: { avg: number | null; count: number };
  status: string;
  versionNo: number;
  previousVersions: number;
  kind: "DIAGNOSTIC" | "MAINTENANCE";
  scope: string;
  calloutFeeMinor: number | null;
  serviceFeeMinor: number | null;
  taxRateBp: number | null;
  taxNote: string | null;
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
  currency: string;
  windowStart: string | null;
  windowEnd: string | null;
  estimatedDurationMin: number | null;
  exclusions: string | null;
  cancellationTerms: string | null;
  warrantyTerms: string | null;
  expiresAt: string | null;
  issuedAt: string | null;
  expired: boolean;
};

function Missing() {
  return <span className="font-medium text-warn">{t("customer.offers.notProvided")}</span>;
}

function money(v: number | null, c: string) {
  return v === null ? <Missing /> : formatMoney(v, c);
}

const ROWS: { key: string; render: (o: ComparableOffer) => React.ReactNode }[] = [
  { key: "kind", render: (o) => te("enums.offerKind", o.kind) },
  { key: "scope", render: (o) => <span className="prose-plain">{o.scope}</span> },
  { key: "callout", render: (o) => money(o.calloutFeeMinor, o.currency) },
  { key: "service", render: (o) => money(o.serviceFeeMinor, o.currency) },
  { key: "tax", render: (o) => (o.taxRateBp === null ? <Missing /> : `${formatRate(o.taxRateBp)} · ${formatMoney(o.taxMinor, o.currency)}${o.taxNote ? ` (${o.taxNote})` : ""}`) },
  { key: "total", render: (o) => <strong className="text-base">{formatMoney(o.totalMinor, o.currency)}</strong> },
  { key: "repair", render: (o) => (o.kind === "DIAGNOSTIC" ? t("customer.offers.repairAfterDiagnosis") : t("customer.offers.repairNotIncluded")) },
  { key: "window", render: (o) => (o.windowStart ? <>{formatWindow(o.windowStart, o.windowEnd)}<span className="block text-xs text-muted">{t("customer.offers.windowProvisional")}</span></> : <Missing />) },
  { key: "duration", render: (o) => (o.estimatedDurationMin ? durationLabel(o.estimatedDurationMin) : <Missing />) },
  { key: "exclusions", render: (o) => o.exclusions ?? <Missing /> },
  { key: "cancellation", render: (o) => o.cancellationTerms ?? <Missing /> },
  { key: "warranty", render: (o) => o.warrantyTerms ?? <Missing /> },
  { key: "expires", render: (o) => (o.expiresAt ? <span className={o.expired ? "text-danger" : undefined}>{formatDateTime(o.expiresAt)}</span> : <Missing />) },
];

function ProviderHead({ o }: { o: ComparableOffer }) {
  return (
    <div className="space-y-1">
      <p className="font-semibold text-ink">
        {o.providerSlug ? <a href={`/prestataires/${o.providerSlug}`} target="_blank" className="hover:underline" rel="noreferrer">{o.providerName}</a> : o.providerName}
      </p>
      {o.providerIsDemo ? <Badge tone="warn">{t("app.demoBadge")}</Badge> : null}
      <p className="flex items-center gap-1 text-xs text-muted">
        <Star aria-hidden className="size-3.5" />
        {o.rating.count ? t("provider.rating", { avg: (o.rating.avg ?? 0).toLocaleString("fr-MA", { maximumFractionDigits: 1 }), count: o.rating.count }) : t("provider.noReviews")}
      </p>
      {o.verifiedChecks.length ? (
        <p className="flex flex-wrap gap-1">
          {o.verifiedChecks.map((c) => <Badge key={c} tone="success" icon={BadgeCheck} wrap>{te("enums.checkType", c)}</Badge>)}
        </p>
      ) : null}
      <p className="text-xs text-muted">
        {t("customer.offers.version", { n: o.versionNo })}
        {o.previousVersions ? ` · ${t("customer.offers.revised", { n: o.previousVersions })}` : ""}
        {o.issuedAt ? ` · ${formatDateTime(o.issuedAt)}` : ""}
      </p>
    </div>
  );
}

function SelectOffer({ o, requestReference }: { o: ComparableOffer; requestReference: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idem = useIdempotencyKey();
  if (o.status !== "ISSUED" || o.expired) return <span className="text-xs text-muted">{o.expired ? t("customer.offers.expired") : te("status.offerVersion", o.status)}</span>;
  return (
    <>
      <Button onClick={() => setOpen(true)} className="w-full">{t("customer.offers.select")}</Button>
      <Dialog
        open={open}
        onClose={() => !pending && setOpen(false)}
        title={t("customer.offers.selectTitle")}
        description={t("customer.offers.selectIntro", { ref: requestReference })}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>{t("common.cancel")}</Button>
            <Button
              loading={pending}
              onClick={async () => {
                setPending(true);
                setError(null);
                try {
                  const res = await api<{ bookingId: string }>(`/api/v1/offer-versions/${o.versionId}/select`, { method: "POST", body: {}, idempotencyKey: idem.key() });
                  idem.renew();
                  router.push(`/client/rendez-vous/${res.bookingId}`);
                  router.refresh();
                } catch (e) {
                  setError(errorMessage(e));
                  setPending(false);
                }
              }}
            >
              {t("customer.offers.confirmSelect")}
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          <p>{t("customer.offers.selectSummary", { provider: o.providerName, version: o.versionNo, total: formatMoney(o.totalMinor, o.currency) })}</p>
          <p className="text-muted">{o.kind === "DIAGNOSTIC" ? t("customer.offers.repairAfterDiagnosis") : t("customer.offers.repairNotIncluded")}</p>
          {o.cancellationTerms ? <p><strong>{t("customer.offers.rows.cancellation")} :</strong> {o.cancellationTerms}</p> : null}
          <Alert tone="warn">{t("customer.offers.pendingNote")}</Alert>
          <FormError error={error} />
        </div>
      </Dialog>
    </>
  );
}

/**
 * Side-by-side comparison of the same price components. Wide table on desktop (labelled
 * scroll region), stacked cards on mobile. Missing information is shown explicitly.
 */
export function OfferComparison({ offers, canSelect, requestReference }: { offers: ComparableOffer[]; canSelect: boolean; requestReference: string }) {
  return (
    <div>
      <div role="region" aria-label={t("customer.offers.tableLabel")} tabIndex={0} className="hidden overflow-x-auto rounded-[var(--radius-card)] border border-line bg-surface md:block">
        <table className="w-full min-w-[720px] border-collapse text-left text-sm">
          <caption className="sr-only">{t("customer.offers.tableLabel")}</caption>
          <thead>
            <tr className="bg-subtle">
              <th scope="col" className="w-48 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted">{t("customer.offers.rows.provider")}</th>
              {offers.map((o) => (
                <th key={o.versionId} scope="col" className="px-4 py-3 align-top font-normal"><ProviderHead o={o} /></th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {ROWS.map((row) => (
              <tr key={row.key} className={cn(row.key === "total" && "bg-brand-soft/40")}>
                <th scope="row" className="px-4 py-3 align-top text-xs font-semibold uppercase tracking-wide text-muted">{t(`customer.offers.rows.${row.key}`)}</th>
                {offers.map((o) => <td key={o.versionId} className="px-4 py-3 align-top text-ink">{row.render(o)}</td>)}
              </tr>
            ))}
            {canSelect ? (
              <tr>
                <th scope="row" className="px-4 py-3" />
                {offers.map((o) => <td key={o.versionId} className="px-4 py-3"><SelectOffer o={o} requestReference={requestReference} /></td>)}
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <ul className="space-y-4 md:hidden">
        {offers.map((o) => (
          <li key={o.versionId} className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
            <ProviderHead o={o} />
            <dl className="mt-3 divide-y divide-line text-sm">
              {ROWS.map((row) => (
                <div key={row.key} className="grid grid-cols-[8.5rem_1fr] gap-2 py-2">
                  <dt className="text-xs font-semibold uppercase tracking-wide text-muted">{t(`customer.offers.rows.${row.key}`)}</dt>
                  <dd className="min-w-0 text-ink">{row.render(o)}</dd>
                </div>
              ))}
            </dl>
            {canSelect ? <div className="mt-3"><SelectOffer o={o} requestReference={requestReference} /></div> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
