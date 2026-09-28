import { NextResponse } from "next/server";
import { z } from "zod";
import { withActor } from "@/server/db/context";
import { actorRoute } from "@/server/http";
import { auditAdminView } from "@/server/modules/admin";
import { authorizeDownload } from "@/server/modules/documents";
import { getStorage } from "@/server/storage";

/**
 * Authorizes the download under row-level security first, then either streams the private
 * object (local storage) or redirects to a 60-second signed URL (S3).
 */
export const GET = actorRoute({ params: z.object({ id: z.uuid() }), query: z.object({ inline: z.enum(["0", "1"]).optional() }) }, async ({ actor, params, query }) => {
  const doc = await withActor(actor, async (tx) => {
    const d = await authorizeDownload(tx, params.id);
    await auditAdminView(tx, actor, "document", d.id);
    return d;
  });
  const inline = query.inline === "1";
  const storage = getStorage();
  if (storage.signedUrl) {
    return NextResponse.redirect(await storage.signedUrl(doc.storageKey, doc.originalName, inline, 60), 302);
  }
  const data = await storage.get(doc.storageKey);
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": doc.mimeType!,
      "Content-Length": String(data.length),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(doc.originalName)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    },
  });
});
