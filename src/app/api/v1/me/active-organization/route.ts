import { activeOrganizationSchema } from "@/lib/schemas";
import { publicRoute } from "@/server/http";
import { setActiveOrganization } from "@/server/modules/organizations";

export const POST = publicRoute({ body: activeOrganizationSchema, requireSession: true }, async ({ session, body }) =>
  setActiveOrganization(session!, body.organizationId),
);
