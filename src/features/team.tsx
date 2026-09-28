"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { MailPlus } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { api } from "@/lib/api-client";
import { t } from "@/lib/i18n";
import { referralSchema, staffInviteSchema } from "@/lib/schemas";
import { Button } from "@/components/ui/button";
import { ActionDialog, useAction } from "@/components/ui/dialog";
import { Alert } from "@/components/ui/feedback";
import { Field, FormError, Input, Select, Textarea } from "@/components/ui/field";

type InviteValues = z.input<typeof staffInviteSchema>;

export function InviteStaffForm({ roles, disabledReason }: { roles: string[]; disabledReason?: string | null }) {
  const [sent, setSent] = useState<string | null>(null);
  const { run, error } = useAction();
  const form = useForm<InviteValues>({ resolver: zodResolver(staffInviteSchema), defaultValues: { email: "", role: roles[roles.length - 1] as InviteValues["role"] } });
  const { errors, isSubmitting } = form.formState;
  if (disabledReason) return <Alert tone="warn">{disabledReason}</Alert>;
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={form.handleSubmit(async (values) => {
        setSent(null);
        const ok = await run(() => api("/api/v1/organization/invitations", { body: values }));
        if (ok !== undefined) {
          setSent(values.email);
          form.reset({ email: "", role: values.role });
        }
      })}
    >
      <div className="grid gap-4 sm:grid-cols-[1fr_14rem]">
        <Field label={t("team.email")} error={errors.email?.message} required>
          <Input type="email" autoComplete="off" {...form.register("email")} />
        </Field>
        <Field label={t("team.role")} error={errors.role?.message} required>
          <Select {...form.register("role")}>
            {roles.map((r) => (
              <option key={r} value={r}>
                {t(`roles.${r}`)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <FormError error={error} />
      {sent ? (
        <Alert tone="success" live>
          {t("team.invited", { email: sent })}
        </Alert>
      ) : null}
      <Button type="submit" loading={isSubmitting} icon={<MailPlus aria-hidden className="size-4" />}>
        {t("team.invite")}
      </Button>
    </form>
  );
}

export function MemberRoleSelect({ memberId, role, roles, label }: { memberId: string; role: string; roles: string[]; label: string }) {
  const [value, setValue] = useState(role);
  const { run, pending, error } = useAction();
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <Select aria-label={label} value={value} onChange={(e) => setValue(e.target.value)} className="h-9 min-w-44">
          {roles.map((r) => (
            <option key={r} value={r}>
              {t(`roles.${r}`)}
            </option>
          ))}
        </Select>
        {value !== role ? (
          <Button size="sm" loading={pending} onClick={() => run(() => api(`/api/v1/organization/members/${memberId}`, { method: "PATCH", body: { role: value } }))}>
            {t("common.save")}
          </Button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function RemoveMemberButton({ memberId, name }: { memberId: string; name: string }) {
  return (
    <ActionDialog
      triggerLabel={t("team.remove")}
      triggerVariant="ghost"
      triggerSize="sm"
      title={t("team.removeTitle", { name })}
      description={t("team.removeBody")}
      confirmLabel={t("team.remove")}
      confirmVariant="danger"
      onConfirm={() => api(`/api/v1/organization/members/${memberId}`, { method: "DELETE" })}
    />
  );
}

export function CancelInvitationButton({ invitationId }: { invitationId: string }) {
  return (
    <ActionDialog
      triggerLabel={t("team.cancelInvitation")}
      triggerVariant="ghost"
      triggerSize="sm"
      title={t("team.cancelInvitation")}
      confirmLabel={t("team.cancelInvitation")}
      confirmVariant="danger"
      onConfirm={() => api(`/api/v1/organization/invitations/${invitationId}`, { method: "DELETE" })}
    />
  );
}

type ReferralValues = z.input<typeof referralSchema>;

/** A customer invites a provider it already works with to join (email sent via the queue). */
export function ReferralForm() {
  const [sent, setSent] = useState(false);
  const { run, error } = useAction();
  const form = useForm<ReferralValues>({ resolver: zodResolver(referralSchema), defaultValues: { email: "", companyName: "", message: "" } });
  const { errors, isSubmitting } = form.formState;
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={form.handleSubmit(async (values) => {
        setSent(false);
        const ok = await run(() => api("/api/v1/referrals", { body: values }), { refresh: false });
        if (ok !== undefined) {
          setSent(true);
          form.reset();
        }
      })}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("team.referral.company")} error={errors.companyName?.message} required>
          <Input {...form.register("companyName")} />
        </Field>
        <Field label={t("team.email")} error={errors.email?.message} required>
          <Input type="email" {...form.register("email")} />
        </Field>
      </div>
      <Field label={t("team.referral.message")} error={errors.message?.message}>
        <Textarea rows={2} maxLength={500} {...form.register("message")} />
      </Field>
      <FormError error={error} />
      {sent ? (
        <Alert tone="success" live>
          {t("team.referral.sent")}
        </Alert>
      ) : null}
      <Button type="submit" variant="secondary" loading={isSubmitting}>
        {t("team.referral.send")}
      </Button>
    </form>
  );
}
