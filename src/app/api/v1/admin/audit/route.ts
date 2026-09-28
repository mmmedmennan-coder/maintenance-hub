import { z } from "zod";
import { withActor } from "@/server/db/context";
import { actorRoute } from "@/server/http";
import { listAuditEvents } from "@/server/modules/admin";

const query = z.object({ targetType: z.string().max(60).optional(), targetId: z.string().max(64).optional(), page: z.coerce.number().int().min(1).max(1000).default(1) });

export const GET = actorRoute({ orgTypes: ["PLATFORM"], roles: ["platform_admin"], query }, async ({ actor, query }) => withActor(actor, (tx) => listAuditEvents(tx, actor, query)));
