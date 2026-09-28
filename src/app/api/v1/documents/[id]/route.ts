import { z } from "zod";
import { withActor } from "@/server/db/context";
import { actorRoute } from "@/server/http";
import { deleteDocument } from "@/server/modules/documents";
import { getStorage } from "@/server/storage";

export const DELETE = actorRoute({ params: z.object({ id: z.uuid() }), orgTypes: ["CUSTOMER", "PROVIDER"] }, async ({ actor, params }) => {
  const key = await withActor(actor, (tx) => deleteDocument(tx, actor, params.id));
  await getStorage().delete(key).catch(() => undefined);
});
