import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { DIR, HTML_LANG, t } from "@/lib/i18n";
import { ServiceWorkerRegistration } from "@/components/domain/service-worker";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: `${t("app.name")} — ${t("app.tagline")}`, template: `%s · ${t("app.name")}` },
  description: t("public.home.metaDescription"),
  applicationName: t("app.name"),
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#0e7c73",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang={HTML_LANG} dir={DIR}>
      <body className="min-h-dvh antialiased">
        {children}
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
