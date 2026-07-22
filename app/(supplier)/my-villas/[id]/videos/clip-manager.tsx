"use client";

// 공급자 영상 클립 매니저 (villa-clip-narration P1) — 촬영/갤러리 업로드 · 목록 · 삭제.
//
// 업로드 3단계: ① presign(POST clips/presign) ② 브라우저→R2 직접 PUT(진행률) ③ 커밋(POST clips).
//   서버를 경유하지 않으므로 대용량도 안전하지만, **실측 검증은 커밋 단계 서버가 한다**.
//
// ★ 베트남 사용자 UX: 텍스트 입력 0 · 버튼 2개(촬영/갤러리) · 진행률 표시 · 실패 시 재시도 안내.
// ★ 모바일 데이터 절약: 업로드 **전에** 클라에서 길이·크기를 먼저 검사해 위반 파일은 올리지 않는다.
//   단 브라우저가 메타데이터를 못 읽으면(iOS .mov HEVC 등) 통과시키고 서버 판정에 맡긴다 — 과잉 거절 방지.
// ★ 누수 0: 금액·고객 정보 없음.
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
// 업로드 인프라는 운영자 화면과 공용 — 같은 코드를 두 벌 두면 한쪽만 고쳐지는 사고가 난다.
import { probeLocalVideo, putWithProgress } from "@/lib/video-upload-browser";

export interface ManagedClip {
  id: string;
  url: string;
  durationSec: number;
  sizeBytes: number;
  width: number;
  height: number;
  status: "UPLOADED" | "APPROVED" | "REJECTED" | "UPLOADING";
  rejectionReason: string | null;
  createdAt: string;
}

export interface ClipPolicy {
  maxBytes: number;
  maxDurationSec: number;
  maxPerVilla: number;
}

type ErrorKey =
  | "TOO_LARGE"
  | "TOO_LONG"
  | "TOO_SHORT"
  | "RESOLUTION_TOO_LOW"
  | "QUOTA_EXCEEDED"
  | "DISALLOWED_TYPE"
  | "generic";

const ALLOWED_MIME = ["video/mp4", "video/quicktime"];

// ★ 사전에 있는 오류코드만 그대로 쓴다(QA L-8). 서버는 UPLOAD_NOT_FOUND_OR_INVALID·INVALID_KEY·
//   R2_NOT_CONFIGURED·ALREADY_COMMITTED 등도 반환하는데, 그대로 t()에 넣으면
//   베트남 공급자 화면에 **원시 키**가 그대로 보인다([[all-pages-vietnamese-required]] 동일 클래스).
const KNOWN_ERRORS: string[] = [
  "TOO_LARGE",
  "TOO_LONG",
  "TOO_SHORT",
  "RESOLUTION_TOO_LOW",
  "QUOTA_EXCEEDED",
  "DISALLOWED_TYPE",
];
function toErrorKey(code: string | undefined): ErrorKey {
  return code && KNOWN_ERRORS.includes(code) ? (code as ErrorKey) : "generic";
}


export default function ClipManager({
  villaId,
  initialClips,
  policy,
  /** 등록 직후 온보딩 모드 — "나중에 하기"로 빌라 상세로 빠질 수 있게 */
  onboarding = false,
}: {
  villaId: string;
  initialClips: ManagedClip[];
  policy: ClipPolicy;
  onboarding?: boolean;
}) {
  const t = useTranslations("clipManage");
  const router = useRouter();

  const [clips, setClips] = useState<ManagedClip[]>(initialClips);
  const [progress, setProgress] = useState<number | null>(null);
  const [errorKey, setErrorKey] = useState<ErrorKey | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ManagedClip | null>(null);

  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  const uploading = progress !== null;
  const remaining = Math.max(0, policy.maxPerVilla - clips.length);
  const full = remaining === 0;

  async function handleFile(file: File) {
    if (uploading) return;
    setErrorKey(null);

    // ① 타입 — 확장자만 바꾼 위장도 여기서 대부분 걸린다(최종 판정은 서버 ffprobe).
    if (!ALLOWED_MIME.includes(file.type)) {
      setErrorKey("DISALLOWED_TYPE");
      return;
    }
    // ② 크기 — 업로드 시작 전에 거절해 모바일 데이터 낭비 방지
    if (file.size > policy.maxBytes) {
      setErrorKey("TOO_LARGE");
      return;
    }
    // ③ 길이 — 브라우저가 읽을 수 있을 때만 판정
    const meta = await probeLocalVideo(file);
    if (meta && meta.durationSec > policy.maxDurationSec + 0.5) {
      setErrorKey("TOO_LONG");
      return;
    }

    setProgress(0);
    try {
      const presignRes = await fetch(`/api/villas/${villaId}/clips/presign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contentType: file.type,
          sizeBytes: file.size,
          fileName: file.name,
        }),
      });
      if (!presignRes.ok) {
        const body = (await presignRes.json().catch(() => ({}))) as { error?: string };
        setErrorKey(toErrorKey(body.error));
        setProgress(null);
        return;
      }
      const { key, uploadUrl } = (await presignRes.json()) as { key: string; uploadUrl: string };

      await putWithProgress(uploadUrl, file, file.type, setProgress);

      // ④ 커밋 — 서버가 R2 실측(HeadObject + ffprobe) 후 행 생성
      const commitRes = await fetch(`/api/villas/${villaId}/clips`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });
      if (!commitRes.ok) {
        const body = (await commitRes.json().catch(() => ({}))) as { error?: string };
        setErrorKey(toErrorKey(body.error));
        setProgress(null);
        return;
      }
      const created = (await commitRes.json()) as ManagedClip;
      setClips((prev) => [...prev, created]);
      setProgress(null);
      router.refresh();
    } catch {
      setErrorKey("generic");
      setProgress(null);
    }
  }

  async function removeClip(clip: ManagedClip) {
    setConfirmDelete(null);
    setBusyId(clip.id);
    setErrorKey(null);
    try {
      const res = await fetch(`/api/villas/${villaId}/clips/${clip.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("delete failed");
      setClips((prev) => prev.filter((c) => c.id !== clip.id));
      router.refresh();
    } catch {
      setErrorKey("generic");
    } finally {
      setBusyId(null);
    }
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // 같은 파일 재선택이 먹도록 값 초기화
    e.target.value = "";
    if (file) void handleFile(file);
  }

  return (
    <div className="px-4 pb-28 pt-4">
      {/* 안내 — 텍스트 최소, 숫자 중심 */}
      <p className="text-sm leading-relaxed text-neutral-600">{t("intro")}</p>
      <ul className="mt-3 space-y-1 rounded-xl bg-teal-50 p-3 text-sm text-teal-900">
        <li>• {t("ruleDuration", { sec: policy.maxDurationSec })}</li>
        <li>• {t("ruleCount", { n: policy.maxPerVilla })}</li>
        <li>• {t("ruleWifi")}</li>
      </ul>

      {/* 업로드 버튼 2개 — 촬영 / 갤러리 */}
      <input
        ref={cameraRef}
        type="file"
        accept="video/mp4,video/quicktime"
        capture="environment"
        className="hidden"
        onChange={onPick}
      />
      <input
        ref={galleryRef}
        type="file"
        accept="video/mp4,video/quicktime"
        className="hidden"
        onChange={onPick}
      />
      <div className="mt-4 grid grid-cols-2 gap-3">
        <button
          type="button"
          disabled={uploading || full}
          onClick={() => cameraRef.current?.click()}
          className="flex h-24 flex-col items-center justify-center gap-1 rounded-2xl bg-teal-600 text-white shadow-sm transition-transform active:scale-95 disabled:opacity-40"
        >
          <span className="material-symbols-outlined text-3xl">videocam</span>
          <span className="text-sm font-semibold">{t("record")}</span>
        </button>
        <button
          type="button"
          disabled={uploading || full}
          onClick={() => galleryRef.current?.click()}
          className="flex h-24 flex-col items-center justify-center gap-1 rounded-2xl border-2 border-teal-600 bg-white text-teal-700 shadow-sm transition-transform active:scale-95 disabled:opacity-40"
        >
          <span className="material-symbols-outlined text-3xl">video_library</span>
          <span className="text-sm font-semibold">{t("pick")}</span>
        </button>
      </div>

      {full && <p className="mt-3 text-sm text-neutral-500">{t("full", { n: policy.maxPerVilla })}</p>}

      {/* 업로드 진행률 */}
      {uploading && (
        <div className="mt-4 rounded-xl border border-neutral-200 bg-white p-3">
          <div className="flex items-center justify-between text-sm font-medium text-neutral-700">
            <span>{t("uploading")}</span>
            <span>{progress}%</span>
          </div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-neutral-100">
            <div
              className="h-full rounded-full bg-teal-600 transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-neutral-500">{t("uploadingHint")}</p>
        </div>
      )}

      {errorKey && (
        <p
          role="alert"
          className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-medium text-red-700"
        >
          {t(`error.${errorKey}`, {
            sec: policy.maxDurationSec,
            mb: Math.round(policy.maxBytes / 1024 / 1024),
            n: policy.maxPerVilla,
          })}
        </p>
      )}

      {/* 목록 */}
      <h2 className="mt-6 text-sm font-bold text-neutral-900">
        {t("listTitle", { count: clips.length, max: policy.maxPerVilla })}
      </h2>
      {clips.length === 0 ? (
        <p className="mt-2 rounded-xl bg-neutral-50 p-4 text-center text-sm text-neutral-500">
          {t("empty")}
        </p>
      ) : (
        <ul className="mt-2 space-y-3">
          {clips.map((clip) => (
            <li
              key={clip.id}
              className="flex items-center gap-3 rounded-2xl border border-neutral-200 bg-white p-3"
            >
              {/* preload=metadata — 목록에서 전체 파일을 받지 않는다(데이터 절약) */}
              <video
                src={clip.url}
                preload="metadata"
                controls
                playsInline
                className="h-24 w-16 rounded-lg bg-black object-cover"
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-neutral-900">
                  {t("duration", { sec: clip.durationSec })}
                </p>
                <p className="mt-0.5 text-xs text-neutral-500">
                  {Math.round(clip.sizeBytes / 1024 / 1024)}MB · {clip.width}×{clip.height}
                </p>
                <span
                  className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${
                    clip.status === "APPROVED"
                      ? "bg-teal-100 text-teal-800"
                      : clip.status === "REJECTED"
                        ? "bg-red-100 text-red-700"
                        : "bg-amber-100 text-amber-800"
                  }`}
                >
                  {t(`status.${clip.status}`)}
                </span>
                {clip.status === "REJECTED" && clip.rejectionReason && (
                  <p className="mt-1 text-xs text-red-600">{clip.rejectionReason}</p>
                )}
              </div>
              <button
                type="button"
                disabled={busyId === clip.id}
                onClick={() => setConfirmDelete(clip)}
                aria-label={t("delete")}
                className="flex h-10 w-10 items-center justify-center rounded-full text-neutral-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
              >
                <span className="material-symbols-outlined">delete</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* 온보딩(등록 직후) — 나중에 하기로 빠질 수 있게 */}
      {onboarding && (
        <button
          type="button"
          onClick={() => router.push(`/my-villas/${villaId}`)}
          className="mt-8 w-full rounded-2xl bg-neutral-900 py-4 text-base font-bold text-white transition-transform active:scale-95"
        >
          {clips.length > 0 ? t("done") : t("skip")}
        </button>
      )}

      {/* 삭제 확인 */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4">
          <div className="w-full max-w-[420px] rounded-2xl bg-white p-5 shadow-xl">
            <p className="text-base font-semibold text-neutral-900">{t("deleteConfirm")}</p>
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                className="flex-1 rounded-xl border border-neutral-300 py-3 text-sm font-semibold text-neutral-700"
              >
                {t("cancel")}
              </button>
              <button
                type="button"
                onClick={() => void removeClip(confirmDelete)}
                className="flex-1 rounded-xl bg-red-600 py-3 text-sm font-semibold text-white"
              >
                {t("delete")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
