import { z } from "zod";
import { publicRoute } from "@/server/http";
import { acceptInvitation } from "@/server/modules/organizations";

export const POST = publicRoute({ params: z.object({ id: z.string().min(1).max(64) }), requireSession: true }, async ({ session, params }) =>
  acceptInvitation(session!, params.id),
);
