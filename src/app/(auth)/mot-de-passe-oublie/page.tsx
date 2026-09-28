import type { Metadata } from "next";
import Link from "next/link";
import { t } from "@/lib/i18n";
import { ForgotPasswordForm } from "@/features/auth-forms";

export const metadata: Metadata = { title: t("auth.forgotTitle") };

export default function ForgotPasswordPage() {
  return (
    <>
      <h1 className="text-2xl font-bold text-ink">{t("auth.forgotTitle")}</h1>
      <p className="mt-1 text-sm text-muted">{t("auth.forgotIntro")}</p>
      <div className="mt-6">
        <ForgotPasswordForm />
      </div>
      <p className="mt-4 text-center text-sm">
        <Link href="/connexion" className="font-medium text-brand hover:underline">
          {t("auth.backToSignIn")}
        </Link>
      </p>
    </>
  );
}
