import { z } from "zod";
import { memberRoleSchema } from "@/lib/schemas";
import type { Role } from "@/server/auth/roles";
import { actorRoute } from "@/server/http";
import { changeMemberRole, removeMember } from "@/server/modules/organizations";

const params = z.object({ id: z.string().min(1).max(64) });

export const PATCH = actorRoute({ params, body: memberRoleSchema, orgTypes: ["CUSTOMER", "PROVIDER"] }, async ({ actor, params, body }) => {
  await changeMemberRole(actor, params.id, body.role as Role);
});

export const DELETE = actorRoute({ params, orgTypes: ["CUSTOMER", "PROVIDER"] }, async ({ actor, params }) => {
  await removeMember(actor, params.id);
});
