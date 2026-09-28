import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { t } from "@/lib/i18n";
import { getSession, safeNext } from "@/server/auth/session";
import { SignUpForm } from "@/features/auth-forms";

export const metadata: Metadata = { title: t("auth.signUpTitle") };

export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ type?: string; next?: string }> }) {
  const sp = await searchParams;
  if (await getSession()) redirect("/onboarding");
  const type = sp.type === "PROVIDER" || sp.type === "CUSTOMER" ? sp.type : null;
  const next = sp.next ? safeNext(sp.next, "/onboarding") : null;
  return (
    <>
      <h1 className="text-2xl font-bold text-ink">{t("auth.signUpTitle")}</h1>
      <p className="mt-1 text-sm text-muted">{type === "PROVIDER" ? t("auth.signUpIntroProvider") : t("auth.signUpIntro")}</p>
      <div className="mt-6">
        <SignUpForm intendedType={type} next={next} />
      </div>
    </>
  );
}
