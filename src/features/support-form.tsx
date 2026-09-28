"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { api } from "@/lib/api-client";
import { t, te } from "@/lib/i18n";
import { supportMessageSchema } from "@/lib/schemas";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/components/ui/dialog";
import { Alert } from "@/components/ui/feedback";
import { Field, FormError, Input, Select, Textarea } from "@/components/ui/field";

type Values = z.input<typeof supportMessageSchema>;

export function SupportForm() {
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const form = useForm<Values>({ resolver: zodResolver(supportMessageSchema, undefined, { raw: true }), defaultValues: { topic: "CUSTOMER" } });
  const { errors, isSubmitting } = form.formState;
  if (sent) {
    return (
      <Alert tone="success" title={t("public.contact.sentTitle")} live>
        {t("public.contact.sentBody")}
      </Alert>
    );
  }
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={form.handleSubmit(async (values) => {
        setError(null);
        try {
          await api("/api/v1/support", { body: values });
          setSent(true);
        } catch (e) {
          setError(errorMessage(e));
        }
      })}
    >
      <Field label={t("public.contact.name")} error={errors.name?.message} required>
        <Input autoComplete="name" {...form.register("name")} />
      </Field>
      <Field label={t("public.contact.email")} error={errors.email?.message} required>
        <Input type="email" autoComplete="email" {...form.register("email")} />
      </Field>
      <Field label={t("public.contact.organization")} error={errors.organizationName?.message}>
        <Input autoComplete="organization" {...form.register("organizationName")} />
      </Field>
      <Field label={t("public.contact.topic")} error={errors.topic?.message} required>
        <Select {...form.register("topic")}>
          {["CUSTOMER", "PROVIDER", "ACCOUNT", "OTHER"].map((k) => (
            <option key={k} value={k}>
              {te("enums.supportTopic", k)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("public.contact.message")} error={errors.message?.message} required>
        <Textarea rows={6} {...form.register("message")} />
      </Field>
      <FormError error={error} />
      <Button type="submit" loading={isSubmitting}>
        {t("public.contact.send")}
      </Button>
    </form>
  );
}
