import { z } from "zod";
import { reportSchema } from "@/lib/schemas";
import { runIdempotent } from "@/server/api";
import { actorRoute } from "@/server/http";
import { submitReport } from "@/server/modules/work";

export const POST = actorRoute({ orgTypes: ["PROVIDER"], params: z.object({ id: z.uuid() }), body: reportSchema }, async ({ actor, params, body, idempotencyKey }) =>
  runIdempotent(actor, "report.submit", idempotencyKey, { id: params.id, ...body }, (tx) => submitReport(tx, actor, params.id, body)),
);
