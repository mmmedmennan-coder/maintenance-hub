"use client";

import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from "react";
import { ApiError, newIdempotencyKey } from "@/lib/api-client";
import { t } from "@/lib/i18n";
import { Button } from "./button";
import { cn } from "./cn";
import { Field, FormError, Textarea } from "./field";

/** Modal dialog built on <dialog>: focus is contained, Escape closes, focus returns to the trigger. */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "md" | "lg";
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClose={() => open && onClose()}
      className={cn(
        "m-auto w-[calc(100%-1.5rem)] rounded-[var(--radius-card)] border border-line bg-surface p-0 text-ink shadow-[var(--shadow-pop)]",
        size === "lg" ? "max-w-2xl" : "max-w-lg",
      )}
    >
      {open ? (
        <div className="flex max-h-[85vh] flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div>
              <h2 id={titleId} className="text-lg font-semibold">
                {title}
              </h2>
              {description ? (
                <p id={descId} className="mt-1 text-sm text-muted">
                  {description}
                </p>
              ) : null}
            </div>
            <button type="button" onClick={onClose} className="rounded-md p-1 text-muted hover:bg-subtle" aria-label={t("common.close")}>
              <X aria-hidden className="size-5" />
            </button>
          </div>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
          {footer ? <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</div> : null}
        </div>
      ) : null}
    </dialog>
  );
}

export function errorMessage(error: unknown) {
  if (error instanceof ApiError) return error.message;
  return t("errors.generic");
}

/**
 * Runs an async mutation: tracks pending/error, never reports success before the server
 * confirmed, and refreshes server data afterwards.
 */
export function useAction() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]> | undefined>();
  const run = useCallback(
    async <T,>(fn: () => Promise<T>, opts: { refresh?: boolean } = {}): Promise<T | undefined> => {
      setPending(true);
      setError(null);
      setFieldErrors(undefined);
      try {
        const result = await fn();
        if (opts.refresh !== false) router.refresh();
        return result;
      } catch (e) {
        setError(errorMessage(e));
        if (e instanceof ApiError) setFieldErrors(e.fields);
        return undefined;
      } finally {
        setPending(false);
      }
    },
    [router],
  );
  return { run, pending, error, fieldErrors, setError };
}

/** Stable idempotency key for one logical submission; renew after a confirmed success. */
export function useIdempotencyKey() {
  const ref = useRef<string>("");
  if (!ref.current) ref.current = newIdempotencyKey();
  return { key: () => ref.current, renew: () => (ref.current = newIdempotencyKey()) };
}

/**
 * Confirmation dialog for a single mutation, optionally collecting a reason. The dialog stays
 * open with the typed text on failure; it closes only after the server confirmed.
 */
export function ActionDialog({
  triggerLabel,
  triggerVariant = "secondary",
  triggerIcon,
  triggerSize = "md",
  title,
  description,
  confirmLabel,
  confirmVariant = "primary",
  reason,
  children,
  onConfirm,
  disabled,
}: {
  triggerLabel: ReactNode;
  triggerVariant?: "primary" | "secondary" | "ghost" | "danger" | "subtle";
  triggerIcon?: ReactNode;
  triggerSize?: "sm" | "md" | "lg";
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: ReactNode;
  confirmVariant?: "primary" | "danger";
  reason?: { label: string; required?: boolean; hint?: string; placeholder?: string };
  children?: ReactNode;
  onConfirm: (reason: string, idempotencyKey: string) => Promise<unknown>;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const { run, pending, error } = useAction();
  const idem = useIdempotencyKey();
  const submit = async () => {
    setLocalError(null);
    if (reason?.required && text.trim().length < 3) {
      setLocalError(t("common.reasonRequired"));
      return;
    }
    const ok = await run(async () => {
      await onConfirm(text.trim(), idem.key());
      return true;
    });
    if (ok) {
      idem.renew();
      setText("");
      setOpen(false);
    }
  };
  return (
    <>
      <Button variant={triggerVariant} size={triggerSize} icon={triggerIcon} onClick={() => setOpen(true)} disabled={disabled}>
        {triggerLabel}
      </Button>
      <Dialog
        open={open}
        onClose={() => !pending && setOpen(false)}
        title={title}
        description={description}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
              {t("common.cancel")}
            </Button>
            <Button variant={confirmVariant} onClick={submit} loading={pending}>
              {confirmLabel}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {children}
          {reason ? (
            <Field label={reason.label} required={reason.required} hint={reason.hint} error={localError}>
              <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={reason.placeholder} rows={3} maxLength={500} />
            </Field>
          ) : null}
          <FormError error={error} />
        </div>
      </Dialog>
    </>
  );
}

/** Immediate action button (no dialog) with inline error. */
export function ActionButton({
  children,
  onRun,
  variant = "primary",
  size = "md",
  icon,
  className,
}: {
  children: ReactNode;
  onRun: (idempotencyKey: string) => Promise<unknown>;
  variant?: "primary" | "secondary" | "ghost" | "danger" | "subtle";
  size?: "sm" | "md" | "lg";
  icon?: ReactNode;
  className?: string;
}) {
  const { run, pending, error } = useAction();
  const idem = useIdempotencyKey();
  return (
    <div className={cn("flex flex-col items-start gap-2", className)}>
      <Button
        variant={variant}
        size={size}
        icon={icon}
        loading={pending}
        onClick={async () => {
          const ok = await run(async () => {
            await onRun(idem.key());
            return true;
          });
          if (ok) idem.renew();
        }}
      >
        {children}
      </Button>
      {error ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
