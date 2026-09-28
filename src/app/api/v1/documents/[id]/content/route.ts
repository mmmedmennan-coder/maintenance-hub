import { z } from "zod";
import { requireApiActor } from "@/server/auth/session";
import { withActor } from "@/server/db/context";
import { DomainError } from "@/server/errors";
import { assertSameOrigin, errorResponse, json } from "@/server/http";
import { MAX_UPLOAD_BYTES, finalizeUpload, markUploadFailed } from "@/server/modules/documents";

export const dynamic = "force-dynamic";

async function readCapped(request: Request): Promise<Buffer> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_UPLOAD_BYTES) throw new DomainError("PAYLOAD_TOO_LARGE", "Fichier trop volumineux (10 Mo maximum).");
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_UPLOAD_BYTES) {
      await reader.cancel();
      throw new DomainError("PAYLOAD_TOO_LARGE", "Fichier trop volumineux (10 Mo maximum).");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** Step 2: raw file body. The server verifies the actual file signature before storing it. */
export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireApiActor(request);
    const { id } = z.object({ id: z.uuid() }).parse(await context.params);
    let content: Buffer;
    try {
      content = await readCapped(request);
    } catch (error) {
      await withActor(actor, (tx) => markUploadFailed(tx, actor, id, "too_large"));
      throw error;
    }
    const result = await withActor(actor, (tx) => finalizeUpload(tx, actor, id, content), { timeoutMs: 30_000 });
    if (!result.ok) return errorResponse(result.error);
    return json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
