import { z } from "zod";
import { withActor } from "@/server/db/context";
import { actorRoute } from "@/server/http";
import { getCalendar } from "@/server/modules/technicians";

const query = z.object({ week: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), technicianId: z.uuid().optional() });

/** Week calendar (local Africa/Casablanca week start): reservations, windows, time off. */
export const GET = actorRoute({ orgTypes: ["PROVIDER"], query }, async ({ actor, query }) => withActor(actor, (tx) => getCalendar(tx, actor, query.week, query.technicianId)));
