import { z } from "zod";
import { withActor } from "@/server/db/context";
import { actorRoute } from "@/server/http";
import { submitRequest } from "@/server/modules/requests";

export const POST = actorRoute({ orgTypes: ["CUSTOMER"], params: z.object({ id: z.uuid() }) }, async ({ actor, params }) => withActor(actor, (tx) => submitRequest(tx, actor, params.id)));
