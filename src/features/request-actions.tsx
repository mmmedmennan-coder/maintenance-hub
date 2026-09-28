"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Send, Trash, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { z } from "zod";
import { api } from "@/lib/api-client";
import { t, te } from "@/lib/i18n";
import { windowInput } from "@/lib/schemas";
import { Button } from "@/components/ui/button";
import { ActionButton, ActionDialog, errorMessage, useAction } from "@/components/ui/dialog";
import { Alert, Badge } from "@/components/ui/feedback";
import { Field, FormError, Input, Textarea } from "@/components/ui/field";

export function SubmitRequestButton({ id, disabledReason }: { id: string; disabledReason?: string | null }) {
  if (disabledReason) return <Alert tone="warn">{disabledReason}</Alert>;
  return (
    <ActionButton icon={<Send aria-hidden className="size-4" />} onRun={() => api(`/api/v1/requests/${id}/submit`, { method: "POST", body: {} })}>
      {t("customer.requestDetail.submit")}
    </ActionButton>
  );
}

export function CancelRequestButton({ id }: { id: string }) {
  return (
    <ActionDialog
      triggerLabel={t("customer.requestDetail.cancel")}
      triggerVariant="ghost"
      title={t("customer.requestDetail.cancelTitle")}
      description={t("customer.requestDetail.cancelBody")}
      confirmLabel={t("customer.requestDetail.cancelConfirm")}
      confirmVariant="danger"
      reason={{ label: t("customer.requestDetail.cancelReason"), required: true }}
      onConfirm={(reason) => api(`/api/v1/requests/${id}/cancel`, { body: { reason } })}
    />
  );
}

export function ReopenRequestButton({ id }: { id: string }) {
  return (
    <ActionButton onRun={() => api(`/api/v1/requests/${id}/reopen`, { method: "POST", body: {} })}>{t("customer.requestDetail.reopen")}</ActionButton>
  );
}

export function RevokeInvitationButton({ id }: { id: string }) {
  return (
    <ActionDialog
      triggerLabel={t("customer.requestDetail.revoke")}
      triggerVariant="ghost"
      triggerSize="sm"
      title={t("customer.requestDetail.revokeTitle")}
      description={t("customer.requestDetail.revokeBody")}
      confirmLabel={t("customer.requestDetail.revoke")}
      confirmVariant="danger"
      onConfirm={() => api(`/api/v1/request-invitations/${id}/revoke`, { method: "POST", body: {} })}
    />
  );
}

export type EligibleProvider = { providerOrgId: string; displayName: string; summary: string; city: string; isDemo: boolean; checks: string[]; slug: string };

/** Customer (or routing admin) invites up to N eligible providers; each receives only a limited brief. */
export function InviteProviders({
  requestId,
  providers,
  remaining,
  preselect,
  endpoint,
}: {
  requestId: string;
  providers: EligibleProvider[];
  remaining: number;
  preselect?: string;
  endpoint?: "customer" | "admin";
}) {
  const [selected, setSelected] = useState<string[]>(preselect && providers.some((p) => p.providerOrgId === preselect) ? [preselect] : []);
  const { run, pending, error } = useAction();
  if (remaining <= 0) return <p className="text-sm text-muted">{t("customer.requestDetail.inviteLimit")}</p>;
  if (providers.length === 0) return <Alert tone="info">{t("customer.requestDetail.noEligible")}</Alert>;
  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : endpoint === "admin" ? [id] : s.length < remaining ? [...s, id] : s));
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">{endpoint === "admin" ? t("admin.routing.pickOne") : t("customer.requestDetail.inviteHint", { n: remaining })}</p>
      <ul className="grid gap-2 md:grid-cols-2">
        {providers.map((p) => {
          const checked = selected.includes(p.providerOrgId);
          const disabled = !checked && (endpoint === "admin" ? false : selected.length >= remaining);
          return (
            <li key={p.providerOrgId}>
              <label className={`flex h-full cursor-pointer gap-3 rounded-lg border p-3 ${checked ? "border-brand bg-brand-soft" : "border-line-strong"} ${disabled ? "opacity-60" : ""}`}>
                <input type="checkbox" checked={checked} disabled={disabled} onChange={() => toggle(p.providerOrgId)} className="mt-1 size-4 accent-[var(--color-brand)]" />
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-1 font-semibold text-ink">
                    {p.displayName} {p.isDemo ? <Badge tone="warn">{t("app.demoBadge")}</Badge> : null}
                  </span>
                  <span className="block text-xs text-muted">{p.city} · {p.summary}</span>
                  {p.checks.length ? <span className="mt-1 block text-xs text-success">{p.checks.map((c) => te("enums.checkType", c)).join(" · ")}</span> : null}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      <FormError error={error} />
      <Button
        icon={<UserPlus aria-hidden className="size-4" />}
        disabled={selected.length === 0}
        loading={pending}
        onClick={async () => {
          const ok = await run(() =>
            endpoint === "admin"
              ? api(`/api/v1/admin/requests/${requestId}/route`, { body: { providerOrgId: selected[0], note: null } })
              : api(`/api/v1/requests/${requestId}/invite`, { body: { providerOrgIds: selected } }),
          );
          if (ok !== undefined) setSelected([]);
        }}
      >
        {endpoint === "admin" ? t("admin.routing.route") : t("customer.requestDetail.invite", { n: selected.length })}
      </Button>
    </div>
  );
}

const draftEditSchema = z.object({
  title: z.string().trim().min(5, "5 caractères minimum.").max(120),
  symptoms: z.string().trim().min(10, "10 caractères minimum.").max(3000),
  preferredWindows: z.array(windowInput).min(1).max(3),
});

export function DraftEditForm({
  id,
  version,
  initial,
  tomorrow,
}: {
  id: string;
  version: number;
  initial: z.input<typeof draftEditSchema>;
  tomorrow: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const form = useForm<z.input<typeof draftEditSchema>>({ resolver: zodResolver(draftEditSchema), defaultValues: initial });
  const windows = useFieldArray({ control: form.control, name: "preferredWindows" });
  const { errors, isSubmitting } = form.formState;
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={form.handleSubmit(async (values) => {
        setError(null);
        setSaved(false);
        try {
          await api(`/api/v1/requests/${id}`, { method: "PATCH", body: { ...values, version } });
          setSaved(true);
          router.refresh();
        } catch (e) {
          setError(errorMessage(e));
        }
      })}
    >
      <Field label={t("customer.wizard.title")} error={errors.title?.message} required>
        <Input {...form.register("title")} />
      </Field>
      <Field label={t("customer.wizard.symptoms")} error={errors.symptoms?.message} required>
        <Textarea rows={4} {...form.register("symptoms")} />
      </Field>
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">{t("customer.wizard.windowsTitle")}</legend>
        {windows.fields.map((f, i) => (
          <div key={f.id} className="grid items-end gap-2 sm:grid-cols-[1.3fr_1fr_1fr_auto]">
            <Field label={t("customer.wizard.date")} error={errors.preferredWindows?.[i]?.date?.message}>
              <Input type="date" min={tomorrow} {...form.register(`preferredWindows.${i}.date`)} />
            </Field>
            <Field label={t("customer.wizard.from")} error={errors.preferredWindows?.[i]?.start?.message}>
              <Input type="time" step={900} {...form.register(`preferredWindows.${i}.start`)} />
            </Field>
            <Field label={t("customer.wizard.to")} error={errors.preferredWindows?.[i]?.end?.message}>
              <Input type="time" step={900} {...form.register(`preferredWindows.${i}.end`)} />
            </Field>
            <Button variant="ghost" size="sm" disabled={windows.fields.length === 1} onClick={() => windows.remove(i)} aria-label={t("customer.wizard.removeWindow", { n: i + 1 })} icon={<Trash aria-hidden className="size-4" />} />
          </div>
        ))}
        {windows.fields.length < 3 ? (
          <Button variant="secondary" size="sm" icon={<Plus aria-hidden className="size-4" />} onClick={() => windows.append({ date: tomorrow, start: "09:00", end: "12:00" })}>
            {t("customer.wizard.addWindow")}
          </Button>
        ) : null}
      </fieldset>
      <FormError error={error} />
      {saved ? <Alert tone="success" live>{t("common.saved")}</Alert> : null}
      <Button type="submit" variant="secondary" loading={isSubmitting}>{t("common.save")}</Button>
    </form>
  );
}
