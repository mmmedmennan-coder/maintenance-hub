import { z } from "zod";
import { withActor } from "@/server/db/context";
import { actorRoute } from "@/server/http";
import { markNotificationsRead } from "@/server/modules/notifications";

const body = z.object({ ids: z.union([z.literal("all"), z.array(z.uuid()).min(1).max(100)]) });

export const POST = actorRoute({ body }, async ({ actor, body }) => withActor(actor, (tx) => markNotificationsRead(tx, actor, body.ids)));
