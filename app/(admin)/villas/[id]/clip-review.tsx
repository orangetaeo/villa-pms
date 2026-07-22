"use client";

// 운영자 영상 클립 (villa-clip-narration P1 + admin-villa-clip-upload) — 업로드·승인·반려·삭제. 다크 테마.
// 승인된 클립만 릴스·쇼츠 소재로 쓰인다(검수 게이트 원칙3) — 여기가 그 게이트다.
// API: POST clips/presign · POST clips · PATCH/DELETE clips/[clipId]. 공급자는 status 변경 403(서버 강제).
// 누수 0: 금액·고객 정보 없음.
//
// ★ 업로드가 여기 있는 이유(2026-07-23): clips API는 운영자를 허용하는데 **화면이 공급자 전용**
//   `/my-villas/[id]/videos` 하나뿐이라(운영자로 열면 /dashboard로 리다이렉트) 테오가 자기 손으로
//   영상을 올릴 방법이 아예 없었다. 검수 카드가 그 자리다.
// ★ 공간(space)은 운영자 화면에서만 받는다 — 나레이션·자막 자동 매칭(captionForPhotoSpace)에
//   물려 소재 품질에 직결된다. 공급자 화면은 "텍스트 입력 최소화" 원칙 때문에 안 받는다.
// ★ 정책값(용량·길이·개수)은 **서버 응답에서만** 읽는다. 하드코딩하면 AppSetting 오버라이드와 어긋난다.
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { PHOTO_SPACES } from "@/lib/villa-schema";
import {
  preflightClipFile,
  remainingClipSlots,
  toClipErrorKey,
  type ClipErrorKey,
  type ClipUploadPolicy,
} from "@/lib/villa-clip-upload";
import { probeLocalVideo, putWithProgress } from "@/lib/video-upload-browser";

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
  space?: string | null;
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

  // ── 업로드 상태 ──
  const [policy, setPolicy] = useState<ClipUploadPolicy | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [uploadErrorKey, setUploadErrorKey] = useState<ClipErrorKey | null>(null);
  const [space, setSpace] = useState("");
  const [note, setNote] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);

  // 정책은 서버가 정본(AppSetting 오버라이드 반영). 실패하면 업로드 UI를 감춘다 —
  // 상한을 모르는 채로 올리게 하면 커밋 단계에서야 거절돼 대용량 업로드를 통째로 버리게 된다.
  useEffect(() => {
    let alive = true;
    fetch(`/api/villas/${villaId}/clips`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { policy?: ClipUploadPolicy }) => {
        if (alive && d?.policy) setPolicy(d.policy);
      })
      .catch(() => {
        /* 정책 미로딩 = 업로드 UI 비표시. 검수 기능은 그대로 동작한다 */
      });
    return () => {
      alive = false;
    };
  }, [villaId]);

  const uploading = progress !== null;
  const remaining = policy ? remainingClipSlots(policy, clips.length) : 0;

  const handleFile = useCallback(
    async (file: File) => {
      if (!policy || uploading) return;
      setUploadErrorKey(null);

      const meta = await probeLocalVideo(file);
      const rejected = preflightClipFile(
        { type: file.type, size: file.size, meta, currentCount: clips.length },
        policy
      );
      if (rejected) {
        setUploadErrorKey(rejected);
        return;
      }

      setProgress(0);
      try {
        const presignRes = await fetch(`/api/villas/${villaId}/clips/presign`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contentType: file.type, sizeBytes: file.size, fileName: file.name }),
        });
        if (!presignRes.ok) {
          const b = (await presignRes.json().catch(() => ({}))) as { error?: string };
          setUploadErrorKey(toClipErrorKey(b.error));
          setProgress(null);
          return;
        }
        const { key, uploadUrl } = (await presignRes.json()) as { key: string; uploadUrl: string };

        await putWithProgress(uploadUrl, file, file.type, setProgress);

        // 커밋 — 서버가 R2 HeadObject + ffprobe로 **실측**한 뒤에야 행이 생긴다.
        const commitRes = await fetch(`/api/villas/${villaId}/clips`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            key,
            ...(space ? { space } : {}),
            ...(note.trim() ? { note: note.trim() } : {}),
          }),
        });
        if (!commitRes.ok) {
          const b = (await commitRes.json().catch(() => ({}))) as { error?: string };
          setUploadErrorKey(toClipErrorKey(b.error));
          setProgress(null);
          return;
        }
        const created = (await commitRes.json()) as ReviewClip;
        setClips((prev) => [...prev, created]);
        setNote("");
        setProgress(null);
        router.refresh();
      } catch {
        setUploadErrorKey("generic");
        setProgress(null);
      }
    },
    [clips.length, note, policy, router, space, uploading, villaId]
  );

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

  return (
    <div className="space-y-3">
      {error && (
        <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">
          {t("error")}
        </p>
      )}

      {/* ── 업로드 (운영자 전용 입력: 공간·메모) ── */}
      {policy && (
        <div className="space-y-2 rounded-lg border border-slate-700 bg-slate-900/40 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={space}
              onChange={(e) => setSpace(e.target.value)}
              disabled={uploading}
              aria-label={t("spaceLabel")}
              className="rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-sm text-slate-100 disabled:opacity-40"
            >
              <option value="">{t("spaceNone")}</option>
              {PHOTO_SPACES.map((s) => (
                <option key={s} value={s}>
                  {t(`space.${s}`)}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={uploading}
              maxLength={300}
              placeholder={t("notePlaceholder")}
              className="min-w-0 flex-1 rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 disabled:opacity-40"
            />
            <input
              ref={fileRef}
              type="file"
              accept="video/mp4,video/quicktime,.mp4,.mov"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = ""; // 같은 파일 재선택도 change가 뜨게
                if (f) void handleFile(f);
              }}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading || remaining === 0}
              className="inline-flex items-center gap-1 rounded bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-500 disabled:opacity-40"
            >
              <span className="material-symbols-outlined text-[16px]">upload</span>
              {uploading ? t("uploading", { pct: progress ?? 0 }) : t("uploadPick")}
            </button>
          </div>

          {uploading && (
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full rounded-full bg-teal-500 transition-all"
                style={{ width: `${progress ?? 0}%` }}
              />
            </div>
          )}

          <p className="text-[11px] text-slate-500">
            {remaining === 0
              ? t("full")
              : t("uploadHint", {
                  mb: Math.round(policy.maxBytes / 1024 / 1024),
                  sec: policy.maxDurationSec,
                  n: remaining,
                })}
          </p>

          {uploadErrorKey && (
            <p role="alert" className="text-xs font-semibold text-red-400">
              {t(`uploadError.${uploadErrorKey}`)}
            </p>
          )}
        </div>
      )}

      {clips.length === 0 && (
        <p className="py-6 text-center text-sm text-slate-500">{t("empty")}</p>
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
                {clip.space && (
                  <span className="rounded bg-slate-700/60 px-1.5 py-0.5 text-[11px] text-slate-300">
                    {t(`space.${clip.space}`)}
                  </span>
                )}
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
