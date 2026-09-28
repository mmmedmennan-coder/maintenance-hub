import type { Metadata } from "next";
import Link from "next/link";
import { t, te } from "@/lib/i18n";
import { guard } from "@/server/auth/page-guard";
import { getMemberships } from "@/server/auth/session";
import { AccountForms } from "@/features/account-forms";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/layout";

export const metadata: Metadata = { title: t("account.title") };

export default async function AccountPage() {
  const actor = await guard();
  const memberships = await getMemberships(actor.userId);
  return (
    <>
      <PageHeader title={t("account.title")} description={t("account.intro")} />
      <div className="grid gap-6 lg:grid-cols-2">
        <AccountForms name={actor.userName} email={actor.userEmail} />
        <Card>
          <CardHeader title={t("account.organizations")} description={t("account.organizationsIntro")} />
          <CardBody>
            <ul className="divide-y divide-line">
              {memberships.map((m) => (
                <li key={m.orgId} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <span>
                    <span className="font-semibold text-ink">{m.orgName}</span>
                    <span className="block text-sm text-muted">
                      {te("orgType", m.orgType)} · {te("roles", m.role)}
                    </span>
                  </span>
                  {m.orgId === actor.orgId ? <Badge tone="brand">{t("account.active")}</Badge> : null}
                </li>
              ))}
            </ul>
            <Link href="/onboarding?nouvelle=1" className="mt-3 inline-block text-sm font-semibold text-brand hover:underline">
              {t("account.createOther")}
            </Link>
          </CardBody>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title={t("account.dataTitle")} />
          <CardBody>
            <p className="text-sm text-ink-soft">{t("account.dataBody")}</p>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
