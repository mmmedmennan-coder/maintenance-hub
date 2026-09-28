import { INTL_LOCALE } from "./i18n";

/**
 * All instants are stored in UTC. Business rules and display use the service-area
 * time zone (Africa/Casablanca). Morocco changes its UTC offset around Ramadan, so
 * conversions always go through the IANA database (Intl), never a fixed offset.
 */
export const TIMEZONE = "Africa/Casablanca";

type Parts = { year: number; month: number; day: number; hour: number; minute: number; second: number; weekday: number };

const partsFormatterCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(tz: string) {
  let f = partsFormatterCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    });
    partsFormatterCache.set(tz, f);
  }
  return f;
}

const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

export function zonedParts(date: Date, tz = TIMEZONE): Parts {
  const out: Record<string, string> = {};
  for (const p of partsFormatter(tz).formatToParts(date)) out[p.type] = p.value;
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    hour: Number(out.hour),
    minute: Number(out.minute),
    second: Number(out.second),
    weekday: WEEKDAYS[out.weekday ?? "Mon"] ?? 1,
  };
}

/** Offset of `tz` from UTC at `date`, in minutes (e.g. +60 for UTC+1). */
export function tzOffsetMinutes(date: Date, tz = TIMEZONE): number {
  const p = zonedParts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

/**
 * Converts a local wall-clock time ("2026-10-02", "09:30") in `tz` to a UTC instant.
 * Throws for malformed input. Non-existent local times (spring-forward gaps) resolve
 * forward; ambiguous ones resolve to the earlier instant.
 */
export function localToUtc(dateStr: string, timeStr: string, tz = TIMEZONE): Date {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  const tm = /^(\d{2}):(\d{2})$/.exec(timeStr);
  if (!d || !tm) throw new RangeError("invalid local date/time");
  const [y, mo, da] = [Number(d[1]), Number(d[2]), Number(d[3])];
  const [h, mi] = [Number(tm[1]), Number(tm[2])];
  if (mo < 1 || mo > 12 || da < 1 || da > 31 || h > 23 || mi > 59) throw new RangeError("invalid local date/time");
  const naive = Date.UTC(y, mo - 1, da, h, mi);
  // Two passes converge on the offset valid at the resulting instant.
  const first = naive - tzOffsetMinutes(new Date(naive), tz) * 60000;
  return new Date(naive - tzOffsetMinutes(new Date(first), tz) * 60000);
}

/** YYYY-MM-DD of the instant in `tz`. */
export function localDateString(date: Date, tz = TIMEZONE): string {
  const p = zonedParts(date, tz);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** HH:MM of the instant in `tz`. */
export function localTimeString(date: Date, tz = TIMEZONE): string {
  const p = zonedParts(date, tz);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

export function minutesOfDay(date: Date, tz = TIMEZONE): number {
  const p = zonedParts(date, tz);
  return p.hour * 60 + p.minute;
}

/** ISO weekday (1 = Monday) in `tz`. */
export function isoWeekday(date: Date, tz = TIMEZONE): number {
  return zonedParts(date, tz).weekday;
}

/** Adds whole days to a YYYY-MM-DD string (calendar arithmetic, no time zone). */
export function addDaysToDateString(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/** Adds calendar months to a YYYY-MM-DD string, clamping to the month's last day. */
export function addMonthsToDateString(dateStr: string, months: number): string {
  const [y, m, d] = dateStr.split("-").map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

/** A `date` column value (UTC midnight) → YYYY-MM-DD. */
export function dateOnlyString(date: Date | null | undefined): string | null {
  return date ? date.toISOString().slice(0, 10) : null;
}

/** YYYY-MM-DD → Date at UTC midnight (for Prisma `@db.Date`). */
export function dateOnly(dateStr: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) throw new RangeError("invalid date");
  return new Date(`${dateStr}T00:00:00.000Z`);
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(key: string, options: Intl.DateTimeFormatOptions) {
  let f = fmtCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(INTL_LOCALE, { timeZone: TIMEZONE, ...options });
    fmtCache.set(key, f);
  }
  return f;
}

export function formatDateTime(date: Date | string | null | undefined): string {
  if (!date) return "—";
  return fmt("dt", { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(date));
}

export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "—";
  return fmt("d", { weekday: "short", day: "numeric", month: "short", year: "numeric" }).format(new Date(date));
}

/** For `date` columns (no time zone shift). */
export function formatCalendarDate(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(`${date.slice(0, 10)}T12:00:00Z`) : new Date(date.getTime() + 12 * 3600_000);
  return new Intl.DateTimeFormat(INTL_LOCALE, { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" }).format(d);
}

export function formatTime(date: Date | string | null | undefined): string {
  if (!date) return "—";
  return fmt("t", { hour: "2-digit", minute: "2-digit" }).format(new Date(date));
}

/** "mar. 30 sept. 2026, 09:00 – 11:00" (same day) or two full date-times. */
export function formatWindow(start: Date | string | null | undefined, end: Date | string | null | undefined): string {
  if (!start || !end) return "—";
  const s = new Date(start);
  const e = new Date(end);
  if (localDateString(s) === localDateString(e)) return `${formatDate(s)}, ${formatTime(s)} – ${formatTime(e)}`;
  return `${formatDateTime(s)} – ${formatDateTime(e)}`;
}

export function minutesToLabel(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export function durationLabel(minutes: number | null | undefined): string {
  if (!minutes) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, "0")}`;
}
