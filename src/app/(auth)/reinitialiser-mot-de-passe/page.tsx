import type { Metadata } from "next";
import { t } from "@/lib/i18n";
import { ResetPasswordForm } from "@/features/auth-forms";

export const metadata: Metadata = { title: t("auth.resetTitle") };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string; error?: string }> }) {
  const sp = await searchParams;
  const token = sp.error ? null : sp.token && /^[A-Za-z0-9_-]{10,200}$/.test(sp.token) ? sp.token : null;
  return (
    <>
      <h1 className="text-2xl font-bold text-ink">{t("auth.resetTitle")}</h1>
      <p className="mt-1 text-sm text-muted">{t("auth.resetIntro")}</p>
      <div className="mt-6">
        <ResetPasswordForm token={token} />
      </div>
    </>
  );
}
