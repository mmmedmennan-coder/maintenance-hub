import { onboardingSchema } from "@/lib/schemas";
import { publicRoute } from "@/server/http";
import { onboardOrganization } from "@/server/modules/organizations";

export const POST = publicRoute({ body: onboardingSchema, requireSession: true }, async ({ session, body }) => onboardOrganization(session!, body));
