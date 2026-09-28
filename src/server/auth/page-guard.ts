import "server-only";
import { headers } from "next/headers";
import type { OrgType, Role } from "./roles";
import { requirePageActor } from "./session";

/** Layout/page guard: resolves the verified actor or redirects (sign-in with return URL, onboarding, own workspace). */
export async function guard(options: { orgTypes?: OrgType[]; roles?: Role[] } = {}) {
  const path = (await headers()).get("x-pathname") ?? "/";
  return requirePageActor({ ...options, path });
}
