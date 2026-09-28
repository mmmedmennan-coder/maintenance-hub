import type { ReactNode } from "react";
import { guard } from "@/server/auth/page-guard";
import { AppShell } from "@/components/domain/app-shell";

export default async function WorkspaceLayout({ children }: { children: ReactNode }) {
  const actor = await guard();
  return <AppShell actor={actor}>{children}</AppShell>;
}
