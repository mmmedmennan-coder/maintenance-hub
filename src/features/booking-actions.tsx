"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CalendarCheck, CalendarClock, CircleX, UserX } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { api } from "@/lib/api-client";
import { t } from "@/lib/i18n";
import { confirmBookingSchema, rescheduleProposalSchema } from "@/lib/schemas";
import { Button } from "@/components/ui/button";
import { ActionButton, ActionDialog, Dialog, useAction, useIdempotencyKey } from "@/components/ui/dialog";
import { Field, FormError, Input, Select, Textarea } from "@/components/ui/field";

export type TechnicianOption = { id: string; displayName: string; active: boolean; skilled: boolean };

type ConfirmValues = z.input<typeof confirmBookingSchema>;

/**
 * Provider confirms a pending booking by assigning a technician and an exact slot. The
 * database exclusion constraint rejects overlapping reservations (buffers included); the
 * resulting SLOT_CONFLICT message is shown as-is and nothing is reported as confirmed.
 */
export function ConfirmBookingForm({
  bookingId,
  lockVersion,
  technicians,
  defaults,
}: {
  bookingId: string;
  lockVersion: number;
  technicians: TechnicianOption[];
  defaults: { date: string; start: string; durationMin: number };
}) {
  const { run, error } = useAction();
  const idem = useIdempotencyKey();
  const active = technicians.filter((tech) => tech.active);
  const form = useForm<ConfirmValues>({
    resolver: zodResolver(confirmBookingSchema),
    defaultValues: {
      technicianId: active.find((tech) => tech.skilled)?.id ?? active[0]?.id ?? "",
      date: defaults.date,
      start: defaults.start,
      durationMin: defaults.durationMin,
      bufferBeforeMin: 30,
      bufferAfterMin: 30,
      expectedLockVersion: lockVersion,
    },
  });
  const { errors, isSubmitting } = form.formState;
  if (active.length === 0) {
    return <p className="text-sm text-danger">{t("booking.confirm.noTechnicians")}</p>;
  }
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={form.handleSubmit(async (values) => {
        const ok = await run(() => api(`/api/v1/bookings/${bookingId}/confirm`, { body: values, idempotencyKey: idem.key() }));
        if (ok !== undefined) idem.renew();
      })}
    >
      <Field label={t("booking.confirm.technician")} error={errors.technicianId?.message} required hint={t("booking.confirm.technicianHint")}>
        <Select {...form.register("technicianId")}>
          {active.map((tech) => (
            <option key={tech.id} value={tech.id}>
              {tech.displayName}
              {tech.skilled ? "" : ` — ${t("booking.confirm.noSkill")}`}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={t("booking.confirm.date")} error={errors.date?.message} required>
          <Input type="date" {...form.register("date")} />
        </Field>
        <Field label={t("booking.confirm.start")} error={errors.start?.message} required>
          <Input type="time" step={900} {...form.register("start")} />
        </Field>
        <Field label={t("booking.confirm.duration")} error={errors.durationMin?.message} required>
          <Input type="number" inputMode="numeric" min={15} step={15} {...form.register("durationMin")} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("booking.confirm.bufferBefore")} error={errors.bufferBeforeMin?.message} hint={t("booking.confirm.bufferHint")}>
          <Input type="number" inputMode="numeric" min={0} step={5} {...form.register("bufferBeforeMin")} />
        </Field>
        <Field label={t("booking.confirm.bufferAfter")} error={errors.bufferAfterMin?.message}>
          <Input type="number" inputMode="numeric" min={0} step={5} {...form.register("bufferAfterMin")} />
        </Field>
      </div>
      <FormError error={error} />
      <Button type="submit" loading={isSubmitting} icon={<CalendarCheck aria-hidden className="size-4" />}>
        {t("booking.confirm.submit")}
      </Button>
    </form>
  );
}

export function DeclineBookingButton({ bookingId }: { bookingId: string }) {
  return (
    <ActionDialog
      triggerLabel={t("booking.decline.action")}
      triggerVariant="secondary"
      title={t("booking.decline.title")}
      description={t("booking.decline.body")}
      confirmLabel={t("booking.decline.action")}
      confirmVariant="danger"
      reason={{ label: t("booking.decline.reason"), required: true }}
      onConfirm={(reason) => api(`/api/v1/bookings/${bookingId}/decline`, { body: { reason } })}
    />
  );
}

export function CancelBookingButton({ bookingId, terms }: { bookingId: string; terms?: string | null }) {
  return (
    <ActionDialog
      triggerLabel={t("booking.cancel.action")}
      triggerVariant="ghost"
      triggerIcon={<CircleX aria-hidden className="size-4" />}
      title={t("booking.cancel.title")}
      description={t("booking.cancel.body")}
      confirmLabel={t("booking.cancel.confirm")}
      confirmVariant="danger"
      reason={{ label: t("booking.cancel.reason"), required: true }}
      onConfirm={(reason) => api(`/api/v1/bookings/${bookingId}/cancel`, { body: { reason } })}
    >
      {terms ? (
        <div className="rounded-lg bg-subtle p-3 text-sm">
          <p className="font-semibold text-ink">{t("booking.cancel.terms")}</p>
          <p className="whitespace-pre-line text-ink-soft">{terms}</p>
        </div>
      ) : null}
    </ActionDialog>
  );
}

export function NoShowButton({ bookingId, absentSide }: { bookingId: string; absentSide: "CUSTOMER" | "PROVIDER" }) {
  return (
    <ActionDialog
      triggerLabel={absentSide === "PROVIDER" ? t("booking.noShow.providerAbsent") : t("booking.noShow.customerAbsent")}
      triggerVariant="ghost"
      triggerIcon={<UserX aria-hidden className="size-4" />}
      title={t("booking.noShow.title")}
      description={t("booking.noShow.body")}
      confirmLabel={t("booking.noShow.confirm")}
      confirmVariant="danger"
      reason={{ label: t("booking.noShow.note"), required: true }}
      onConfirm={(note) => api(`/api/v1/bookings/${bookingId}/no-show`, { body: { absentSide, note } })}
    />
  );
}

type RescheduleValues = z.input<typeof rescheduleProposalSchema>;

/** Either party proposes a new slot; the current appointment stays in force until accepted. */
export function ProposeRescheduleButton({
  bookingId,
  technicians,
  defaults,
}: {
  bookingId: string;
  technicians?: TechnicianOption[];
  defaults: { date: string; start: string; durationMin: number; technicianId?: string | null };
}) {
  const [open, setOpen] = useState(false);
  const { run, error } = useAction();
  const form = useForm<RescheduleValues>({
    resolver: zodResolver(rescheduleProposalSchema),
    defaultValues: { date: defaults.date, start: defaults.start, durationMin: defaults.durationMin, technicianId: defaults.technicianId ?? null, reason: "" },
  });
  const { errors, isSubmitting } = form.formState;
  const submit = form.handleSubmit(async (values) => {
    const ok = await run(() => api(`/api/v1/bookings/${bookingId}/reschedule-proposals`, { body: values }));
    if (ok !== undefined) {
      form.reset({ ...values, reason: "" });
      setOpen(false);
    }
  });
  return (
    <>
      <Button variant="secondary" icon={<CalendarClock aria-hidden className="size-4" />} onClick={() => setOpen(true)}>
        {t("booking.reschedule.propose")}
      </Button>
      <Dialog
        open={open}
        onClose={() => !isSubmitting && setOpen(false)}
        title={t("booking.reschedule.title")}
        description={t("booking.reschedule.body")}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={isSubmitting}>
              {t("common.cancel")}
            </Button>
            <Button onClick={submit} loading={isSubmitting}>
              {t("booking.reschedule.send")}
            </Button>
          </>
        }
      >
        <form noValidate className="space-y-4" onSubmit={submit}>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t("booking.confirm.date")} error={errors.date?.message} required>
              <Input type="date" {...form.register("date")} />
            </Field>
            <Field label={t("booking.confirm.start")} error={errors.start?.message} required>
              <Input type="time" step={900} {...form.register("start")} />
            </Field>
            <Field label={t("booking.confirm.duration")} error={errors.durationMin?.message} required>
              <Input type="number" inputMode="numeric" min={15} step={15} {...form.register("durationMin")} />
            </Field>
          </div>
          {technicians ? (
            <Field label={t("booking.confirm.technician")} error={errors.technicianId?.message}>
              <Select {...form.register("technicianId")}>
                {technicians
                  .filter((tech) => tech.active)
                  .map((tech) => (
                    <option key={tech.id} value={tech.id}>
                      {tech.displayName}
                    </option>
                  ))}
              </Select>
            </Field>
          ) : null}
          <Field label={t("booking.reschedule.reason")} error={errors.reason?.message} required>
            <Textarea rows={3} maxLength={500} {...form.register("reason")} />
          </Field>
          <FormError error={error} />
        </form>
      </Dialog>
    </>
  );
}

export function RespondRescheduleButtons({ proposalId, technicianId }: { proposalId: string; technicianId?: string | null }) {
  return (
    <div className="flex flex-wrap gap-2">
      <ActionButton size="sm" onRun={() => api(`/api/v1/reschedule-proposals/${proposalId}/respond`, { body: { accept: true, technicianId: technicianId ?? null } })}>
        {t("booking.reschedule.accept")}
      </ActionButton>
      <ActionDialog
        triggerLabel={t("booking.reschedule.reject")}
        triggerVariant="secondary"
        triggerSize="sm"
        title={t("booking.reschedule.rejectTitle")}
        confirmLabel={t("booking.reschedule.reject")}
        confirmVariant="danger"
        reason={{ label: t("booking.reschedule.rejectNote") }}
        onConfirm={(note) => api(`/api/v1/reschedule-proposals/${proposalId}/respond`, { body: { accept: false, note: note || null } })}
      />
    </div>
  );
}

export function WithdrawRescheduleButton({ proposalId }: { proposalId: string }) {
  return (
    <ActionButton size="sm" variant="ghost" onRun={() => api(`/api/v1/reschedule-proposals/${proposalId}/withdraw`, { method: "POST", body: {} })}>
      {t("booking.reschedule.withdraw")}
    </ActionButton>
  );
}
