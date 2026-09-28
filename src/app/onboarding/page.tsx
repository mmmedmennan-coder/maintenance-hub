import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { t, te } from "@/lib/i18n";
import { workspaceHome } from "@/server/auth/roles";
import { getMemberships, getSession } from "@/server/auth/session";
import { authDb } from "@/server/db/clients";
import { Brand } from "@/components/domain/app-shell";
import { SignOutButton } from "@/components/domain/shell-client";
import { OnboardingForm } from "@/features/onboarding-form";
import { Card, CardBody, CardHeader } from "@/components/ui/card";

export const metadata: Metadata = { title: t("onboarding.title") };

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ type?: string; nouvelle?: string }> }) {
  const session = await getSession();
  if (!session) redirect("/connexion?next=/onboarding");
  const sp = await searchParams;
  const memberships = await getMemberships(session.userId);
  if (memberships.length > 0 && !sp.nouvelle) {
    const active = memberships.find((m) => m.orgId === session.activeOrganizationId) ?? memberships[0]!;
    redirect(workspaceHome(active.orgType, active.role));
  }
  const pending = await authDb().invitation.findMany({
    where: { email: session.email.toLowerCase(), status: "pending", expiresAt: { gt: new Date() } },
    include: { organization: { select: { name: true, type: true } } },
  });
  const type = sp.type === "PROVIDER" || sp.type === "CUSTOMER" ? sp.type : undefined;
  return (
    <div className="min-h-dvh bg-canvas">
      <header className="mx-auto flex h-16 max-w-3xl items-center justify-between px-4">
        <Brand />
        <SignOutButton />
      </header>
      <main id="main" className="mx-auto max-w-3xl space-y-6 px-4 pb-16">
        <div>
          <h1 className="text-2xl font-bold text-ink">{t("onboarding.title")}</h1>
          <p className="mt-1 text-muted">{t("onboarding.intro", { name: session.name })}</p>
        </div>
        {pending.length ? (
          <Card>
            <CardHeader title={t("onboarding.pendingTitle")} description={t("onboarding.pendingIntro")} />
            <CardBody>
              <ul className="divide-y divide-line">
                {pending.map((inv) => (
                  <li key={inv.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                    <span>
                      <strong>{inv.organization.name}</strong> · {te("orgType", inv.organization.type)} · {te("roles", inv.role)}
                    </span>
                    <Link className="font-semibold text-brand hover:underline" href={`/invitations/${inv.id}`}>
                      {t("onboarding.viewInvitation")}
                    </Link>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        ) : null}
        <Card>
          <CardHeader title={t("onboarding.createTitle")} description={t("onboarding.createIntro")} />
          <CardBody>
            <OnboardingForm defaultType={type} />
          </CardBody>
        </Card>
      </main>
    </div>
  );
}
