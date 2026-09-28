"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Plus } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { api } from "@/lib/api-client";
import { t, te } from "@/lib/i18n";
import { availabilityWindowSchema, technicianSchema, timeOffSchema } from "@/lib/schemas";
import { Button } from "@/components/ui/button";
import { ActionButton, useAction } from "@/components/ui/dialog";
import { Alert } from "@/components/ui/feedback";
import { Checkbox, Field, FormError, Input, Select } from "@/components/ui/field";

type TechValues = z.input<typeof technicianSchema>;

/** Creates or edits a technician profile (optionally linked to a member with the technician role). */
export function TechnicianForm({
  technician,
  categories,
  members,
}: {
  technician?: { id: string; displayName: string; phone: string | null; userId: string | null; skillIds: string[]; active: boolean };
  categories: { id: string; labelFr: string }[];
  members: { userId: string; name: string }[];
}) {
  const [saved, setSaved] = useState(false);
  const { run, error } = useAction();
  const form = useForm<TechValues>({
    resolver: zodResolver(technicianSchema),
    defaultValues: technician
      ? { displayName: technician.displayName, phone: technician.phone ?? "", userId: technician.userId ?? "", skillIds: technician.skillIds, active: technician.active }
      : { displayName: "", phone: "", userId: "", skillIds: [], active: true },
  });
  const { errors, isSubmitting } = form.formState;
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={form.handleSubmit(async (values) => {
        setSaved(false);
        const body = { ...values, userId: values.userId || null };
        const ok = await run(() => (technician ? api(`/api/v1/provider/technicians/${technician.id}`, { method: "PATCH", body }) : api("/api/v1/provider/technicians", { body })));
        if (ok !== undefined) {
          setSaved(true);
          if (!technician) form.reset();
        }
      })}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("technicians.name")} error={errors.displayName?.message} required>
          <Input {...form.register("displayName")} />
        </Field>
        <Field label={t("technicians.phone")} error={errors.phone?.message}>
          <Input type="tel" {...form.register("phone")} />
        </Field>
      </div>
      <Field label={t("technicians.account")} hint={t("technicians.accountHint")} error={errors.userId?.message}>
        <Select {...form.register("userId")}>
          <option value="">{t("technicians.noAccount")}</option>
          {members.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.name}
            </option>
          ))}
        </Select>
      </Field>
      <fieldset>
        <legend className="text-sm font-semibold text-ink">{t("technicians.skills")}</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {categories.map((c) => (
            <label key={c.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" value={c.id} {...form.register("skillIds")} className="size-4 accent-[var(--color-brand)]" />
              {c.labelFr}
            </label>
          ))}
        </div>
      </fieldset>
      <Checkbox label={t("technicians.active")} {...form.register("active")} />
      <FormError error={error} />
      {saved ? (
        <Alert tone="success" live>
          {t("common.saved")}
        </Alert>
      ) : null}
      <Button type="submit" loading={isSubmitting} icon={technician ? undefined : <Plus aria-hidden className="size-4" />}>
        {technician ? t("common.save") : t("technicians.create")}
      </Button>
    </form>
  );
}

type WindowValues = z.input<typeof availabilityWindowSchema>;

export function AvailabilityForm({ technicianId }: { technicianId: string }) {
  const { run, error } = useAction();
  const form = useForm<WindowValues>({ resolver: zodResolver(availabilityWindowSchema), defaultValues: { technicianId, weekday: 1, start: "08:00", end: "17:00" } });
  const { errors, isSubmitting } = form.formState;
  return (
    <form noValidate className="flex flex-wrap items-end gap-3" onSubmit={form.handleSubmit((values) => run(() => api("/api/v1/provider/availability", { body: values })))}>
      <Field label={t("technicians.weekday")} error={errors.weekday?.message}>
        <Select {...form.register("weekday")} className="w-36">
          {[1, 2, 3, 4, 5, 6, 7].map((d) => (
            <option key={d} value={d}>
              {te("enums.weekday", String(d))}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("offerEditor.from")} error={errors.start?.message}>
        <Input type="time" step={900} {...form.register("start")} className="w-28" />
      </Field>
      <Field label={t("offerEditor.to")} error={errors.end?.message}>
        <Input type="time" step={900} {...form.register("end")} className="w-28" />
      </Field>
      <Button type="submit" variant="secondary" loading={isSubmitting}>
        {t("technicians.addWindow")}
      </Button>
      <FormError error={error} />
    </form>
  );
}

type TimeOffValues = z.input<typeof timeOffSchema>;

export function TimeOffForm({ technicianId, today }: { technicianId: string; today: string }) {
  const { run, error } = useAction();
  const form = useForm<TimeOffValues>({ resolver: zodResolver(timeOffSchema), defaultValues: { technicianId, startDate: today, startTime: "08:00", endDate: today, endTime: "18:00", reason: "" } });
  const { errors, isSubmitting } = form.formState;
  return (
    <form noValidate className="space-y-3" onSubmit={form.handleSubmit((values) => run(() => api("/api/v1/provider/time-off", { body: values })))}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label={t("technicians.offFromDate")} error={errors.startDate?.message}>
          <Input type="date" {...form.register("startDate")} />
        </Field>
        <Field label={t("technicians.offFromTime")} error={errors.startTime?.message}>
          <Input type="time" step={900} {...form.register("startTime")} />
        </Field>
        <Field label={t("technicians.offToDate")} error={errors.endDate?.message}>
          <Input type="date" {...form.register("endDate")} />
        </Field>
        <Field label={t("technicians.offToTime")} error={errors.endTime?.message}>
          <Input type="time" step={900} {...form.register("endTime")} />
        </Field>
      </div>
      <Field label={t("technicians.offReason")} error={errors.reason?.message}>
        <Input {...form.register("reason")} />
      </Field>
      <FormError error={error} />
      <Button type="submit" variant="secondary" loading={isSubmitting}>
        {t("technicians.addTimeOff")}
      </Button>
    </form>
  );
}

export function DeleteResourceButton({ path, label }: { path: string; label: string }) {
  return (
    <ActionButton size="sm" variant="ghost" onRun={() => api(path, { method: "DELETE" })}>
      {label}
    </ActionButton>
  );
}
