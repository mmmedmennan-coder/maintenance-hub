import type { ComponentProps, ReactNode } from "react";
import { cn } from "./cn";

export function Card({ className, ...props }: ComponentProps<"section">) {
  return <section className={cn("rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)]", className)} {...props} />;
}

export function CardHeader({ title, description, actions, className, as: As = "h2" }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; className?: string; as?: "h2" | "h3" }) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4", className)}>
      <div className="min-w-0">
        <As className="text-base font-semibold text-ink">{title}</As>
        {description ? <p className="mt-0.5 text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function CardBody({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("px-5 py-4", className)} {...props} />;
}

export function DescriptionList({ items, className, columns = 2 }: { items: { label: ReactNode; value: ReactNode; wide?: boolean }[]; className?: string; columns?: 1 | 2 | 3 }) {
  const grid = columns === 1 ? "" : columns === 2 ? "sm:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-3";
  return (
    <dl className={cn("grid grid-cols-1 gap-x-6 gap-y-4", grid, className)}>
      {items.map((item, i) => (
        <div key={i} className={cn("min-w-0", item.wide && "sm:col-span-2 lg:col-span-3")}>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted">{item.label}</dt>
          <dd className="mt-1 text-sm text-ink prose-plain">{item.value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}
