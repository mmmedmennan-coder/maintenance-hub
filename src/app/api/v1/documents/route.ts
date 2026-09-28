import { uploadInitSchema } from "@/lib/schemas";
import { withActor } from "@/server/db/context";
import { actorRoute } from "@/server/http";
import { initUpload } from "@/server/modules/documents";

/** Step 1 of an upload: declares the file and its target; returns the content URL. */
export const POST = actorRoute({ body: uploadInitSchema, orgTypes: ["CUSTOMER", "PROVIDER"] }, async ({ actor, body }) => withActor(actor, (tx) => initUpload(tx, actor, body)));
