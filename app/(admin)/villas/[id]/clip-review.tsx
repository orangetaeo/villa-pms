"use client";

// 운영자 영상 클립 검수 (villa-clip-narration P1) — 승인·반려·삭제. 다크 테마.
// 승인된 클립만 릴스·쇼츠 소재로 쓰인다(검수 게이트 원칙3) — 여기가 그 게이트다.
// API: PATCH/DELETE /api/villas/[id]/clips/[clipId]. 공급자는 status 변경 403(서버 강제).
// 누수 0: 금액·고객 정보 없음.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

export interface ReviewClip {
  id: string;
  url: string;
  durationSec: number;
  sizeBytes: number;
  width: number;
  height: number;
  status: "UPLOADING" | "UPLOADED" | "APPROVED" | "REJECTED";
  rejectionReason: string | null;
  note: string | null;
  createdAt: string;
}

export default function ClipReview({
  villaId,
  initialClips,
}: {
  villaId: string;
  initialClips: ReviewClip[];
}) {
  const t = useTranslations("adminVillas.detail.clips");
  const router = useRouter();

  const [clips, setClips] = useState<ReviewClip[]>(initialClips);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState(false);

  async function patch(clipId: string, body: Record<string, unknown>) {
    setBusyId(clipId);
    setError(false);
    try {
      const res = await fetch(`/api/villas/${villaId}/clips/${clipId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("patch failed");
      const updated = (await res.json()) as ReviewClip;
      setClips((prev) => prev.map((c) => (c.id === clipId ? { ...c, ...updated } : c)));
      router.refresh();
    } catch {
      setError(true);
    } finally {
      setBusyId(null);
    }
  }

  async function remove(clipId: string) {
    setBusyId(clipId);
    setError(false);
    try {
      const res = await fetch(`/api/villas/${villaId}/clips/${clipId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("delete failed");
      setClips((prev) => prev.filter((c) => c.id !== clipId));
      router.refresh();
    } catch {
      setError(true);
    } finally {
      setBusyId(null);
    }
  }

  function submitReject(clipId: string) {
    const trimmed = reason.trim();
    setRejectingId(null);
    setReason("");
    void patch(clipId, { status: "REJECTED", rejectionReason: trimmed || undefined });
  }

  if (clips.length === 0) {
    return <p className="py-6 text-center text-sm text-slate-500">{t("empty")}</p>;
  }

  return (
    <div className="space-y-3">
      {error && (
        <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">
          {t("error")}
        </p>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {clips.map((clip) => (
          <div
            key={clip.id}
            className="flex gap-3 rounded-lg border border-slate-700 bg-slate-800/60 p-3"
          >
            {/* preload=metadata — 목록에서 전체 파일을 내려받지 않는다 */}
            <video
              src={clip.url}
              preload="metadata"
              controls
              playsInline
              className="h-32 w-20 shrink-0 rounded bg-black object-cover"
            />
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex items-center gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                    clip.status === "APPROVED"
                      ? "bg-teal-500/15 text-teal-300"
                      : clip.status === "REJECTED"
                        ? "bg-red-500/15 text-red-300"
                        : "bg-amber-500/15 text-amber-300"
                  }`}
                >
                  {t(`status.${clip.status}`)}
                </span>
                <span className="text-xs text-slate-400">
                  {clip.durationSec}s · {Math.round(clip.sizeBytes / 1024 / 1024)}MB ·{" "}
                  {clip.width}×{clip.height}
                </span>
              </div>

              {clip.note && <p className="mt-1 truncate text-xs text-slate-400">{clip.note}</p>}
              {clip.status === "REJECTED" && clip.rejectionReason && (
                <p className="mt-1 text-xs text-red-400">{clip.rejectionReason}</p>
              )}

              {rejectingId === clip.id ? (
                <div className="mt-auto pt-2">
                  <input
                    type="text"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    maxLength={300}
                    placeholder={t("reasonPlaceholder")}
                    className="w-full rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-sm text-slate-100 placeholder:text-slate-500"
                  />
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => submitReject(clip.id)}
                      className="rounded bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-500"
                    >
                      {t("reject")}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setRejectingId(null);
                        setReason("");
                      }}
                      className="rounded border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-300"
                    >
                      {t("cancel")}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-auto flex flex-wrap gap-2 pt-2">
                  {clip.status !== "APPROVED" && (
                    <button
                      type="button"
                      disabled={busyId === clip.id}
                      onClick={() => void patch(clip.id, { status: "APPROVED" })}
                      className="rounded bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-500 disabled:opacity-40"
                    >
                      {t("approve")}
                    </button>
                  )}
                  {clip.status !== "REJECTED" && (
                    <button
                      type="button"
                      disabled={busyId === clip.id}
                      onClick={() => setRejectingId(clip.id)}
                      className="rounded border border-red-500/50 px-3 py-1.5 text-xs font-semibold text-red-300 hover:bg-red-500/10 disabled:opacity-40"
                    >
                      {t("reject")}
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busyId === clip.id}
                    onClick={() => void remove(clip.id)}
                    className="rounded border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-700 disabled:opacity-40"
                  >
                    {t("delete")}
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
