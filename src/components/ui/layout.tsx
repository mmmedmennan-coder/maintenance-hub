import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { t } from "@/lib/i18n";
import { cn } from "./cn";

export function PageHeader({
  title,
  description,
  actions,
  back,
  meta,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
  meta?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-col gap-3">
      {back ? (
        <Link href={back.href} className="inline-flex w-fit items-center gap-1 text-sm font-medium text-brand hover:underline">
          <ChevronLeft aria-hidden className="size-4" />
          {back.label}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-[1.75rem]">{title}</h1>
          {description ? <p className="mt-1 max-w-3xl text-sm text-muted sm:text-base">{description}</p> : null}
          {meta ? <div className="mt-2 flex flex-wrap items-center gap-2">{meta}</div> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}

/** Horizontal scroll region with an accessible label (for wide comparison tables). */
export function ScrollRegion({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div role="region" aria-label={label} tabIndex={0} className={cn("overflow-x-auto rounded-[var(--radius-card)] border border-line bg-surface", className)}>
      {children}
    </div>
  );
}

export function Table({ caption, head, children, className }: { caption: string; head: ReactNode; children: ReactNode; className?: string }) {
  return (
    <ScrollRegion label={caption} className={className}>
      <table className="w-full min-w-[640px] border-collapse text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-subtle text-xs font-semibold uppercase tracking-wide text-muted">{head}</thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </ScrollRegion>
  );
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <th scope="col" className={cn("px-4 py-3", className)}>
      {children}
    </th>
  );
}

export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return <td className={cn("px-4 py-3 align-top", className)}>{children}</td>;
}

export function Pagination({ page, pageSize, total, hrefFor }: { page: number; pageSize: number; total: number; hrefFor: (page: number) => string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <nav aria-label={t("common.pagination")} className="mt-4 flex items-center justify-between gap-3 text-sm">
      <p className="text-muted">{t("common.pageOf", { page, pages, total })}</p>
      <div className="flex gap-2">
        {page > 1 ? (
          <Link className="inline-flex h-9 items-center gap-1 rounded-lg border border-line-strong bg-surface px-3 font-medium hover:bg-subtle" href={hrefFor(page - 1)} rel="prev">
            <ChevronLeft aria-hidden className="size-4" /> {t("common.previous")}
          </Link>
        ) : null}
        {page < pages ? (
          <Link className="inline-flex h-9 items-center gap-1 rounded-lg border border-line-strong bg-surface px-3 font-medium hover:bg-subtle" href={hrefFor(page + 1)} rel="next">
            {t("common.next")} <ChevronRight aria-hidden className="size-4" />
          </Link>
        ) : null}
      </div>
    </nav>
  );
}

export function Section({ title, description, actions, children, className }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("space-y-3", className)}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-ink">{title}</h2>
          {description ? <p className="text-sm text-muted">{description}</p> : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}
