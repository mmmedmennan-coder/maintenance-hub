import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { t, te } from "@/lib/i18n";
import { getSession } from "@/server/auth/session";
import { getInvitationForUser } from "@/server/modules/organizations";
import { Brand } from "@/components/domain/app-shell";
import { AcceptInvitationButton } from "@/features/accept-invitation";
import { ButtonLink } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";

export const metadata: Metadata = { title: t("invitation.title") };

export default async function InvitationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session) redirect(`/connexion?next=${encodeURIComponent(`/invitations/${id}`)}`);
  const invitation = /^[0-9a-f-]{36}$/.test(id) ? await getInvitationForUser(session, id) : null;
  return (
    <div className="min-h-dvh bg-canvas">
      <header className="mx-auto flex h-16 max-w-xl items-center px-4">
        <Brand />
      </header>
      <main id="main" className="mx-auto max-w-xl px-4 pb-16">
        <div className="rounded-[var(--radius-card)] border border-line bg-surface p-6 shadow-[var(--shadow-card)]">
          <h1 className="text-2xl font-bold text-ink">{t("invitation.title")}</h1>
          {!invitation ? (
            <Alert tone="warn" className="mt-4">
              {t("invitation.notForYou", { email: session.email })}
            </Alert>
          ) : invitation.status !== "pending" || invitation.expired ? (
            <Alert tone="warn" className="mt-4">
              {t("invitation.expired")}
            </Alert>
          ) : (
            <div className="mt-4 space-y-4">
              <p className="text-ink-soft">
                {t("invitation.body", { inviter: invitation.inviterName, org: invitation.orgName, role: te("roles", invitation.role) })}
              </p>
              <p className="text-sm text-muted">{te("orgType", invitation.orgType)}</p>
              <AcceptInvitationButton id={invitation.id} />
            </div>
          )}
          <div className="mt-6">
            <ButtonLink href="/onboarding" variant="ghost" size="sm">
              {t("invitation.back")}
            </ButtonLink>
          </div>
        </div>
      </main>
    </div>
  );
}
