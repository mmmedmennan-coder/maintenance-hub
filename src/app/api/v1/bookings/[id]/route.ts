import { z } from "zod";
import { withActor } from "@/server/db/context";
import { actorRoute } from "@/server/http";
import { getBookingDetail } from "@/server/modules/bookings";

/** Shared booking / work-order view: each party gets its role-appropriate projection. */
export const GET = actorRoute({ params: z.object({ id: z.uuid() }) }, async ({ actor, params }) => withActor(actor, (tx) => getBookingDetail(tx, actor, params.id)));
