import { BadgeCheck, MapPin, Star } from "lucide-react";
import Link from "next/link";
import { t, te } from "@/lib/i18n";
import { minutesToLabel } from "@/lib/time";
import { Badge } from "@/components/ui/feedback";

export type ProviderCardData = {
  slug: string;
  displayName: string;
  summary: string;
  city: string;
  isDemo: boolean;
  areas: string[];
  categories: string[];
  verifiedChecks: { type: string; isDemo: boolean }[];
  ratingAvg: number | null;
  reviewCount: number;
};

export function RatingLine({ avg, count }: { avg: number | null; count: number }) {
  if (!count || avg === null) return <p className="text-sm text-muted">{t("provider.noReviews")}</p>;
  return (
    <p className="flex items-center gap-1 text-sm text-ink-soft">
      <Star aria-hidden className="size-4 fill-current text-warn" />
      <span>{t("provider.rating", { avg: avg.toLocaleString("fr-MA", { maximumFractionDigits: 1 }), count })}</span>
    </p>
  );
}

export function ProviderCard({ p }: { p: ProviderCardData }) {
  const extra = p.categories.length - 3;
  return (
    <article className="flex flex-col rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[var(--shadow-card)]">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-lg font-semibold text-ink">
          <Link href={`/prestataires/${p.slug}`} className="hover:underline">
            {p.displayName}
          </Link>
        </h2>
        {p.isDemo ? <Badge tone="warn">{t("app.demoBadge")}</Badge> : null}
      </div>
      <p className="mt-1 flex items-center gap-1 text-sm text-muted">
        <MapPin aria-hidden className="size-4" />
        {p.city}
        {p.areas.length ? ` · ${p.areas.join(", ")}` : ""}
      </p>
      <p className="mt-3 text-sm text-ink-soft">{p.summary}</p>
      <ul className="mt-3 flex flex-wrap gap-1.5" aria-label={t("provider.categories")}>
        {p.categories.slice(0, 3).map((c) => (
          <li key={c}>
            <Badge>{c}</Badge>
          </li>
        ))}
        {extra > 0 ? (
          <li>
            <Badge>{t("provider.moreCategories", { n: extra })}</Badge>
          </li>
        ) : null}
      </ul>
      {p.verifiedChecks.length ? (
        <ul className="mt-3 flex flex-wrap gap-1.5" aria-label={t("provider.checks")}>
          {p.verifiedChecks.map((c) => (
            <li key={c.type}>
              <Badge tone="success" icon={BadgeCheck}>
                {te("enums.checkType", c.type)}
                {c.isDemo ? ` (${t("app.demoBadge").toLowerCase()})` : ""}
              </Badge>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-xs text-muted">{t("provider.noChecks")}</p>
      )}
      <div className="mt-auto flex items-center justify-between gap-3 pt-4">
        <RatingLine avg={p.ratingAvg} count={p.reviewCount} />
        <Link href={`/prestataires/${p.slug}`} className="text-sm font-semibold text-brand hover:underline">
          {t("provider.viewProfile")}
        </Link>
      </div>
    </article>
  );
}

export function ServiceHours({ hours }: { hours: Record<string, [number, number]> }) {
  return (
    <table className="w-full text-sm">
      <caption className="sr-only">{t("provider.serviceHours")}</caption>
      <tbody className="divide-y divide-line">
        {["1", "2", "3", "4", "5", "6", "7"].map((d) => {
          const h = hours[d];
          return (
            <tr key={d}>
              <th scope="row" className="py-1.5 pr-4 text-left font-medium text-ink-soft">
                {te("enums.weekday", d)}
              </th>
              <td className="py-1.5 tabular text-ink">{h ? `${minutesToLabel(h[0])} – ${minutesToLabel(h[1])}` : t("provider.closed")}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
