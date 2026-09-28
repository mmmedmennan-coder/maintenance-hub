"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { authClient } from "@/lib/auth-client";
import { t } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { Field, FormError, Input } from "@/components/ui/field";

type AuthError = { code?: string; message?: string; status?: number } | null | undefined;

function authMessage(error: AuthError): string {
  if (!error) return t("errors.generic");
  if (error.status === 429) return t("auth.errors.rateLimited");
  switch (error.code) {
    case "INVALID_EMAIL_OR_PASSWORD":
      return t("auth.errors.invalidCredentials");
    case "EMAIL_NOT_VERIFIED":
      return t("auth.errors.notVerified");
    case "USER_ALREADY_EXISTS":
    case "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL":
      return t("auth.errors.cannotRegister");
    case "PASSWORD_TOO_SHORT":
      return t("auth.errors.passwordShort");
    case "INVALID_TOKEN":
      return t("auth.errors.invalidToken");
    default:
      return t("errors.generic");
  }
}

const email = z.email(t("auth.errors.email")).trim().toLowerCase();
const password = z.string().min(10, t("auth.errors.passwordShort")).max(128);

export function SignInForm({ next }: { next: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [unverified, setUnverified] = useState<string | null>(null);
  const form = useForm<{ email: string; password: string }>({ resolver: zodResolver(z.object({ email, password: z.string().min(1, t("auth.errors.passwordRequired")) })) });
  const { errors, isSubmitting } = form.formState;
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={form.handleSubmit(async (values) => {
        setError(null);
        setUnverified(null);
        const { error: err } = await authClient.signIn.email({ email: values.email, password: values.password });
        if (err) {
          setError(authMessage(err));
          if (err.code === "EMAIL_NOT_VERIFIED") setUnverified(values.email);
          return;
        }
        router.push(next);
        router.refresh();
      })}
    >
      <Field label={t("auth.email")} error={errors.email?.message} required>
        <Input type="email" autoComplete="email" {...form.register("email")} />
      </Field>
      <Field label={t("auth.password")} error={errors.password?.message} required>
        <Input type="password" autoComplete="current-password" {...form.register("password")} />
      </Field>
      <FormError error={error} />
      {unverified ? <ResendVerification email={unverified} /> : null}
      <Button type="submit" className="w-full" loading={isSubmitting}>
        {t("auth.signIn")}
      </Button>
      <div className="flex flex-wrap justify-between gap-2 text-sm">
        <Link href="/mot-de-passe-oublie" className="font-medium text-brand hover:underline">
          {t("auth.forgot")}
        </Link>
        <Link href={`/inscription${next !== "/" ? `?next=${encodeURIComponent(next)}` : ""}`} className="font-medium text-brand hover:underline">
          {t("auth.noAccount")}
        </Link>
      </div>
    </form>
  );
}

export function ResendVerification({ email: address }: { email: string }) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  return (
    <div className="rounded-lg border border-line bg-subtle p-3 text-sm">
      {state === "sent" ? (
        <p role="status">{t("auth.verificationResent")}</p>
      ) : (
        <button
          type="button"
          className="font-semibold text-brand hover:underline disabled:opacity-60"
          disabled={state === "sending"}
          onClick={async () => {
            setState("sending");
            const { error } = await authClient.sendVerificationEmail({ email: address, callbackURL: "/onboarding" });
            setState(error ? "error" : "sent");
          }}
        >
          {t("auth.resendVerification")}
        </button>
      )}
      {state === "error" ? (
        <p role="alert" className="mt-1 text-danger">
          {t("errors.generic")}
        </p>
      ) : null}
    </div>
  );
}

const signUpSchema = z
  .object({
    name: z.string().trim().min(2, t("auth.errors.name")).max(120),
    email,
    password,
    confirm: z.string(),
    accept: z.literal(true, { message: t("auth.errors.accept") }),
  })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: t("auth.errors.mismatch") });

export function SignUpForm({ intendedType, next }: { intendedType: "CUSTOMER" | "PROVIDER" | null; next: string | null }) {
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const form = useForm<z.input<typeof signUpSchema>>({ resolver: zodResolver(signUpSchema) });
  const { errors, isSubmitting } = form.formState;
  if (sentTo) {
    return (
      <div className="space-y-4">
        <Alert tone="success" title={t("auth.checkInbox")} live>
          {t("auth.checkInboxBody", { email: sentTo })}
        </Alert>
        <ResendVerification email={sentTo} />
      </div>
    );
  }
  const callbackURL = next ?? (intendedType ? `/onboarding?type=${intendedType}` : "/onboarding");
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={form.handleSubmit(async (values) => {
        setError(null);
        const { error: err } = await authClient.signUp.email({ name: values.name, email: values.email, password: values.password, callbackURL });
        if (err) {
          setError(authMessage(err));
          return;
        }
        setSentTo(values.email);
      })}
    >
      <Field label={t("auth.name")} error={errors.name?.message} required>
        <Input autoComplete="name" {...form.register("name")} />
      </Field>
      <Field label={t("auth.email")} error={errors.email?.message} required>
        <Input type="email" autoComplete="email" {...form.register("email")} />
      </Field>
      <Field label={t("auth.password")} hint={t("auth.passwordHint")} error={errors.password?.message} required>
        <Input type="password" autoComplete="new-password" {...form.register("password")} />
      </Field>
      <Field label={t("auth.confirmPassword")} error={errors.confirm?.message} required>
        <Input type="password" autoComplete="new-password" {...form.register("confirm")} />
      </Field>
      <div className="flex flex-col gap-1">
        <div className="flex items-start gap-3">
          <input id="accept" type="checkbox" className="mt-0.5 size-5 accent-[var(--color-brand)]" aria-invalid={!!errors.accept} aria-describedby={errors.accept ? "accept-error" : undefined} {...form.register("accept")} />
          <label htmlFor="accept" className="text-sm text-ink-soft">
            {t("auth.acceptPrefix")}{" "}
            <Link href="/confidentialite" className="font-medium text-brand underline" target="_blank">
              {t("public.nav.privacy")}
            </Link>
          </label>
        </div>
        {errors.accept ? (
          <p id="accept-error" role="alert" className="text-sm font-medium text-danger">
            {errors.accept.message}
          </p>
        ) : null}
      </div>
      <FormError error={error} />
      <Button type="submit" className="w-full" loading={isSubmitting}>
        {t("auth.createAccount")}
      </Button>
      <p className="text-center text-sm">
        <Link href="/connexion" className="font-medium text-brand hover:underline">
          {t("auth.haveAccount")}
        </Link>
      </p>
    </form>
  );
}

export function ForgotPasswordForm() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<{ email: string }>({ resolver: zodResolver(z.object({ email })) });
  const { errors, isSubmitting } = form.formState;
  if (sent) {
    return (
      <Alert tone="success" title={t("auth.resetSentTitle")} live>
        {t("auth.resetSentBody")}
      </Alert>
    );
  }
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={form.handleSubmit(async (values) => {
        setError(null);
        const { error: err } = await authClient.requestPasswordReset({ email: values.email, redirectTo: "/reinitialiser-mot-de-passe" });
        if (err && err.status === 429) {
          setError(authMessage(err));
          return;
        }
        // Same confirmation whether or not the address exists (no account enumeration).
        setSent(true);
      })}
    >
      <Field label={t("auth.email")} error={errors.email?.message} required>
        <Input type="email" autoComplete="email" {...form.register("email")} />
      </Field>
      <FormError error={error} />
      <Button type="submit" className="w-full" loading={isSubmitting}>
        {t("auth.sendResetLink")}
      </Button>
    </form>
  );
}

const resetSchema = z.object({ password, confirm: z.string() }).refine((v) => v.password === v.confirm, { path: ["confirm"], message: t("auth.errors.mismatch") });

export function ResetPasswordForm({ token }: { token: string | null }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const form = useForm<z.input<typeof resetSchema>>({ resolver: zodResolver(resetSchema) });
  const { errors, isSubmitting } = form.formState;
  if (!token) return <Alert tone="danger">{t("auth.errors.invalidToken")}</Alert>;
  if (done) {
    return (
      <div className="space-y-4">
        <Alert tone="success" title={t("auth.resetDoneTitle")} live>
          {t("auth.resetDoneBody")}
        </Alert>
        <Button onClick={() => router.push("/connexion")} className="w-full">
          {t("auth.signIn")}
        </Button>
      </div>
    );
  }
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={form.handleSubmit(async (values) => {
        setError(null);
        const { error: err } = await authClient.resetPassword({ newPassword: values.password, token });
        if (err) {
          setError(authMessage(err));
          return;
        }
        setDone(true);
      })}
    >
      <Field label={t("auth.newPassword")} hint={t("auth.passwordHint")} error={errors.password?.message} required>
        <Input type="password" autoComplete="new-password" {...form.register("password")} />
      </Field>
      <Field label={t("auth.confirmPassword")} error={errors.confirm?.message} required>
        <Input type="password" autoComplete="new-password" {...form.register("confirm")} />
      </Field>
      <FormError error={error} />
      <Button type="submit" className="w-full" loading={isSubmitting}>
        {t("auth.saveNewPassword")}
      </Button>
    </form>
  );
}
