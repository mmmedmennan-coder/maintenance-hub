"use client";

import { Send } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api-client";
import { t, te } from "@/lib/i18n";
import { minutesToLabel } from "@/lib/time";
import { Button } from "@/components/ui/button";
import { ActionButton, useAction } from "@/components/ui/dialog";
import { Alert } from "@/components/ui/feedback";
import { Field, FormError, Input, Textarea } from "@/components/ui/field";

type Hours = Record<string, [number, number]>;
type DayState = { open: boolean; start: string; end: string };
const DAYS = ["1", "2", "3", "4", "5", "6", "7"];

function toMinutes(v: string) {
  const [h, m] = v.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Weekly hours editor shared by the provider profile and admin service-area routing hours. */
export function HoursEditor({ value, onChange, legend }: { value: Record<string, DayState>; onChange: (v: Record<string, DayState>) => void; legend: string }) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-semibold text-ink">{legend}</legend>
      <ul className="divide-y divide-line rounded-lg border border-line">
        {DAYS.map((d) => {
          const day = value[d]!;
          return (
            <li key={d} className="flex flex-wrap items-center gap-3 px-3 py-2">
              <label className="flex w-32 items-center gap-2 text-sm font-medium">
                <input type="checkbox" checked={day.open} onChange={(e) => onChange({ ...value, [d]: { ...day, open: e.target.checked } })} className="size-4 accent-[var(--color-brand)]" />
                {te("enums.weekday", d)}
              </label>
              {day.open ? (
                <span className="flex items-center gap-2 text-sm">
                  <Input type="time" step={900} aria-label={t("hours.from", { day: te("enums.weekday", d) })} value={day.start} onChange={(e) => onChange({ ...value, [d]: { ...day, start: e.target.value } })} className="h-9 w-28" />
                  –
                  <Input type="time" step={900} aria-label={t("hours.to", { day: te("enums.weekday", d) })} value={day.end} onChange={(e) => onChange({ ...value, [d]: { ...day, end: e.target.value } })} className="h-9 w-28" />
                </span>
              ) : (
                <span className="text-sm text-muted">{t("provider.closed")}</span>
              )}
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}

export function hoursToState(hours: Hours): Record<string, DayState> {
  return Object.fromEntries(DAYS.map((d) => [d, hours[d] ? { open: true, start: minutesToLabel(hours[d]![0]), end: minutesToLabel(hours[d]![1]) } : { open: false, start: "08:00", end: "18:00" }]));
}

export function stateToHours(state: Record<string, DayState>): { hours: Hours; invalidDay: string | null } {
  const hours: Hours = {};
  for (const d of DAYS) {
    const day = state[d]!;
    if (!day.open) continue;
    const a = toMinutes(day.start);
    const b = toMinutes(day.end);
    if (!(a < b)) return { hours, invalidDay: d };
    hours[d] = [a, b];
  }
  return { hours, invalidDay: null };
}

type Profile = {
  displayName: string;
  summary: string;
  description: string;
  city: string;
  serviceHours: Hours;
  serviceAreaIds: string[];
  categoryIds: string[];
  version: number;
};

export function ProviderProfileForm({ profile, areas, categories, readOnly }: { profile: Profile; areas: { id: string; name: string; cities: string[] }[]; categories: { id: string; labelFr: string }[]; readOnly: boolean }) {
  const [values, setValues] = useState(profile);
  const [hours, setHours] = useState(() => hoursToState(profile.serviceHours));
  const [localError, setLocalError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const { run, pending, error, fieldErrors } = useAction();
  const set = <K extends keyof Profile>(key: K, v: Profile[K]) => setValues((s) => ({ ...s, [key]: v }));
  const toggle = (key: "serviceAreaIds" | "categoryIds", id: string) => set(key, values[key].includes(id) ? values[key].filter((x) => x !== id) : [...values[key], id]);
  const fe = (k: string) => fieldErrors?.[k]?.[0] ?? null;
  return (
    <form
      noValidate
      className="space-y-5"
      onSubmit={async (e) => {
        e.preventDefault();
        setLocalError(null);
        setSaved(false);
        const { hours: serviceHours, invalidDay } = stateToHours(hours);
        if (invalidDay) return setLocalError(t("hours.invalid", { day: te("enums.weekday", invalidDay) }));
        const ok = await run(() => api<{ id: string }>("/api/v1/provider/profile", { method: "PUT", body: { ...values, serviceHours } }));
        if (ok) {
          setSaved(true);
          set("version", values.version + 1);
        }
      }}
    >
      <fieldset disabled={readOnly} className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("providerProfile.displayName")} required error={fe("displayName")}>
            <Input value={values.displayName} onChange={(e) => set("displayName", e.target.value)} maxLength={120} />
          </Field>
          <Field label={t("providerProfile.city")} required error={fe("city")}>
            <Input value={values.city} onChange={(e) => set("city", e.target.value)} maxLength={80} />
          </Field>
        </div>
        <Field label={t("providerProfile.summary")} required hint={t("providerProfile.summaryHint")} error={fe("summary")}>
          <Input value={values.summary} onChange={(e) => set("summary", e.target.value)} maxLength={200} />
        </Field>
        <Field label={t("providerProfile.description")} required hint={t("providerProfile.descriptionHint")} error={fe("description")}>
          <Textarea rows={6} value={values.description} onChange={(e) => set("description", e.target.value)} maxLength={3000} />
        </Field>
        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold text-ink">{t("providerProfile.areas")}</legend>
          {fe("serviceAreaIds") ? <p className="text-sm text-danger">{fe("serviceAreaIds")}</p> : null}
          <div className="grid gap-2 sm:grid-cols-2">
            {areas.map((a) => (
              <label key={a.id} className="flex items-start gap-2 rounded-lg border border-line p-2.5 text-sm">
                <input type="checkbox" checked={values.serviceAreaIds.includes(a.id)} onChange={() => toggle("serviceAreaIds", a.id)} className="mt-0.5 size-4 accent-[var(--color-brand)]" />
                <span>
                  <span className="font-medium">{a.name}</span>
                  <span className="block text-xs text-muted">{a.cities.join(", ")}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold text-ink">{t("providerProfile.categories")}</legend>
          {fe("categoryIds") ? <p className="text-sm text-danger">{fe("categoryIds")}</p> : null}
          <div className="grid gap-2 sm:grid-cols-2">
            {categories.map((c) => (
              <label key={c.id} className="flex items-center gap-2 rounded-lg border border-line p-2.5 text-sm">
                <input type="checkbox" checked={values.categoryIds.includes(c.id)} onChange={() => toggle("categoryIds", c.id)} className="size-4 accent-[var(--color-brand)]" />
                {c.labelFr}
              </label>
            ))}
          </div>
        </fieldset>
        <HoursEditor legend={t("provider.serviceHours")} value={hours} onChange={setHours} />
      </fieldset>
      <FormError error={localError ?? error} />
      {saved ? (
        <Alert tone="success" live>
          {t("common.saved")}
        </Alert>
      ) : null}
      {!readOnly ? (
        <Button type="submit" loading={pending}>
          {t("common.save")}
        </Button>
      ) : null}
    </form>
  );
}

export function SubmitProfileButton() {
  return (
    <ActionButton icon={<Send aria-hidden className="size-4" />} onRun={() => api("/api/v1/provider/profile/submit", { method: "POST", body: {} })}>
      {t("providerProfile.submit")}
    </ActionButton>
  );
}
