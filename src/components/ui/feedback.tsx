import { CircleCheck, Info, OctagonAlert, TriangleAlert, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "./cn";

export type Tone = "neutral" | "brand" | "warn" | "danger" | "success" | "info";

const badgeTones: Record<Tone, string> = {
  neutral: "bg-subtle text-ink-soft border-line",
  brand: "bg-brand-soft text-brand-ink border-[#b8ded7]",
  warn: "bg-warn-soft text-warn border-warn-line",
  danger: "bg-danger-soft text-danger border-danger-line",
  success: "bg-success-soft text-success border-success-line",
  info: "bg-info-soft text-info border-info-line",
};

/** Status is never conveyed by colour alone: every badge carries text (and optionally an icon). */
/** Status label with text (never colour alone). `wrap` lets long labels break instead of truncating. */
export function Badge({ tone = "neutral", icon: Icon, children, className, wrap = false }: { tone?: Tone; icon?: LucideIcon; children: ReactNode; className?: string; wrap?: boolean }) {
  return (
    <span className={cn("inline-flex max-w-full items-center gap-1 border px-2.5 py-0.5 text-xs font-semibold", wrap ? "rounded-lg" : "rounded-full", badgeTones[tone], className)}>
      {Icon ? <Icon aria-hidden className="size-3.5 shrink-0" /> : null}
      <span className={wrap ? "min-w-0 break-words" : "truncate"}>{children}</span>
    </span>
  );
}

const alertTones: Record<Exclude<Tone, "neutral" | "brand">, { box: string; icon: LucideIcon }> = {
  info: { box: "border-info-line bg-info-soft text-info", icon: Info },
  warn: { box: "border-warn-line bg-warn-soft text-warn", icon: TriangleAlert },
  danger: { box: "border-danger-line bg-danger-soft text-danger", icon: OctagonAlert },
  success: { box: "border-success-line bg-success-soft text-success", icon: CircleCheck },
};

export function Alert({
  tone = "info",
  title,
  children,
  className,
  live,
}: {
  tone?: "info" | "warn" | "danger" | "success";
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
  live?: boolean;
}) {
  const { box, icon: Icon } = alertTones[tone];
  return (
    <div role={live ? (tone === "danger" ? "alert" : "status") : undefined} className={cn("flex gap-3 rounded-lg border px-4 py-3 text-sm", box, className)}>
      <Icon aria-hidden className="mt-0.5 size-5 shrink-0" />
      <div className="min-w-0">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className={cn("text-ink-soft", title ? "mt-0.5" : "")}>{children}</div> : null}
      </div>
    </div>
  );
}

export function EmptyState({ icon: Icon, title, children, action }: { icon?: LucideIcon; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-[var(--radius-card)] border border-dashed border-line-strong bg-surface px-6 py-10 text-center">
      {Icon ? (
        <span className="grid size-12 place-items-center rounded-full bg-brand-soft text-brand">
          <Icon aria-hidden className="size-6" />
        </span>
      ) : null}
      <p className="text-base font-semibold text-ink">{title}</p>
      {children ? <div className="max-w-md text-sm text-muted">{children}</div> : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-md bg-line/70", className)} />;
}

export function PageSkeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-live="polite" className="space-y-4">
      <span className="sr-only">{label}</span>
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-4 w-96 max-w-full" />
      <div className="grid gap-4 md:grid-cols-3">
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
      <Skeleton className="h-64" />
    </div>
  );
}

export function Stat({ label, value, hint, icon: Icon, tone = "neutral" }: { label: ReactNode; value: ReactNode; hint?: ReactNode; icon?: LucideIcon; tone?: Tone }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--shadow-card)]">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-muted">{label}</p>
        {Icon ? <Icon aria-hidden className={cn("size-5", tone === "warn" ? "text-warn" : tone === "danger" ? "text-danger" : "text-brand")} /> : null}
      </div>
      <p className="mt-2 text-2xl font-bold tabular text-ink">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}
