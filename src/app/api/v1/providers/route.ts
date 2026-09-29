import { z } from "zod";
import { availabilitySearchDate } from "@/lib/schemas";
import { withPublic } from "@/server/db/context";
import { publicRoute } from "@/server/http";
import { searchProviders } from "@/server/modules/providers";

const query = z.object({
  q: z.string().max(80).optional(),
  city: z.string().max(80).optional(),
  categoryId: z.uuid().optional(),
  serviceAreaId: z.uuid().optional(),
  weekday: z.coerce.number().int().min(1).max(7).optional(),
  /** YYYY-MM-DD, today to +90 days: providers declaring an active technician available that day (provisional). */
  date: availabilitySearchDate.optional(),
  page: z.coerce.number().int().min(1).max(500).default(1),
});

/** Public, approved-only provider search (no contact details, no private documents). */
export const GET = publicRoute({ query }, async ({ query }) => withPublic((tx) => searchProviders(tx, query)));
