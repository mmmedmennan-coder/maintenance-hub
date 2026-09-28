import { z } from "zod";
import { withPublic } from "@/server/db/context";
import { publicRoute } from "@/server/http";
import { getPublicProvider } from "@/server/modules/providers";

export const GET = publicRoute(
  { params: z.object({ slug: z.string().regex(/^[a-z0-9-]{1,80}$/) }), query: z.object({ reviewPage: z.coerce.number().int().min(1).max(500).default(1) }) },
  async ({ params, query }) => withPublic((tx) => getPublicProvider(tx, params.slug, query.reviewPage)),
);
