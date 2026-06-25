"use client";

// #1 체크인 종이서류 사진 — 예약 상세(post-checkin) 업로드·열람 섹션.
// 촬영/파일 → POST /api/uploads/passport(kind=paper-doc, doc- 비공개 저장) → PATCH 종이서류 API.
// 썸네일은 ADMIN 가드 서빙(/api/passports/doc-*) — 인증된 상세 화면에서만 표시. 공급자·공개 미노출.
import { useRef, useState } from "react";
import { useTranslations } from "next-intl";

const MAX_DOCS = 30;

interface Props {
  bookingId: string;
  initialUrls: string[];
}

export default function PaperDocsSection({ bookingId, initialUrls }: Props) {
  const t = useTranslations("adminBookings.detail.paperDocs");
  const [urls, setUrls] = useState<string[]>(initialUrls);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function persist(next: string[]) {
    const res = await fetch(`/api/bookings/${bookingId}/checkin/paper-docs`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paperDocUrls: next }),
    });
    if (!res.ok) throw new Error("persist failed");
  }

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const added: string[] = [];
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("kind", "paper-doc");
        const up = await fetch("/api/uploads/passport", { method: "POST", body: fd });
        if (!up.ok) throw new Error("upload failed");
        const { url } = (await up.json()) as { url: string };
        added.push(url);
      }
      const next = [...urls, ...added].slice(0, MAX_DOCS);
      await persist(next);
      setUrls(next);
    } catch {
      setError(t("error"));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function remove(url: string) {
    setBusy(true);
    setError(null);
    const next = urls.filter((u) => u !== url);
    try {
      await persist(next);
      setUrls(next);
    } catch {
      setError(t("error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-admin-card rounded-xl border border-slate-800 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-white">{t("title")}</h3>
        <span className="text-[11px] text-slate-500 tabular-nums">
          {t("count", { n: urls.length, max: MAX_DOCS })}
        </span>
      </div>
      <p className="text-xs text-slate-400 leading-relaxed">{t("hint")}</p>

      {urls.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {urls.map((url) => (
            <div key={url} className="relative aspect-square overflow-hidden rounded-lg border border-slate-700">
              {/* ADMIN 가드 서빙 — 인증된 상세 화면에서만 로드됨(no-store) */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt={t("title")} className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={() => remove(url)}
                disabled={busy}
                aria-label={t("remove")}
                className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white transition-colors hover:bg-red-600 disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-base">close</span>
              </button>
            </div>
          ))}
        </div>
      )}

      <div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          onChange={(e) => onFiles(e.target.files)}
          disabled={busy || urls.length >= MAX_DOCS}
          className="hidden"
          id={`paper-docs-input-${bookingId}`}
        />
        <label
          htmlFor={`paper-docs-input-${bookingId}`}
          className={`flex h-11 w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-700 text-sm font-semibold transition-colors ${
            busy || urls.length >= MAX_DOCS
              ? "cursor-not-allowed text-slate-600"
              : "cursor-pointer text-slate-300 hover:border-admin-primary hover:text-white"
          }`}
        >
          <span className="material-symbols-outlined text-base">photo_camera</span>
          {busy ? t("uploading") : t("upload")}
        </label>
      </div>

      {error && (
        <p className="rounded-lg bg-red-950/50 px-3 py-2 text-xs font-medium text-red-300" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
