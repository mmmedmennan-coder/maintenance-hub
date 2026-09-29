import { SearchX } from "lucide-react";
import type { Metadata } from "next";
import { t, te } from "@/lib/i18n";
import { AVAILABILITY_SEARCH_DAYS, availabilityDateRange, availabilitySearchDate } from "@/lib/schemas";
import { formatCalendarDate } from "@/lib/time";
import { withPublic } from "@/server/db/context";
import { searchProviders } from "@/server/modules/providers";
import { listEquipmentCategories, listServiceAreas } from "@/server/modules/reference";
import { ProviderCard } from "@/components/domain/provider-card";
import { Button, ButtonLink } from "@/components/ui/button";
import { Alert, EmptyState } from "@/components/ui/feedback";
import { Pagination } from "@/components/ui/layout";

export const metadata: Metadata = { title: t("public.directory.title") };

type Search = { q?: string; city?: string; category?: string; day?: string; date?: string; page?: string };

export default async function DirectoryPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const weekday = sp.day && /^[1-7]$/.test(sp.day) ? Number(sp.day) : undefined;
  const dateCheck = sp.date ? availabilitySearchDate.safeParse(sp.date) : null;
  const date = dateCheck?.success ? dateCheck.data : undefined;
  const dateRange = availabilityDateRange();
  const [categories, areas, results] = await withPublic(async (tx) =>
    Promise.all([
      listEquipmentCategories(tx),
      listServiceAreas(tx),
      searchProviders(tx, {
        q: sp.q?.slice(0, 80),
        city: sp.city?.slice(0, 80),
        categoryId: sp.category && /^[0-9a-f-]{36}$/.test(sp.category) ? sp.category : undefined,
        weekday,
        date,
        page,
      }),
    ]),
  );
  const cities = [...new Set(areas.flatMap((a) => a.cities))].sort((a, b) => a.localeCompare(b, "fr"));
  const params = new URLSearchParams(Object.entries(sp).filter(([k, v]) => k !== "page" && v) as [string, string][]);
  const hasFilters = params.toString().length > 0;
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-bold tracking-tight text-ink">{t("public.directory.title")}</h1>
      <p className="mt-2 max-w-3xl text-ink-soft">{t("public.directory.intro")}</p>

      <form method="get" className="mt-6 grid grid-cols-1 gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4 sm:grid-cols-2 lg:grid-cols-3" role="search">
        <div className="flex flex-col gap-1">
          <label htmlFor="q" className="text-sm font-semibold">
            {t("public.directory.search")}
          </label>
          <input id="q" name="q" defaultValue={sp.q ?? ""} className="h-11 rounded-lg border border-line-strong px-3" placeholder={t("public.directory.searchPlaceholder")} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="city" className="text-sm font-semibold">
            {t("public.directory.city")}
          </label>
          <select id="city" name="city" defaultValue={sp.city ?? ""} className="h-11 rounded-lg border border-line-strong bg-surface px-2">
            <option value="">{t("public.directory.allCities")}</option>
            {cities.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="category" className="text-sm font-semibold">
            {t("public.directory.category")}
          </label>
          <select id="category" name="category" defaultValue={sp.category ?? ""} className="h-11 rounded-lg border border-line-strong bg-surface px-2">
            <option value="">{t("public.directory.allCategories")}</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.labelFr}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="day" className="text-sm font-semibold">
            {t("public.directory.openOn")}
          </label>
          <select id="day" name="day" defaultValue={sp.day ?? ""} className="h-11 rounded-lg border border-line-strong bg-surface px-2">
            <option value="">{t("public.directory.anyDay")}</option>
            {["1", "2", "3", "4", "5", "6", "7"].map((d) => (
              <option key={d} value={d}>
                {te("enums.weekday", d)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="date" className="text-sm font-semibold">
            {t("public.directory.availableOn")}
          </label>
          <input
            id="date"
            name="date"
            type="date"
            min={dateRange.min}
            max={dateRange.max}
            defaultValue={date ?? ""}
            aria-describedby="date-hint"
            className="h-11 rounded-lg border border-line-strong bg-surface px-3"
          />
          <p id="date-hint" className="text-xs text-muted">
            {t("public.directory.availableOnHint")}
          </p>
        </div>
        <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-3 lg:justify-end">
          <Button type="submit" className="w-full sm:w-auto">
            {t("public.directory.filter")}
          </Button>
          {hasFilters ? (
            <ButtonLink href="/prestataires" variant="ghost">
              {t("public.directory.reset")}
            </ButtonLink>
          ) : null}
        </div>
      </form>

      {dateCheck && !dateCheck.success ? (
        <div className="mt-4">
          <Alert tone="warn">{t("public.directory.availableOnInvalid", { days: AVAILABILITY_SEARCH_DAYS })}</Alert>
        </div>
      ) : null}
      {date ? <p className="mt-4 text-sm text-ink-soft">{t("public.directory.availableOnActive", { date: formatCalendarDate(date) })}</p> : null}

      <p className="mt-4 text-sm text-muted" aria-live="polite">
        {t("public.directory.count", { count: results.total })} · {t("public.directory.availabilityNote")}
      </p>

      {results.items.length === 0 ? (
        <div className="mt-6">
          <EmptyState icon={SearchX} title={t("public.directory.emptyTitle")}>
            {hasFilters ? t("public.directory.emptyFiltered") : t("public.directory.emptyAll")}
          </EmptyState>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {results.items.map((p) => (
            <ProviderCard key={p.id} p={p} />
          ))}
        </div>
      )}
      <Pagination
        page={results.page}
        pageSize={results.pageSize}
        total={results.total}
        hrefFor={(n) => {
          const next = new URLSearchParams(params);
          next.set("page", String(n));
          return `/prestataires?${next.toString()}`;
        }}
      />
    </div>
  );
}
