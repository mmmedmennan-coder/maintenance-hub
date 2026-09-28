"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Building, Wrench } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import type { z } from "zod";
import { api } from "@/lib/api-client";
import { t } from "@/lib/i18n";
import { onboardingSchema } from "@/lib/schemas";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { errorMessage } from "@/components/ui/dialog";
import { Field, FormError, Input } from "@/components/ui/field";

type Values = z.input<typeof onboardingSchema>;

export function OnboardingForm({ defaultType }: { defaultType?: "CUSTOMER" | "PROVIDER" }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<Values>({ resolver: zodResolver(onboardingSchema, undefined, { raw: true }), defaultValues: { type: defaultType, city: "Rabat" } });
  const { errors, isSubmitting } = form.formState;
  const type = useWatch({ control: form.control, name: "type" });
  return (
    <form
      noValidate
      className="space-y-5"
      onSubmit={form.handleSubmit(async (values) => {
        setError(null);
        try {
          const { home } = await api<{ home: string }>("/api/v1/onboarding", { body: values });
          router.push(home);
          router.refresh();
        } catch (e) {
          setError(errorMessage(e));
        }
      })}
    >
      <fieldset>
        <legend className="text-sm font-semibold text-ink">{t("onboarding.typeLabel")}</legend>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          {(["CUSTOMER", "PROVIDER"] as const).map((value) => {
            const Icon = value === "CUSTOMER" ? Building : Wrench;
            return (
              <label
                key={value}
                className={cn(
                  "flex cursor-pointer gap-3 rounded-lg border p-4 transition-colors",
                  type === value ? "border-brand bg-brand-soft" : "border-line-strong bg-surface hover:bg-subtle",
                )}
              >
                <input type="radio" value={value} className="mt-1 size-4 accent-[var(--color-brand)]" {...form.register("type")} />
                <span>
                  <span className="flex items-center gap-2 font-semibold text-ink">
                    <Icon aria-hidden className="size-4" /> {t(`onboarding.type.${value}.title`)}
                  </span>
                  <span className="mt-1 block text-sm text-muted">{t(`onboarding.type.${value}.body`)}</span>
                </span>
              </label>
            );
          })}
        </div>
        {errors.type ? (
          <p role="alert" className="mt-1 text-sm font-medium text-danger">
            {errors.type.message}
          </p>
        ) : null}
      </fieldset>
      <Field label={t("onboarding.name")} error={errors.name?.message} required>
        <Input autoComplete="organization" {...form.register("name")} />
      </Field>
      <Field label={t("onboarding.city")} hint={t("onboarding.cityHint")} error={errors.city?.message} required>
        <Input autoComplete="address-level2" {...form.register("city")} />
      </Field>
      <FormError error={error} />
      <Button type="submit" loading={isSubmitting}>
        {t("onboarding.submit")}
      </Button>
    </form>
  );
}
