import { CalendarClock } from "lucide-react";
import Link from "next/link";
import { t, te } from "@/lib/i18n";
import { formatDate } from "@/lib/time";
import type { listPlans } from "@/server/modules/maintenance";
import { PlanDecisionButtons } from "@/features/plan-actions";
import { Card, CardBody, CardHeader, DescriptionList } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { StatusBadge } from "./status-badge";

/** Maintenance plans for either party; recurring requests are created as drafts, never auto-booked. */
export function PlansView({ plans, side, canAct }: { plans: Awaited<ReturnType<typeof listPlans>>; side: "CUSTOMER" | "PROVIDER"; canAct: boolean }) {
  if (plans.length === 0) {
    return (
      <EmptyState icon={CalendarClock} title={t("plans.empty")}>
        {side === "CUSTOMER" ? t("plans.emptyCustomer") : t("plans.emptyProvider")}
      </EmptyState>
    );
  }
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {plans.map((p) => (
        <Card key={p.id}>
          <CardHeader title={p.title} description={`${p.equipment.label} · ${side === "CUSTOMER" ? p.providerName : p.customerName}`} actions={<StatusBadge domain="plan" status={p.status} />} />
          <CardBody className="space-y-4">
            <p className="whitespace-pre-line text-sm text-ink-soft">{p.scope}</p>
            <DescriptionList
              items={[
                { label: t("plans.interval"), value: t("plans.everyMonths", { n: p.intervalMonths }) },
                { label: t("plans.nextDue"), value: p.nextDueDate ? formatDate(p.nextDueDate) : formatDate(p.firstDueDate) },
                { label: t("plans.leadDays"), value: t("plans.days", { n: p.reminderLeadDays }) },
                { label: t("plans.consent"), value: p.consentedAt ? formatDate(p.consentedAt) : t("plans.noConsent") },
              ]}
            />
            {p.statusNote ? <p className="text-sm text-muted">{p.statusNote}</p> : null}
            {p.occurrences.length ? (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">{t("plans.occurrences")}</p>
                <ul className="mt-1 space-y-1 text-sm">
                  {p.occurrences.map((o) => (
                    <li key={o.id} className="flex flex-wrap justify-between gap-2">
                      <span>{formatDate(o.dueDate)}</span>
                      {o.draftRequestId && side === "CUSTOMER" ? (
                        <Link href={`/client/demandes/${o.draftRequestId}`} className="font-semibold text-brand hover:underline">
                          {t("plans.openDraft")}
                        </Link>
                      ) : (
                        <span className="text-muted">{te("enums.occurrenceStatus", o.status)}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {canAct ? <PlanDecisionButtons planId={p.id} status={p.status} side={side} /> : null}
          </CardBody>
        </Card>
      ))}
    </div>
  );
}
