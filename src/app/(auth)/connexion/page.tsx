import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { t } from "@/lib/i18n";
import { getSession, safeNext } from "@/server/auth/session";
import { SignInForm } from "@/features/auth-forms";
import { Alert } from "@/components/ui/feedback";

export const metadata: Metadata = { title: t("auth.signInTitle") };

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string; verifie?: string }> }) {
  const sp = await searchParams;
  const next = safeNext(sp.next, "/onboarding");
  if (await getSession()) redirect(next);
  return (
    <>
      <h1 className="text-2xl font-bold text-ink">{t("auth.signInTitle")}</h1>
      <p className="mt-1 text-sm text-muted">{t("auth.signInIntro")}</p>
      {sp.verifie ? (
        <Alert tone="success" className="mt-4">
          {t("auth.verifiedNotice")}
        </Alert>
      ) : null}
      <div className="mt-6">
        <SignInForm next={next} />
      </div>
    </>
  );
}
