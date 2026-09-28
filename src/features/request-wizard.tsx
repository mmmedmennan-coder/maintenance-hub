"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Trash } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import type { z } from "zod";
import { api } from "@/lib/api-client";
import { t, te } from "@/lib/i18n";
import { requestDraftSchema } from "@/lib/schemas";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { errorMessage } from "@/components/ui/dialog";
import { Alert } from "@/components/ui/feedback";
import { Field, FormError, Input, Select, Textarea } from "@/components/ui/field";

type Values = z.input<typeof requestDraftSchema>;
type EquipmentOption = { id: string; label: string; siteName: string; category: string };

const STEPS = ["equipment", "details", "windows", "review"] as const;

export function RequestWizard({
  equipment,
  defaultEquipmentId,
  providerOrgId,
  routingHoursLabel,
  tomorrow,
}: {
  equipment: EquipmentOption[];
  defaultEquipmentId?: string;
  providerOrgId?: string;
  routingHoursLabel: string;
  tomorrow: string;
}) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<Values>({
    resolver: zodResolver(requestDraftSchema),
    mode: "onTouched",
    defaultValues: {
      equipmentId: defaultEquipmentId ?? equipment[0]?.id,
      kind: "DIAGNOSTIC",
      preferredWindows: [{ date: tomorrow, start: "09:00", end: "12:00" }],
    },
  });
  const windows = useFieldArray({ control: form.control, name: "preferredWindows" });
  const { errors, isSubmitting } = form.formState;
  const values = form.watch();
  const selected = equipment.find((e) => e.id === values.equipmentId);

  const next = async () => {
    const fields: (keyof Values)[][] = [["equipmentId"], ["kind", "title", "symptoms"], ["preferredWindows"], []];
    const ok = await form.trigger(fields[step] as (keyof Values)[]);
    if (ok) setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  return (
    <form
      noValidate
      onSubmit={form.handleSubmit(async (v) => {
        setError(null);
        try {
          const created = await api<{ id: string }>("/api/v1/requests", { body: v });
          router.push(`/client/demandes/${created.id}?etape=photos${providerOrgId ? `&prestataire=${providerOrgId}` : ""}`);
        } catch (e) {
          setError(errorMessage(e));
        }
      })}
      className="space-y-6"
    >
      <ol className="flex flex-wrap gap-2" aria-label={t("customer.wizard.progress")}>
        {STEPS.map((s, i) => (
          <li key={s} aria-current={i === step ? "step" : undefined} className={cn("rounded-full border px-3 py-1 text-xs font-semibold", i === step ? "border-brand bg-brand text-white" : i < step ? "border-brand bg-brand-soft text-brand-ink" : "border-line text-muted")}>
            {i + 1}. {t(`customer.wizard.steps.${s}`)}
          </li>
        ))}
      </ol>

      {step === 0 ? (
        <fieldset className="space-y-3">
          <legend className="text-lg font-semibold text-ink">{t("customer.wizard.equipmentTitle")}</legend>
          <Field label={t("customer.wizard.equipment")} error={errors.equipmentId?.message} required>
            <Select {...form.register("equipmentId")}>
              {equipment.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.label} — {e.siteName} ({e.category})
                </option>
              ))}
            </Select>
          </Field>
          <p className="text-sm text-muted">{t("customer.wizard.equipmentHint")}</p>
        </fieldset>
      ) : null}

      {step === 1 ? (
        <fieldset className="space-y-4">
          <legend className="text-lg font-semibold text-ink">{t("customer.wizard.detailsTitle")}</legend>
          <div className="grid gap-3 md:grid-cols-3" role="radiogroup" aria-label={t("customer.wizard.kind")}>
            {(["DIAGNOSTIC", "MAINTENANCE", "BREAKDOWN"] as const).map((k) => (
              <label key={k} className={cn("flex cursor-pointer gap-3 rounded-lg border p-3", values.kind === k ? "border-brand bg-brand-soft" : "border-line-strong hover:bg-subtle")}>
                <input type="radio" value={k} className="mt-1 size-4 accent-[var(--color-brand)]" {...form.register("kind")} />
                <span>
                  <span className="block font-semibold text-ink">{te("enums.requestKind", k)}</span>
                  <span className="block text-xs text-muted">{t(`customer.wizard.kindHelp.${k}`)}</span>
                </span>
              </label>
            ))}
          </div>
          {values.kind === "BREAKDOWN" ? (
            <Alert tone="warn" title={t("customer.wizard.breakdownTitle")}>
              {t("customer.wizard.breakdownBody", { hours: routingHoursLabel })}
            </Alert>
          ) : null}
          <Field label={t("customer.wizard.title")} error={errors.title?.message} required>
            <Input {...form.register("title")} placeholder={t("customer.wizard.titlePlaceholder")} />
          </Field>
          <Field label={t("customer.wizard.symptoms")} hint={t("customer.wizard.symptomsHint")} error={errors.symptoms?.message} required>
            <Textarea rows={5} {...form.register("symptoms")} />
          </Field>
        </fieldset>
      ) : null}

      {step === 2 ? (
        <fieldset className="space-y-4">
          <legend className="text-lg font-semibold text-ink">{t("customer.wizard.windowsTitle")}</legend>
          <p className="text-sm text-muted">{t("customer.wizard.windowsHint")}</p>
          {windows.fields.map((f, i) => (
            <div key={f.id} className="grid items-end gap-3 rounded-lg border border-line p-3 sm:grid-cols-[1.3fr_1fr_1fr_auto]">
              <Field label={t("customer.wizard.date")} error={errors.preferredWindows?.[i]?.date?.message}>
                <Input type="date" min={tomorrow} {...form.register(`preferredWindows.${i}.date`)} />
              </Field>
              <Field label={t("customer.wizard.from")} error={errors.preferredWindows?.[i]?.start?.message}>
                <Input type="time" step={900} {...form.register(`preferredWindows.${i}.start`)} />
              </Field>
              <Field label={t("customer.wizard.to")} error={errors.preferredWindows?.[i]?.end?.message}>
                <Input type="time" step={900} {...form.register(`preferredWindows.${i}.end`)} />
              </Field>
              <Button variant="ghost" size="sm" disabled={windows.fields.length === 1} onClick={() => windows.remove(i)} aria-label={t("customer.wizard.removeWindow", { n: i + 1 })} icon={<Trash aria-hidden className="size-4" />}>
                <span className="sm:sr-only">{t("common.remove")}</span>
              </Button>
            </div>
          ))}
          {errors.preferredWindows?.message ? <p role="alert" className="text-sm text-danger">{errors.preferredWindows.message}</p> : null}
          {windows.fields.length < 3 ? (
            <Button variant="secondary" size="sm" icon={<Plus aria-hidden className="size-4" />} onClick={() => windows.append({ date: tomorrow, start: "14:00", end: "17:00" })}>
              {t("customer.wizard.addWindow")}
            </Button>
          ) : null}
          <p className="text-xs text-muted">{t("customer.wizard.timezone")}</p>
        </fieldset>
      ) : null}

      {step === 3 ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-ink">{t("customer.wizard.reviewTitle")}</h2>
          <dl className="grid gap-3 rounded-lg border border-line p-4 text-sm sm:grid-cols-2">
            <div><dt className="text-xs font-semibold uppercase text-muted">{t("customer.wizard.equipment")}</dt><dd>{selected ? `${selected.label} — ${selected.siteName}` : "—"}</dd></div>
            <div><dt className="text-xs font-semibold uppercase text-muted">{t("customer.wizard.kind")}</dt><dd>{te("enums.requestKind", values.kind)}</dd></div>
            <div className="sm:col-span-2"><dt className="text-xs font-semibold uppercase text-muted">{t("customer.wizard.title")}</dt><dd>{values.title}</dd></div>
            <div className="sm:col-span-2"><dt className="text-xs font-semibold uppercase text-muted">{t("customer.wizard.symptoms")}</dt><dd className="prose-plain">{values.symptoms}</dd></div>
            <div className="sm:col-span-2"><dt className="text-xs font-semibold uppercase text-muted">{t("customer.wizard.windowsTitle")}</dt>
              <dd><ul>{values.preferredWindows?.map((w, i) => <li key={i}>{w.date} · {w.start} – {w.end}</li>)}</ul></dd></div>
          </dl>
          <Alert tone="info">{t("customer.wizard.reviewNote")}</Alert>
        </section>
      ) : null}

      <FormError error={error} />
      <div className="flex flex-wrap justify-between gap-2 border-t border-line pt-4">
        <Button variant="secondary" disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))}>
          {t("common.back")}
        </Button>
        {step < STEPS.length - 1 ? (
          <Button onClick={next}>{t("common.next")}</Button>
        ) : (
          <Button type="submit" loading={isSubmitting}>
            {t("customer.wizard.createDraft")}
          </Button>
        )}
      </div>
    </form>
  );
}
