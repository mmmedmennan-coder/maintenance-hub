"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { authClient } from "@/lib/auth-client";
import { t } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert } from "@/components/ui/feedback";
import { Field, FormError, Input } from "@/components/ui/field";

const nameSchema = z.object({ name: z.string().trim().min(2, t("auth.errors.name")).max(120) });
const passwordSchema = z
  .object({ current: z.string().min(1, t("auth.errors.passwordRequired")), next: z.string().min(10, t("auth.errors.passwordShort")).max(128), confirm: z.string() })
  .refine((v) => v.next === v.confirm, { path: ["confirm"], message: t("auth.errors.mismatch") });

export function AccountForms({ name, email }: { name: string; email: string }) {
  const router = useRouter();
  const [nameMsg, setNameMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const nameForm = useForm<z.input<typeof nameSchema>>({ resolver: zodResolver(nameSchema), defaultValues: { name } });
  const pwForm = useForm<z.input<typeof passwordSchema>>({ resolver: zodResolver(passwordSchema) });
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title={t("account.profile")} description={email} />
        <CardBody>
          <form
            noValidate
            className="space-y-4"
            onSubmit={nameForm.handleSubmit(async (v) => {
              setNameMsg(null);
              const { error } = await authClient.updateUser({ name: v.name });
              if (error) setNameMsg({ ok: false, text: t("errors.generic") });
              else {
                setNameMsg({ ok: true, text: t("common.saved") });
                router.refresh();
              }
            })}
          >
            <Field label={t("auth.name")} error={nameForm.formState.errors.name?.message} required>
              <Input autoComplete="name" {...nameForm.register("name")} />
            </Field>
            {nameMsg ? nameMsg.ok ? <Alert tone="success" live>{nameMsg.text}</Alert> : <FormError error={nameMsg.text} /> : null}
            <Button type="submit" loading={nameForm.formState.isSubmitting}>
              {t("common.save")}
            </Button>
          </form>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={t("account.password")} description={t("account.passwordIntro")} />
        <CardBody>
          <form
            noValidate
            className="space-y-4"
            onSubmit={pwForm.handleSubmit(async (v) => {
              setPwMsg(null);
              const { error } = await authClient.changePassword({ currentPassword: v.current, newPassword: v.next, revokeOtherSessions: true });
              if (error) setPwMsg({ ok: false, text: error.code === "INVALID_PASSWORD" ? t("account.wrongPassword") : t("errors.generic") });
              else {
                pwForm.reset();
                setPwMsg({ ok: true, text: t("account.passwordChanged") });
              }
            })}
          >
            <Field label={t("account.currentPassword")} error={pwForm.formState.errors.current?.message} required>
              <Input type="password" autoComplete="current-password" {...pwForm.register("current")} />
            </Field>
            <Field label={t("auth.newPassword")} hint={t("auth.passwordHint")} error={pwForm.formState.errors.next?.message} required>
              <Input type="password" autoComplete="new-password" {...pwForm.register("next")} />
            </Field>
            <Field label={t("auth.confirmPassword")} error={pwForm.formState.errors.confirm?.message} required>
              <Input type="password" autoComplete="new-password" {...pwForm.register("confirm")} />
            </Field>
            {pwMsg ? pwMsg.ok ? <Alert tone="success" live>{pwMsg.text}</Alert> : <FormError error={pwMsg.text} /> : null}
            <Button type="submit" loading={pwForm.formState.isSubmitting}>
              {t("account.changePassword")}
            </Button>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
