import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { t, te } from "@/lib/i18n";
import { addDaysToDateString, formatCalendarDate, formatTime, isoWeekday, localDateString, minutesToLabel } from "@/lib/time";
import type { getCalendar } from "@/server/modules/technicians";
import { cn } from "@/components/ui/cn";
import { StatusBadge } from "./status-badge";

type Calendar = Awaited<ReturnType<typeof getCalendar>>;

/** Monday (YYYY-MM-DD, Casablanca) of the week containing `date`, or of the requested week. */
export function weekStart(requested?: string): string {
  const today = localDateString(new Date());
  const base = requested && /^\d{4}-\d{2}-\d{2}$/.test(requested) ? requested : today;
  const weekday = isoWeekday(new Date(`${base}T12:00:00Z`), "UTC");
  return addDaysToDateString(base, 1 - weekday);
}

/**
 * Week planning per technician: declared availability, time off and active reservations
 * (buffers shown). The database exclusion constraint remains the source of truth for overlaps.
 */
export function WeekCalendar({ data, week, basePath, bookingBase }: { data: Calendar; week: string; basePath: string; bookingBase: string }) {
  const days = Array.from({ length: 7 }, (_, i) => addDaysToDateString(week, i));
  const today = localDateString(new Date());
  return (
    <div className="space-y-4">
      <nav aria-label={t("calendar.weekNav")} className="flex flex-wrap items-center justify-between gap-2">
        <Link href={`${basePath}?semaine=${addDaysToDateString(week, -7)}`} className="inline-flex h-9 items-center gap-1 rounded-lg border border-line-strong bg-surface px-3 text-sm font-medium hover:bg-subtle">
          <ChevronLeft aria-hidden className="size-4" /> {t("calendar.previous")}
        </Link>
        <p className="text-sm font-semibold">{t("calendar.weekOf", { from: formatCalendarDate(days[0]!), to: formatCalendarDate(days[6]!) })}</p>
        <div className="flex gap-2">
          <Link href={basePath} className="inline-flex h-9 items-center rounded-lg border border-line-strong bg-surface px-3 text-sm font-medium hover:bg-subtle">
            {t("calendar.today")}
          </Link>
          <Link href={`${basePath}?semaine=${addDaysToDateString(week, 7)}`} className="inline-flex h-9 items-center gap-1 rounded-lg border border-line-strong bg-surface px-3 text-sm font-medium hover:bg-subtle">
            {t("calendar.next")} <ChevronRight aria-hidden className="size-4" />
          </Link>
        </div>
      </nav>
      {data.technicians.length === 0 ? <p className="text-sm text-muted">{t("calendar.noTechnicians")}</p> : null}
      {data.technicians.map((tech) => {
        const reservations = data.reservations.filter((r) => r.technicianId === tech.id);
        return (
          <section key={tech.id} className="rounded-[var(--radius-card)] border border-line bg-surface">
            <h2 className="border-b border-line px-4 py-3 font-semibold">{tech.displayName}</h2>
            <ol className="grid grid-cols-1 divide-y divide-line md:grid-cols-7 md:divide-x md:divide-y-0">
              {days.map((day, i) => {
                const weekday = i + 1;
                const windows = tech.windows.filter((w) => w.weekday === weekday);
                const dayRes = reservations.filter((r) => localDateString(r.startsAt) === day);
                const off = tech.timeOff.filter((o) => localDateString(o.startsAt) <= day && localDateString(o.endsAt) >= day);
                return (
                  <li key={day} className={cn("min-h-28 space-y-2 p-2", day === today && "bg-brand-soft/50")}>
                    <p className="text-xs font-semibold uppercase text-muted">
                      {te("enums.weekdayShort", String(weekday))} {day.slice(8)}/{day.slice(5, 7)}
                    </p>
                    {windows.length ? (
                      <p className="text-[11px] text-muted">{windows.map((w) => `${minutesToLabel(w.startMinute)}–${minutesToLabel(w.endMinute)}`).join(", ")}</p>
                    ) : (
                      <p className="text-[11px] text-muted">{t("calendar.unavailable")}</p>
                    )}
                    {off.map((o) => (
                      <p key={o.id} className="rounded bg-warn-soft px-1.5 py-1 text-[11px] text-warn">
                        {t("calendar.timeOff")} {o.reason ? `· ${o.reason}` : ""}
                      </p>
                    ))}
                    {dayRes.map((r) => (
                      <Link key={r.id} href={`${bookingBase}/${r.booking.id}`} className="block rounded-md border border-brand/40 bg-brand-soft p-1.5 text-xs hover:border-brand">
                        <span className="font-semibold">
                          {formatTime(r.startsAt)}–{formatTime(r.endsAt)}
                        </span>
                        <span className="block truncate">{r.booking.site.name}</span>
                        <span className="block text-[11px] text-muted">
                          {r.booking.reference} · {t("calendar.buffers", { before: r.bufferBeforeMin, after: r.bufferAfterMin })}
                        </span>
                        {r.booking.workOrder ? (
                          <span className="mt-1 block">
                            <StatusBadge domain="workOrder" status={r.booking.workOrder.status} />
                          </span>
                        ) : null}
                      </Link>
                    ))}
                  </li>
                );
              })}
            </ol>
          </section>
        );
      })}
    </div>
  );
}
