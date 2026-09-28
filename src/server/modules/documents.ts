import "server-only";
import { randomUUID } from "node:crypto";
import { fileTypeFromBuffer } from "file-type";
import type { z } from "zod";
import type { DocumentKind, DocumentVisibility } from "@/generated/prisma/client";
import type { uploadInitSchema } from "@/lib/schemas";
import { type Actor, can } from "@/server/auth/roles";
import type { Tx } from "@/server/db/context";
import { DomainError, forbidden, invalidTransition, notFound, validation } from "@/server/errors";
import { sha256Hex } from "@/server/lib/hash";
import { audit } from "@/server/lib/infra";
import { getStorage } from "@/server/storage";
import { technicianIdForActor } from "./technicians";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_FILES_PER_TARGET = 12;
const MAX_UPLOADS_PER_HOUR = 60;

const ALLOWED: Record<string, { ext: string; kinds: DocumentKind[] }> = {
  "image/jpeg": { ext: "jpg", kinds: ["PHOTO", "ATTACHMENT", "PAYMENT_EVIDENCE"] },
  "image/png": { ext: "png", kinds: ["PHOTO", "ATTACHMENT", "PAYMENT_EVIDENCE"] },
  "image/webp": { ext: "webp", kinds: ["PHOTO", "ATTACHMENT", "PAYMENT_EVIDENCE"] },
  "application/pdf": { ext: "pdf", kinds: ["ATTACHMENT", "PAYMENT_EVIDENCE"] },
};

/** Keeps a readable, harmless display name; the storage key is always opaque. */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "fichier";
  const cleaned = base
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N} ._()-]/gu, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return cleaned || "fichier";
}

/**
 * Step 1: declare an upload. Validates the target relationship and the actor's right to
 * attach files to it, then records a PENDING document with an opaque storage key.
 */
export async function initUpload(tx: Tx, actor: Actor, input: z.output<typeof uploadInitSchema>) {
  const targets = [input.requestId, input.workOrderId, input.equipmentId].filter(Boolean);
  if (targets.length !== 1) throw validation("Cible invalide.", { target: ["Indiquez exactement une cible (demande, intervention ou équipement)."] });
  const hourAgo = new Date(Date.now() - 3600_000);
  const recent = await tx.document.count({ where: { uploadedById: actor.userId, createdAt: { gt: hourAgo } } });
  if (recent >= MAX_UPLOADS_PER_HOUR) throw new DomainError("RATE_LIMITED", "Trop de fichiers envoyés récemment. Réessayez plus tard.");

  let data: {
    customerOrgId: string | null;
    providerOrgId: string | null;
    requestId?: string;
    workOrderId?: string;
    equipmentId?: string;
    visibility: DocumentVisibility;
  };
  if (input.requestId) {
    if (!can.customerWrite(actor)) throw forbidden();
    const request = await tx.serviceRequest.findFirst({ where: { id: input.requestId, customerOrgId: actor.orgId } });
    if (!request) throw notFound("Demande");
    if (!["DRAFT", "OPEN"].includes(request.status)) throw invalidTransition("Les pièces jointes sont modifiables tant que la demande est ouverte.");
    data = {
      customerOrgId: actor.orgId,
      providerOrgId: null,
      requestId: request.id,
      visibility: input.shareWithProviders ? "QUOTING_SHARED" : "OWNER_ONLY",
    };
  } else if (input.workOrderId) {
    const wo = await tx.workOrder.findUnique({ where: { id: input.workOrderId } });
    if (!wo) throw notFound("Intervention");
    if (wo.providerOrgId === actor.orgId) {
      if (can.technician(actor)) {
        const techId = await technicianIdForActor(tx, actor);
        if (techId !== wo.technicianId) throw notFound("Intervention");
      } else if (!can.providerManage(actor)) throw forbidden();
    } else if (wo.customerOrgId === actor.orgId) {
      if (!can.customerWrite(actor)) throw forbidden();
    } else throw notFound("Intervention");
    if (wo.status === "CANCELLED") throw invalidTransition("Intervention annulée.");
    data = {
      customerOrgId: wo.customerOrgId,
      providerOrgId: wo.providerOrgId,
      workOrderId: wo.id,
      visibility: input.shareWithProviders || wo.providerOrgId === actor.orgId ? "SHARED_PARTIES" : "OWNER_ONLY",
    };
  } else {
    if (!can.customerWrite(actor)) throw forbidden();
    const equipment = await tx.equipment.findFirst({ where: { id: input.equipmentId!, customerOrgId: actor.orgId } });
    if (!equipment) throw notFound("Équipement");
    data = { customerOrgId: actor.orgId, providerOrgId: null, equipmentId: equipment.id, visibility: "OWNER_ONLY" };
  }
  if (input.kind === "PAYMENT_EVIDENCE" && !input.workOrderId) {
    throw validation("Cible invalide.", { kind: ["Un justificatif de paiement se rattache à une intervention."] });
  }
  const count = await tx.document.count({
    where: {
      ...(data.requestId ? { requestId: data.requestId } : data.workOrderId ? { workOrderId: data.workOrderId } : { equipmentId: data.equipmentId }),
      status: { in: ["PENDING", "READY"] },
    },
  });
  if (count >= MAX_FILES_PER_TARGET) throw validation("Trop de fichiers.", { file: [`${MAX_FILES_PER_TARGET} fichiers maximum.`] });

  const now = new Date();
  const storageKey = `docs/${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}`;
  const doc = await tx.document.create({
    data: {
      ownerOrgId: actor.orgId,
      uploadedById: actor.userId,
      kind: input.kind,
      storageKey,
      originalName: sanitizeFileName(input.fileName),
      ...data,
    },
    select: { id: true },
  });
  return { documentId: doc.id, uploadUrl: `/api/v1/documents/${doc.id}/content`, maxBytes: MAX_UPLOAD_BYTES };
}

/**
 * Step 2: receive content. Verifies ownership, size and the ACTUAL file signature (not the
 * browser MIME type or extension), stores the object privately, then marks it READY.
 * Invalid content marks the document FAILED so the interface can show it as not saved.
 */
export type FinalizeResult =
  | { ok: true; documentId: string; status: "READY"; mimeType: string; sizeBytes: number }
  | { ok: false; error: DomainError };

export async function finalizeUpload(tx: Tx, actor: Actor, documentId: string, content: Buffer): Promise<FinalizeResult> {
  const doc = await tx.document.findFirst({ where: { id: documentId, ownerOrgId: actor.orgId, uploadedById: actor.userId } });
  if (!doc) throw notFound("Document");
  if (doc.status !== "PENDING") throw invalidTransition("Ce fichier a déjà été traité.");
  // Failures are persisted (FAILED) and returned, not thrown, so the status survives the commit.
  const fail = async (reason: string, error: DomainError): Promise<FinalizeResult> => {
    await tx.document.update({ where: { id: doc.id }, data: { status: "FAILED", failureReason: reason } });
    return { ok: false, error };
  };
  if (content.length === 0) return fail("empty", validation("Fichier vide."));
  if (content.length > MAX_UPLOAD_BYTES) return fail("too_large", new DomainError("PAYLOAD_TOO_LARGE", "Fichier trop volumineux (10 Mo maximum)."));
  const detected = await fileTypeFromBuffer(content);
  const allowed = detected ? ALLOWED[detected.mime] : undefined;
  if (!detected || !allowed || !allowed.kinds.includes(doc.kind)) {
    return fail(
      "unsupported_type",
      new DomainError("UNSUPPORTED_MEDIA_TYPE", doc.kind === "PHOTO" ? "Formats acceptés : JPEG, PNG ou WebP." : "Formats acceptés : JPEG, PNG, WebP ou PDF."),
    );
  }
  await getStorage().put(doc.storageKey, content, detected.mime);
  await tx.document.update({
    where: { id: doc.id },
    data: { status: "READY", mimeType: detected.mime, sizeBytes: content.length, sha256: sha256Hex(content), finalizedAt: new Date() },
  });
  return { ok: true, documentId: doc.id, status: "READY", mimeType: detected.mime, sizeBytes: content.length };
}

export async function markUploadFailed(tx: Tx, actor: Actor, documentId: string, reason: string) {
  await tx.document.updateMany({
    where: { id: documentId, ownerOrgId: actor.orgId, uploadedById: actor.userId, status: "PENDING" },
    data: { status: "FAILED", failureReason: reason.slice(0, 100) },
  });
}

/** Removes a file that is not part of a submitted record (issued quote, report, payment). */
export async function deleteDocument(tx: Tx, actor: Actor, documentId: string) {
  const doc = await tx.document.findFirst({ where: { id: documentId, ownerOrgId: actor.orgId } });
  if (!doc) throw notFound("Document");
  if (doc.reportId || doc.paymentId || doc.kind === "REPORT_PDF" || doc.kind === "QUOTE_PDF") {
    throw invalidTransition("Ce fichier fait partie d'un dossier soumis et ne peut pas être supprimé.");
  }
  if (can.technician(actor) && doc.uploadedById !== actor.userId) throw forbidden();
  if (doc.requestId) {
    const request = await tx.serviceRequest.findUnique({ where: { id: doc.requestId }, select: { status: true } });
    if (request && !["DRAFT", "OPEN"].includes(request.status)) throw invalidTransition("La demande n'est plus modifiable.");
  }
  await tx.document.update({ where: { id: doc.id }, data: { status: "DELETED", deletedAt: new Date() } });
  await audit(tx, actor, { action: "document.deleted", targetType: "document", targetId: doc.id });
  return doc.storageKey;
}

/**
 * Authorization for downloads: the row is only visible if row-level security allows it
 * for the current actor (owner, party with shared scope, invited provider for quoting
 * attachments, or administrator for non-private scopes).
 */
export async function authorizeDownload(tx: Tx, documentId: string) {
  const doc = await tx.document.findFirst({
    where: { id: documentId, status: "READY" },
    select: { id: true, storageKey: true, mimeType: true, originalName: true, kind: true, visibility: true, ownerOrgId: true },
  });
  if (!doc || !doc.mimeType) throw notFound("Document");
  return doc;
}
