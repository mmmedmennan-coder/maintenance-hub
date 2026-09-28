import type { ReactNode } from "react";
import { guard } from "@/server/auth/page-guard";
import { AppShell } from "@/components/domain/app-shell";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const actor = await guard({ orgTypes: ["PLATFORM"], roles: ["platform_admin"] });
  return <AppShell actor={actor}>{children}</AppShell>;
}
