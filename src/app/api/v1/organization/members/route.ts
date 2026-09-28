import { actorRoute } from "@/server/http";
import { listMembers } from "@/server/modules/organizations";

export const GET = actorRoute({ orgTypes: ["CUSTOMER", "PROVIDER"] }, async ({ actor }) => listMembers(actor));
