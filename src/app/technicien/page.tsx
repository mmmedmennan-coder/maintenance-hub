import { ChevronRight, MapPin, Wrench } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { t, te } from "@/lib/i18n";
import { formatDate, formatDateTime, formatTime, localDateString } from "@/lib/time";
import { guard } from "@/server/auth/page-guard";
import { withActor } from "@/server/db/context";
import { listTechnicianJobs } from "@/server/modules/work";
import { StatusBadge } from "@/components/domain/status-badge";
import { Alert, EmptyState } from "@/components/ui/feedback";
import { PageHeader, Section } from "@/components/ui/layout";

export const metadata: Metadata = { title: t("technician.title") };

type Job = Awaited<ReturnType<typeof listTechnicianJobs>>["items"][number];

function JobCard({ job, showDate }: { job: Job; showDate?: boolean }) {
  return (
    <li>
      <Link href={`/technicien/interventions/${job.booking.id}`} className="flex items-center gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--shadow-card)] hover:border-brand">
        <div className="w-16 shrink-0 text-center">
          <p className="text-lg font-bold tabular-nums text-ink">{formatTime(job.booking.scheduledStart)}</p>
          {showDate ? <p className="text-xs text-muted">{formatDate(job.booking.scheduledStart)}</p> : null}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-ink">{job.site.name}</p>
          <p className="flex items-center gap-1 text-sm text-muted">
            <MapPin aria-hidden className="size-3.5 shrink-0" /> <span className="truncate">{job.site.addressLine}, {job.site.city}</span>
          </p>
          <p className="text-sm text-ink-soft">
            {job.equipment.label} · {te("enums.offerKind", job.kind)}
          </p>
          <div className="mt-1.5">
            <StatusBadge domain="workOrder" status={job.status} />
          </div>
        </div>
        <ChevronRight aria-hidden className="size-5 shrink-0 text-muted" />
      </Link>
    </li>
  );
}

/** Technician home: today's jobs first, then upcoming and recently completed ones. */
export default async function TechnicianHome() {
  const actor = await guard({ orgTypes: ["PROVIDER"], roles: ["technician"] });
  const [open, recent] = await withActor(actor, (tx) => Promise.all([listTechnicianJobs(tx, actor, "upcoming"), listTechnicianJobs(tx, actor, "recent")]));
  const today = localDateString(new Date());
  const todays = open.items.filter((j) => j.booking.scheduledStart && localDateString(j.booking.scheduledStart) <= today);
  const later = open.items.filter((j) => !j.booking.scheduledStart || localDateString(j.booking.scheduledStart) > today);
  return (
    <>
      <PageHeader title={t("technician.title")} description={t("technician.intro", { date: formatDate(new Date()) })} />
      {!open.technicianId ? <Alert tone="warn" className="mb-6">{t("technician.noProfile")}</Alert> : null}
      <div className="space-y-8">
        <Section title={t("technician.today")}>
          {todays.length === 0 ? (
            <EmptyState icon={Wrench} title={t("technician.noJobsToday")} />
          ) : (
            <ul className="space-y-3">
              {todays.map((j) => (
                <JobCard key={j.id} job={j} showDate={localDateString(j.booking.scheduledStart!) < today} />
              ))}
            </ul>
          )}
        </Section>
        <Section title={t("technician.upcoming")}>
          {later.length === 0 ? (
            <p className="text-sm text-muted">{t("technician.noUpcoming")}</p>
          ) : (
            <ul className="space-y-3">
              {later.map((j) => (
                <JobCard key={j.id} job={j} showDate />
              ))}
            </ul>
          )}
        </Section>
        <Section title={t("technician.recent")}>
          {recent.items.length === 0 ? (
            <p className="text-sm text-muted">{t("technician.noRecent")}</p>
          ) : (
            <ul className="divide-y divide-line rounded-[var(--radius-card)] border border-line bg-surface">
              {recent.items.slice(0, 10).map((j) => (
                <li key={j.id}>
                  <Link href={`/technicien/interventions/${j.booking.id}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm hover:bg-subtle">
                    <span>
                      <span className="font-medium">{j.site.name}</span> · {j.equipment.label}
                      <span className="block text-xs text-muted">{formatDateTime(j.booking.scheduledStart)} · {j.reference}</span>
                    </span>
                    <StatusBadge domain="workOrder" status={j.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </>
  );
}
