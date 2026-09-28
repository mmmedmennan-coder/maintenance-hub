export const CUSTOMER_ROLES = ["customer_owner", "customer_manager", "customer_viewer"] as const;
export const PROVIDER_ROLES = ["provider_owner", "provider_dispatcher", "technician"] as const;
export const PLATFORM_ROLES = ["platform_admin"] as const;

export type CustomerRole = (typeof CUSTOMER_ROLES)[number];
export type ProviderRole = (typeof PROVIDER_ROLES)[number];
export type Role = CustomerRole | ProviderRole | "platform_admin";
export type OrgType = "CUSTOMER" | "PROVIDER" | "PLATFORM";

/** Roles that can be granted through staff invitations (never platform_admin). */
export const INVITABLE_ROLES: Record<Exclude<OrgType, "PLATFORM">, readonly Role[]> = {
  CUSTOMER: CUSTOMER_ROLES,
  PROVIDER: PROVIDER_ROLES,
};

export function isRoleValidForOrg(role: string, orgType: OrgType): role is Role {
  if (orgType === "CUSTOMER") return (CUSTOMER_ROLES as readonly string[]).includes(role);
  if (orgType === "PROVIDER") return (PROVIDER_ROLES as readonly string[]).includes(role);
  return role === "platform_admin";
}

export type Actor = {
  userId: string;
  userName: string;
  userEmail: string;
  orgId: string;
  orgName: string;
  orgType: OrgType;
  role: Role;
};

export const can = {
  customerWrite: (a: Actor) => a.orgType === "CUSTOMER" && (a.role === "customer_owner" || a.role === "customer_manager"),
  customerRead: (a: Actor) => a.orgType === "CUSTOMER",
  customerAdmin: (a: Actor) => a.orgType === "CUSTOMER" && a.role === "customer_owner",
  providerManage: (a: Actor) => a.orgType === "PROVIDER" && (a.role === "provider_owner" || a.role === "provider_dispatcher"),
  providerOwner: (a: Actor) => a.orgType === "PROVIDER" && a.role === "provider_owner",
  technician: (a: Actor) => a.orgType === "PROVIDER" && a.role === "technician",
  providerAny: (a: Actor) => a.orgType === "PROVIDER",
  admin: (a: Actor) => a.orgType === "PLATFORM" && a.role === "platform_admin",
};

/** Home route for an actor's workspace. */
export function workspaceHome(orgType: OrgType, role: Role): string {
  if (orgType === "PLATFORM") return "/admin";
  if (orgType === "PROVIDER") return role === "technician" ? "/technicien" : "/prestataire";
  return "/client";
}
