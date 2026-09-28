import type { ReactNode } from "react";
import { guard } from "@/server/auth/page-guard";
import { AppShell } from "@/components/domain/app-shell";

/** Provider management workspace (owner, dispatcher). Technicians are sent to their own workspace. */
export default async function ProviderLayout({ children }: { children: ReactNode }) {
  const actor = await guard({ orgTypes: ["PROVIDER"], roles: ["provider_owner", "provider_dispatcher"] });
  return <AppShell actor={actor}>{children}</AppShell>;
}
