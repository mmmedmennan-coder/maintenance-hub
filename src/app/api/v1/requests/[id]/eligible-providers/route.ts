import { z } from "zod";
import { can } from "@/server/auth/roles";
import { withActor } from "@/server/db/context";
import { notFound } from "@/server/errors";
import { actorRoute } from "@/server/http";
import { eligibleProvidersForRequest } from "@/server/modules/providers";

export const GET = actorRoute({ orgTypes: ["CUSTOMER", "PLATFORM"], params: z.object({ id: z.uuid() }) }, async ({ actor, params }) =>
  withActor(actor, async (tx) => {
    const request = await tx.serviceRequest.findFirst({ where: { id: params.id, ...(can.admin(actor) ? {} : { customerOrgId: actor.orgId }) } });
    if (!request) throw notFound("Demande");
    return eligibleProvidersForRequest(tx, request.equipmentCategoryId, can.admin(actor) ? null : request.serviceAreaId);
  }),
);
