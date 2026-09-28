"use client";

import { type ComponentProps, type ReactNode, createContext, forwardRef, useContext, useId } from "react";
import { cn } from "./cn";

type FieldCtx = { id: string; describedBy?: string; invalid: boolean; required?: boolean };
const FieldContext = createContext<FieldCtx | null>(null);

function useFieldProps(props: { id?: string; "aria-describedby"?: string; "aria-invalid"?: ComponentProps<"input">["aria-invalid"] }) {
  const ctx = useContext(FieldContext);
  return {
    id: props.id ?? ctx?.id,
    "aria-describedby": [props["aria-describedby"], ctx?.describedBy].filter(Boolean).join(" ") || undefined,
    "aria-invalid": props["aria-invalid"] ?? (ctx?.invalid ? true : undefined),
    "aria-required": ctx?.required || undefined,
  };
}

/** Label + control + hint + error, wired with aria-describedby / aria-invalid. */
export function Field({
  label,
  hint,
  error,
  required,
  children,
  className,
  id: idProp,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  const auto = useId();
  const id = idProp ?? `f${auto.replace(/:/g, "")}`;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <FieldContext.Provider value={{ id, describedBy: [hintId, errorId].filter(Boolean).join(" ") || undefined, invalid: !!error, required }}>
      <div className={cn("flex flex-col gap-1.5", className)}>
        <label htmlFor={id} className="text-sm font-semibold text-ink">
          {label}
          {required ? (
            <span className="text-danger" aria-hidden>
              {" "}*
            </span>
          ) : null}
        </label>
        {children}
        {hint ? (
          <p id={hintId} className="text-xs text-muted">
            {hint}
          </p>
        ) : null}
        {error ? (
          <p id={errorId} className="text-sm font-medium text-danger" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </FieldContext.Provider>
  );
}

const control =
  "w-full rounded-lg border border-line-strong bg-surface px-3 text-[15px] text-ink placeholder:text-muted/80 focus:border-brand focus:outline-none focus-visible:ring-0 aria-[invalid=true]:border-danger disabled:bg-subtle disabled:text-muted";

export const Input = forwardRef<HTMLInputElement, ComponentProps<"input">>(function Input({ className, ...props }, ref) {
  const a11y = useFieldProps(props);
  return <input ref={ref} {...props} {...a11y} className={cn(control, "h-11", className)} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, ComponentProps<"textarea">>(function Textarea({ className, rows = 4, ...props }, ref) {
  const a11y = useFieldProps(props);
  return <textarea ref={ref} rows={rows} {...props} {...a11y} className={cn(control, "py-2.5 leading-relaxed", className)} />;
});

export const Select = forwardRef<HTMLSelectElement, ComponentProps<"select">>(function Select({ className, children, ...props }, ref) {
  const a11y = useFieldProps(props);
  return (
    <select ref={ref} {...props} {...a11y} className={cn(control, "h-11 pr-8", className)}>
      {children}
    </select>
  );
});

export function Checkbox({ label, hint, className, ...props }: ComponentProps<"input"> & { label: ReactNode; hint?: ReactNode }) {
  const id = useId();
  return (
    <div className={cn("flex items-start gap-3", className)}>
      <input id={id} type="checkbox" className="mt-0.5 size-5 shrink-0 rounded border-line-strong accent-[var(--color-brand)]" {...props} />
      <label htmlFor={id} className="text-sm text-ink">
        {label}
        {hint ? <span className="block text-xs text-muted">{hint}</span> : null}
      </label>
    </div>
  );
}

/** Form-level error summary (server or network error). Keeps user input untouched. */
export function FormError({ error }: { error?: string | null }) {
  if (!error) return null;
  return (
    <div role="alert" className="rounded-lg border border-danger-line bg-danger-soft px-4 py-3 text-sm font-medium text-danger">
      {error}
    </div>
  );
}
