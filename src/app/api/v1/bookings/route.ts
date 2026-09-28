import { z } from "zod";
import { withActor } from "@/server/db/context";
import { actorRoute } from "@/server/http";
import { listBookings } from "@/server/modules/bookings";

export const GET = actorRoute(
  { orgTypes: ["CUSTOMER", "PROVIDER"], query: z.object({ status: z.string().max(30).optional(), page: z.coerce.number().int().min(1).max(500).default(1) }) },
  async ({ actor, query }) => withActor(actor, (tx) => listBookings(tx, actor, query)),
);
