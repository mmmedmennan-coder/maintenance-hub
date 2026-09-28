import { staffInviteSchema } from "@/lib/schemas";
import { actorRoute } from "@/server/http";
import { inviteStaff } from "@/server/modules/organizations";

export const POST = actorRoute({ body: staffInviteSchema, orgTypes: ["CUSTOMER", "PROVIDER"] }, async ({ actor, body }) => inviteStaff(actor, body));
