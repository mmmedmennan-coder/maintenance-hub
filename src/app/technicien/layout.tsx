import type { ReactNode } from "react";
import { guard } from "@/server/auth/page-guard";
import { AppShell } from "@/components/domain/app-shell";

export default async function TechnicianLayout({ children }: { children: ReactNode }) {
  const actor = await guard({ orgTypes: ["PROVIDER"], roles: ["technician"] });
  return <AppShell actor={actor}>{children}</AppShell>;
}
