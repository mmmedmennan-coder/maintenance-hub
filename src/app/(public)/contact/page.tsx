import type { Metadata } from "next";
import { t } from "@/lib/i18n";
import { SupportForm } from "@/features/support-form";
import { Card, CardBody } from "@/components/ui/card";

export const metadata: Metadata = { title: t("public.contact.title") };

export default function ContactPage() {
  return (
    <div className="mx-auto grid max-w-5xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-[1fr_1.2fr]">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-ink">{t("public.contact.title")}</h1>
        <p className="mt-3 text-ink-soft">{t("public.contact.intro")}</p>
        <ul className="mt-6 space-y-3 text-sm text-muted">
          <li>{t("public.contact.noteEmergency")}</li>
          <li>{t("public.contact.noteData")}</li>
        </ul>
      </div>
      <Card>
        <CardBody className="p-6">
          <SupportForm />
        </CardBody>
      </Card>
    </div>
  );
}
