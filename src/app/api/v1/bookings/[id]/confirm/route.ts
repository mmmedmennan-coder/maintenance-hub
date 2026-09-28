import { z } from "zod";
import { confirmBookingSchema } from "@/lib/schemas";
import { runIdempotent } from "@/server/api";
import { actorRoute } from "@/server/http";
import { confirmBooking } from "@/server/modules/bookings";

/** Provider assigns a technician and commits a conflict-free slot (SLOT_CONFLICT on overlap). */
export const POST = actorRoute(
  { orgTypes: ["PROVIDER"], roles: ["provider_owner", "provider_dispatcher"], params: z.object({ id: z.uuid() }), body: confirmBookingSchema },
  async ({ actor, params, body, idempotencyKey }) => runIdempotent(actor, "booking.confirm", idempotencyKey, { id: params.id, ...body }, (tx) => confirmBooking(tx, actor, params.id, body)),
);
