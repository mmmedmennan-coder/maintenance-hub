"use client";

import { Camera, CircleCheck, CircleX, Paperclip, RotateCcw, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { ApiError, api } from "@/lib/api-client";
import { t } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";

type Target = { requestId?: string; workOrderId?: string; equipmentId?: string };
type Item = {
  key: string;
  file: File;
  state: "queued" | "uploading" | "saved" | "failed";
  progress: number;
  error?: string;
  documentId?: string;
};

const MAX = 10 * 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

function putWithProgress(url: string, file: File, onProgress: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      let message = t("upload.failed");
      try {
        message = JSON.parse(xhr.responseText)?.error?.message ?? message;
      } catch {
        /* keep default */
      }
      reject(new ApiError("UPLOAD", message, xhr.status));
    };
    xhr.onerror = () => reject(new ApiError("NETWORK", t("upload.network")));
    xhr.send(file);
  });
}

/**
 * Private upload with real progress. A file is shown as "saved" only after the server
 * verified and stored it; failures stay visible (never silently dropped) with a retry.
 */
export function DocumentUploader({
  target,
  kind = "PHOTO",
  allowShare = false,
  defaultShare = true,
  onSaved,
  label,
  refreshOnSave = true,
}: {
  target: Target;
  kind?: "PHOTO" | "ATTACHMENT" | "PAYMENT_EVIDENCE";
  allowShare?: boolean;
  defaultShare?: boolean;
  onSaved?: (documentId: string, file: File) => void;
  label?: string;
  refreshOnSave?: boolean;
}) {
  const router = useRouter();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [share, setShare] = useState(defaultShare);
  const accept = kind === "PHOTO" ? IMAGE_TYPES.join(",") : [...IMAGE_TYPES, "application/pdf"].join(",");
  const update = (key: string, patch: Partial<Item>) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...patch } : i)));

  const upload = async (item: Item) => {
    update(item.key, { state: "uploading", progress: 0, error: undefined });
    if (item.file.size > MAX) return update(item.key, { state: "failed", error: t("upload.tooLarge") });
    if (!accept.split(",").includes(item.file.type)) return update(item.key, { state: "failed", error: kind === "PHOTO" ? t("upload.onlyImages") : t("upload.onlyImagesPdf") });
    try {
      const init = await api<{ documentId: string; uploadUrl: string }>("/api/v1/documents", {
        body: { kind, fileName: item.file.name, sizeBytes: item.file.size, ...target, shareWithProviders: allowShare ? share : false },
      });
      await putWithProgress(init.uploadUrl, item.file, (pct) => update(item.key, { progress: pct }));
      update(item.key, { state: "saved", progress: 100, documentId: init.documentId });
      onSaved?.(init.documentId, item.file);
      if (refreshOnSave) router.refresh();
    } catch (e) {
      update(item.key, { state: "failed", error: e instanceof Error ? e.message : t("upload.failed") });
    }
  };

  const onFiles = (files: FileList | null) => {
    if (!files?.length) return;
    const added = Array.from(files).map((file) => ({ key: `${file.name}-${file.size}-${Math.random()}`, file, state: "queued" as const, progress: 0 }));
    setItems((list) => [...list, ...added]);
    added.forEach((item) => void upload(item));
    if (inputRef.current) inputRef.current.value = "";
  };

  const Icon = kind === "PHOTO" ? Camera : Paperclip;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor={inputId} className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-lg border border-dashed border-brand bg-brand-soft px-4 text-sm font-semibold text-brand-ink hover:bg-[#d2ece7] focus-within:outline focus-within:outline-3 focus-within:outline-brand">
          <Icon aria-hidden className="size-4" />
          {label ?? (kind === "PHOTO" ? t("upload.addPhotos") : t("upload.addFiles"))}
          <input
            ref={inputRef}
            id={inputId}
            type="file"
            multiple
            accept={accept}
            capture={kind === "PHOTO" ? "environment" : undefined}
            className="sr-only"
            onChange={(e) => onFiles(e.target.files)}
          />
        </label>
        <span className="text-xs text-muted">{kind === "PHOTO" ? t("upload.hintPhotos") : t("upload.hintFiles")}</span>
      </div>
      {allowShare ? (
        <label className="flex items-start gap-2 text-sm text-ink-soft">
          <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-brand)]" checked={share} onChange={(e) => setShare(e.target.checked)} />
          {t("upload.shareWithProviders")}
        </label>
      ) : null}
      {items.length ? (
        <ul className="space-y-2" aria-live="polite">
          {items.map((item) => (
            <li key={item.key} className={cn("rounded-lg border px-3 py-2 text-sm", item.state === "failed" ? "border-danger-line bg-danger-soft" : "border-line bg-surface")}>
              <div className="flex items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2">
                  {item.state === "saved" ? <CircleCheck aria-hidden className="size-4 shrink-0 text-success" /> : item.state === "failed" ? <CircleX aria-hidden className="size-4 shrink-0 text-danger" /> : <Upload aria-hidden className="size-4 shrink-0 text-muted" />}
                  <span className="truncate">{item.file.name}</span>
                </span>
                <span className={cn("shrink-0 text-xs font-semibold", item.state === "failed" ? "text-danger" : item.state === "saved" ? "text-success" : "text-muted")}>
                  {item.state === "saved" ? t("upload.saved") : item.state === "failed" ? t("upload.notSaved") : t("upload.sending", { pct: item.progress })}
                </span>
              </div>
              {item.state === "uploading" || item.state === "queued" ? (
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={item.progress} aria-label={t("upload.progressLabel", { name: item.file.name })}>
                  <div className="h-full bg-brand transition-[width]" style={{ width: `${item.progress}%` }} />
                </div>
              ) : null}
              {item.state === "failed" ? (
                <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                  <p role="alert" className="text-danger">
                    {item.error}
                  </p>
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" icon={<RotateCcw aria-hidden className="size-3.5" />} onClick={() => upload(item)}>
                      {t("upload.retry")}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setItems((l) => l.filter((i) => i.key !== item.key))}>
                      {t("common.remove")}
                    </Button>
                  </div>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
