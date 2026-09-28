import { z } from "zod";
import { noteSchema } from "@/lib/schemas";
import { withActor } from "@/server/db/context";
import { actorRoute } from "@/server/http";
import { addWorkOrderNote } from "@/server/modules/work";

export const POST = actorRoute({ orgTypes: ["CUSTOMER", "PROVIDER"], params: z.object({ id: z.uuid() }), body: noteSchema }, async ({ actor, params, body }) => {
  await withActor(actor, (tx) => addWorkOrderNote(tx, actor, params.id, body));
});
