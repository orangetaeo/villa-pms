"use client";

// 유튜브 쇼츠 행(list row) — 접힘: 요약 1줄(썸네일·뱃지·제목·예정시각), 펼침: 영상 미리보기 + 상세 + 액션.
//   ★ 목록이 화면을 과점하지 않도록 기본 접힘. open/onToggle 은 큐(부모)가 소유 → "전체 펼치기/접기" 지원.
//   편집/반려 가능 상태: PENDING_APPROVAL·QUEUED. 승인: PENDING_APPROVAL만.
//   ★ 발행됨(PUBLISHED)은 API 수정 불가 → shortsUrl 링크 + privacyStatus 안내(unlisted면 스튜디오 딥링크).
//   ★ scheduledAt 은 KST 슬롯(12:00/19:30). 표시·편집 모두 KST(라벨 명기), 저장은 UTC ISO.
//   ★ 원가·마진·시크릿 필드는 SerializedYtShort 에 부재(누수 불가).
import { useState } from "react";
import { useTranslations } from "next-intl";
import { DateField } from "@/components/date-field";
import ImageLightbox, { type LightboxImage } from "@/components/image-lightbox";
import type { SerializedYtShort } from "@/lib/youtube/serialize";
import NarrationEditor from "./narration-editor";

const KST_OFFSET_MS = 9 * 3600 * 1000;
const SLOT_OPTIONS = ["12:00", "19:30"] as const;
const TITLE_MAX = 100;

const pad = (n: number) => String(n).padStart(2, "0");

/** UTC ISO → KST 날짜/시각 파트. */
function toKst(iso: string): { date: string; hm: string; display: string } {
  const d = new Date(new Date(iso).getTime() + KST_OFFSET_MS);
  const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const hm = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  return { date, hm, display: `${date} ${hm}` };
}

/** KST 벽시계 날짜(YYYY-MM-DD)+시각(HH:MM) → UTC ISO. */
function kstToUtcIso(date: string, hm: string): string {
  const [y, mo, da] = date.split("-").map(Number);
  const [h, mi] = hm.split(":").map(Number);
  return new Date(Date.UTC(y, mo - 1, da, h, mi, 0) - KST_OFFSET_MS).toISOString();
}

const EDITABLE = new Set(["PENDING_APPROVAL", "QUEUED"]);

const SOURCE_BADGE: Record<string, string> = {
  VILLA_AUTO: "bg-teal-500/15 border-teal-500/30 text-teal-300",
  UPLOADED: "bg-indigo-500/15 border-indigo-500/30 text-indigo-300",
};

const STATUS_BADGE: Record<string, string> = {
  DRAFT: "bg-slate-800 border-slate-700 text-slate-400",
  PENDING_APPROVAL: "bg-amber-500/10 border-amber-500/30 text-amber-400",
  QUEUED: "bg-admin-primary/15 border-admin-primary/30 text-admin-primary",
  PUBLISHING: "bg-blue-500/15 border-blue-500/30 text-blue-300",
  PUBLISHED: "bg-emerald-500/15 border-emerald-500/30 text-emerald-300",
  FAILED: "bg-red-500/10 border-red-500/30 text-red-400",
  CANCELLED: "bg-slate-800 border-slate-700 text-slate-500",
};

const PRIVACY_BADGE: Record<string, string> = {
  public: "bg-emerald-500/15 border-emerald-500/30 text-emerald-300",
  unlisted: "bg-amber-500/10 border-amber-500/30 text-amber-400",
  private: "bg-slate-800 border-slate-700 text-slate-400",
};

// 직접 촬영 자동 편집 잡 상태 뱃지(status와 별개 축) — DONE은 뱃지 생략(정상 큐 합류).
const EDITJOB_BADGE: Record<string, string> = {
  PENDING: "bg-slate-800 border-slate-700 text-slate-300",
  PROCESSING: "bg-blue-500/15 border-blue-500/30 text-blue-300",
  FAILED: "bg-red-500/10 border-red-500/30 text-red-400",
};

const fmtNum = (n: number | null | undefined) =>
  n == null ? null : n.toLocaleString("ko-KR");

export default function YoutubeShortCard({
  short,
  open,
  onToggle,
  onChanged,
  onConflict,
  notify,
}: {
  short: SerializedYtShort;
  open: boolean;
  onToggle: () => void;
  onChanged: () => void | Promise<void>;
  onConflict: () => void;
  notify: (msg: string, kind?: "ok" | "err") => void;
}) {
  const t = useTranslations("adminYoutube");
  const editable = EDITABLE.has(short.status);

  const kst = toKst(short.scheduledAt);
  // 현재 슬롯이 표준 2슬롯이 아니면 옵션에 추가(값 유실 방지)
  const slotOptions: string[] = SLOT_OPTIONS.includes(kst.hm as (typeof SLOT_OPTIONS)[number])
    ? [...SLOT_OPTIONS]
    : [kst.hm, ...SLOT_OPTIONS];

  // 라이트박스(크게 보기) — 0이면 열림, null이면 닫힘(단일 영상)
  const [zoom, setZoom] = useState<number | null>(null);
  const [descOpen, setDescOpen] = useState(false);
  const [editingMeta, setEditingMeta] = useState(false);
  const [title, setTitle] = useState(short.title);
  const [description, setDescription] = useState(short.description);
  const [editingSchedule, setEditingSchedule] = useState(false);
  const [date, setDate] = useState(kst.date);
  const [slot, setSlot] = useState(kst.hm);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<null | "meta" | "schedule" | "approve" | "reject" | "rerun">(
    null
  );

  // 공통 응답 처리: 409 → onConflict, ok → 성공콜백, 그 외 → 에러 토스트
  async function handle(res: Response, okMsg: string, after?: () => void): Promise<boolean> {
    if (res.status === 409) {
      onConflict();
      return false;
    }
    if (!res.ok) {
      notify(t("toast.error"), "err");
      return false;
    }
    notify(okMsg);
    after?.();
    await onChanged();
    return true;
  }

  const saveMeta = async () => {
    if (busy) return;
    const nextTitle = title.trim();
    const nextDesc = description.trim();
    if (!nextTitle) {
      notify(t("card.titleRequired"), "err");
      return;
    }
    const body: Record<string, string> = {};
    if (nextTitle !== short.title) body.title = nextTitle;
    if (nextDesc !== short.description) body.description = nextDesc;
    if (Object.keys(body).length === 0) {
      setEditingMeta(false);
      return;
    }
    setBusy("meta");
    try {
      const res = await fetch(`/api/youtube/shorts/${short.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      await handle(res, t("toast.saved"), () => setEditingMeta(false));
    } catch {
      notify(t("toast.error"), "err");
    } finally {
      setBusy(null);
    }
  };

  const saveSchedule = async () => {
    if (busy || !date) return;
    setBusy("schedule");
    try {
      const res = await fetch(`/api/youtube/shorts/${short.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduledAt: kstToUtcIso(date, slot) }),
      });
      await handle(res, t("toast.saved"), () => setEditingSchedule(false));
    } catch {
      notify(t("toast.error"), "err");
    } finally {
      setBusy(null);
    }
  };

  const approve = async () => {
    if (busy) return;
    setBusy("approve");
    try {
      const res = await fetch(`/api/youtube/shorts/${short.id}/approve`, { method: "POST" });
      await handle(res, t("toast.approved"));
    } catch {
      notify(t("toast.error"), "err");
    } finally {
      setBusy(null);
    }
  };

  const reject = async () => {
    if (busy) return;
    setBusy("reject");
    try {
      const res = await fetch(`/api/youtube/shorts/${short.id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reason.trim() ? { reason: reason.trim() } : {}),
      });
      await handle(res, t("toast.rejected"), () => {
        setRejecting(false);
        setReason("");
      });
    } catch {
      notify(t("toast.error"), "err");
    } finally {
      setBusy(null);
    }
  };

  // 편집 잡 재실행(직접 촬영 UPLOADED, editJobStatus=FAILED) — **대기열 등록만**(202).
  //   실제 렌더는 cron이 수행한다(2.5~8분). 동기 실행은 브라우저 타임아웃 때문에 폐지됐다.
  const rerunEdit = async () => {
    if (busy) return;
    setBusy("rerun");
    try {
      const res = await fetch(`/api/youtube/edit-jobs/${short.id}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ retry: true }),
      });
      await handle(res, t("editJob.queued"));
    } catch {
      notify(t("toast.error"), "err");
    } finally {
      setBusy(null);
    }
  };

  const privacy = short.ytPrivacyStatus ?? undefined;
  const needsPublicSwitch = short.status === "PUBLISHED" && privacy === "unlisted";
  const editJob = short.editJobStatus && short.editJobStatus !== "DONE" ? short.editJobStatus : null;
  const publishedViews = short.status === "PUBLISHED" ? fmtNum(short.latestViews) : null;
  const publishedLikes = short.status === "PUBLISHED" ? fmtNum(short.latestLikes) : null;

  const hasWarning = short.flaggedTerms.length > 0 || !!short.failReason || editJob === "FAILED";
  // 라이트박스 항목 — 쇼츠 MP4 1건(포스터가 있으면 첫 프레임으로)
  const zoomItems: LightboxImage[] = short.videoUrl
    ? [{ url: short.posterUrl ?? "", videoUrl: short.videoUrl, label: short.title }]
    : short.posterUrl
      ? [{ url: short.posterUrl, label: short.title }]
      : [];
  const whenLabel =
    short.status === "PUBLISHED" ? t("card.publishedAt") : t("card.scheduledAt");
  const whenValue =
    short.status === "PUBLISHED" && short.publishedAt
      ? `${toKst(short.publishedAt).display} ${t("kst")}`
      : `${kst.display} ${t("kst")}`;

  // 요약 줄 뱃지 — 펼침/접힘 공통(출처·상태·편집잡·성과)
  const summaryBadges = (
    <>
      <span
        className={`inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-bold ${
          SOURCE_BADGE[short.sourceType] ?? "border-slate-700 text-slate-400"
        }`}
      >
        {t(`source.${short.sourceType}`)}
      </span>
      <span
        className={`inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-bold ${
          STATUS_BADGE[short.status] ?? "border-slate-700 text-slate-400"
        }`}
      >
        {t(`status.${short.status}`)}
      </span>
      {/* 직접 촬영 자동 편집 잡 상태(status와 별개 축) — PENDING/PROCESSING/FAILED */}
      {editJob && (
        <span
          className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[10px] font-bold ${
            EDITJOB_BADGE[editJob] ?? "border-slate-700 text-slate-400"
          }`}
          title={editJob === "FAILED" && short.editError ? short.editError : undefined}
        >
          {editJob === "PROCESSING" && (
            <span className="material-symbols-outlined animate-spin text-[12px]">
              progress_activity
            </span>
          )}
          {t(`editJob.${editJob}`)}
        </span>
      )}
      {/* 발행됨 성과 뱃지 — latestViews·latestLikes, null=미표시 */}
      {publishedViews != null && (
        <span
          className="inline-flex items-center gap-1 rounded border border-slate-700 px-2 py-0.5 text-[10px] font-bold text-slate-300"
          title={t("metric.views")}
        >
          <span className="material-symbols-outlined text-[12px]">visibility</span>
          {publishedViews}
        </span>
      )}
      {publishedLikes != null && (
        <span
          className="inline-flex items-center gap-1 rounded border border-slate-700 px-2 py-0.5 text-[10px] font-bold text-slate-300"
          title={t("metric.likes")}
        >
          <span className="material-symbols-outlined text-[12px]">thumb_up</span>
          {publishedLikes}
        </span>
      )}
    </>
  );

  return (
    <div className="rounded-xl border border-slate-800/50 bg-admin-card">
      {/* 요약 줄(항상 표시) — 썸네일 클릭=크게 재생, 나머지 클릭=펼치기/접기 */}
      <div className="flex items-center gap-3 px-3 py-2.5">
        {/* 9:16 세로 썸네일(작게) — 목록에서 바로 크게 재생 */}
        {short.videoUrl || short.posterUrl ? (
          <button
            type="button"
            onClick={() => setZoom(0)}
            aria-label={t("card.play")}
            title={t("card.play")}
            className="group relative block h-16 w-9 shrink-0 overflow-hidden rounded-md border border-slate-700 bg-black"
          >
            {short.posterUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={short.posterUrl}
                alt=""
                loading="lazy"
                className="h-full w-full object-cover"
              />
            ) : null}
            <span className="absolute inset-0 flex items-center justify-center bg-black/20 transition-colors group-hover:bg-black/50">
              <span className="material-symbols-outlined text-[22px] text-white/80 drop-shadow transition-colors group-hover:text-white">
                play_circle
              </span>
            </span>
          </button>
        ) : (
          <div className="flex h-16 w-9 shrink-0 items-center justify-center rounded-md border border-dashed border-slate-700 bg-black/40">
            <span className="material-symbols-outlined text-[16px] text-slate-600">movie</span>
          </div>
        )}

        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          title={open ? t("list.collapse") : t("list.expand")}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left transition-colors hover:bg-slate-800/30"
        >
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-1.5">
              {summaryBadges}
              {/* 접힘 상태에서도 문제를 놓치지 않도록 경고 아이콘만 요약에 노출 */}
              {hasWarning && (
                <span
                  className={`material-symbols-outlined text-[15px] ${
                    short.failReason || editJob === "FAILED" ? "text-red-400" : "text-amber-400"
                  }`}
                >
                  warning
                </span>
              )}
            </div>

            <p className="truncate text-sm font-bold text-white">{short.title}</p>
            <p className="truncate text-[11px] text-slate-400 tabular-nums">
              <span className="text-slate-500">{short.villaName ?? t("card.noVilla")}</span>
              {" · "}
              <span className="text-slate-500">{whenLabel}</span> {whenValue}
            </p>
          </div>

          <span className="material-symbols-outlined shrink-0 text-slate-500">
            {open ? "expand_less" : "expand_more"}
          </span>
        </button>
      </div>

      {open && (
        <div className="flex flex-col gap-3 border-t border-slate-800 p-4">
          {/* 상단: 세로(9:16) 영상 미리보기 + 메타 */}
          <div className="flex gap-3">
            {/* 9:16 세로 썸네일 — 클릭 시 라이트박스에서 크게 재생 */}
            <div className="w-28 shrink-0">
              {short.posterUrl || short.videoUrl ? (
                <button
                  type="button"
                  onClick={() => setZoom(0)}
                  className="group relative block aspect-[9/16] w-28 overflow-hidden rounded-lg border border-slate-700 bg-black"
                  aria-label={t("card.play")}
                >
                  {short.posterUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={short.posterUrl}
                      alt={short.villaName ?? short.title}
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center text-[11px] text-slate-600">
                      {t("card.noPoster")}
                    </span>
                  )}
                  <span className="absolute inset-0 flex items-center justify-center bg-black/20 transition-colors group-hover:bg-black/40">
                    <span className="material-symbols-outlined text-[40px] text-white/90 drop-shadow">
                      play_circle
                    </span>
                  </span>
                  {short.durationSec != null && (
                    <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 py-0.5 text-[10px] font-bold tabular-nums text-white">
                      {short.durationSec}s
                    </span>
                  )}
                </button>
              ) : (
                <div className="flex aspect-[9/16] w-28 items-center justify-center rounded-lg border border-dashed border-slate-700 text-[11px] text-slate-600">
                  {t("card.noMedia")}
                </div>
              )}
            </div>

            {/* 메타(요약 줄에 없는 상세만) */}
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              {short.villaName && (
                <p className="truncate text-sm font-bold text-white">{short.villaName}</p>
              )}

              {/* 금칙어 경고 */}
              {short.flaggedTerms.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5">
                  <span className="material-symbols-outlined text-[16px] text-amber-400">warning</span>
                  <span className="text-[11px] font-bold text-amber-400">{t("card.flagged")}</span>
                  <span className="text-[11px] text-amber-300/90">
                    {t("card.flaggedTerms", { terms: short.flaggedTerms.join(", ") })}
                  </span>
                </div>
              )}

              {/* 실패 사유 */}
              {short.failReason && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-[11px] text-red-300">
                  <span className="font-bold">{t("card.failReason")}:</span> {short.failReason}
                </div>
              )}

              {/* 편집 잡 실패(직접 촬영) — 사유 + 카드 내 재실행 */}
              {editJob === "FAILED" && (
                <div className="flex flex-col gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-2">
                  <p className="text-[11px] text-red-300">
                    <span className="font-bold">{t("editJob.errorLabel")}:</span>{" "}
                    {short.editError ?? t("toast.error")}
                  </p>
                  <button
                    type="button"
                    onClick={rerunEdit}
                    disabled={busy === "rerun"}
                    className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-red-500/40 px-3 py-1.5 text-[11px] font-bold text-red-200 hover:bg-red-500/20 disabled:opacity-50"
                  >
                    <span
                      className={`material-symbols-outlined text-[14px] ${
                        busy === "rerun" ? "animate-spin" : ""
                      }`}
                    >
                      {busy === "rerun" ? "progress_activity" : "refresh"}
                    </span>
                    {busy === "rerun" ? t("editJob.rerunning") : t("editJob.rerun")}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* AI 나레이션 대본 (villa-clip-narration-p2) — 직접 촬영 클립 쇼츠 전용.
              Gemini 대본을 그대로 발행하면 사고이므로 여기서 사람이 읽고 고친 뒤 재렌더한다.
              사진 자동생성(VILLA_AUTO)은 나레이션 소재가 없어 대상이 아니다(음악 유지). */}
          {short.sourceType === "UPLOADED" && (
            <NarrationEditor shortId={short.id} onChanged={onChanged} notify={notify} />
          )}

          {/* 제목·설명 (편집 가능 상태는 편집 폼, 그 외는 표시만) */}
          {editingMeta ? (
            <div className="flex flex-col gap-3 rounded-lg border border-slate-700 bg-slate-900/50 p-3">
              <label className="flex flex-col gap-1.5">
                <span className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    {t("card.titleLabel")}
                  </span>
                  <span
                    className={`text-[11px] font-semibold tabular-nums ${
                      title.length > TITLE_MAX ? "text-red-400" : "text-slate-500"
                    }`}
                  >
                    {title.length}/{TITLE_MAX}
                  </span>
                </span>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={TITLE_MAX}
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-bold text-white focus:border-admin-primary focus:outline-none focus:ring-1 focus:ring-admin-primary"
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  {t("card.descriptionLabel")}
                </span>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={5}
                  maxLength={5000}
                  className="w-full resize-y rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-admin-primary focus:outline-none focus:ring-1 focus:ring-admin-primary"
                />
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={saveMeta}
                  disabled={busy === "meta"}
                  className="inline-flex items-center gap-1 rounded-lg bg-admin-primary px-3 py-1.5 text-xs font-bold text-white hover:opacity-90 disabled:opacity-50"
                >
                  {busy === "meta" ? t("card.saving") : t("card.save")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditingMeta(false);
                    setTitle(short.title);
                    setDescription(short.description);
                  }}
                  disabled={busy === "meta"}
                  className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-300 hover:bg-slate-800 disabled:opacity-50"
                >
                  {t("card.cancel")}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-start justify-between gap-2">
                <p className="break-words text-sm font-bold text-white">{short.title}</p>
                {editable && (
                  <button
                    type="button"
                    onClick={() => {
                      setTitle(short.title);
                      setDescription(short.description);
                      setEditingMeta(true);
                    }}
                    className="inline-flex shrink-0 items-center gap-1 text-[11px] font-bold text-admin-primary hover:underline"
                  >
                    <span className="material-symbols-outlined text-[14px]">edit</span>
                    {t("card.edit")}
                  </button>
                )}
              </div>
              {short.description && (
                <>
                  <p
                    className={`whitespace-pre-wrap break-words rounded-lg bg-slate-900/50 px-3 py-2 text-[13px] leading-relaxed text-slate-300 ${
                      descOpen ? "" : "line-clamp-3"
                    }`}
                  >
                    {short.description}
                  </p>
                  <button
                    type="button"
                    onClick={() => setDescOpen((v) => !v)}
                    className="w-fit text-[11px] font-bold text-slate-400 hover:text-admin-primary"
                  >
                    {descOpen ? t("card.showLess") : t("card.showMore")}
                  </button>
                </>
              )}
              {short.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {short.tags.map((tag, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center rounded-full border border-slate-700 bg-slate-900/50 px-2 py-0.5 text-[10px] font-medium text-slate-400"
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 발행 시각 변경(편집 가능 상태만) */}
          {editable && (
            <div className="flex flex-col gap-2">
              {editingSchedule ? (
                <div className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-700 bg-slate-900/50 p-3">
                  <label className="flex flex-col gap-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                      {t("card.date")}
                    </span>
                    <DateField
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                      placeholder={t("card.datePlaceholder")}
                      className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 [color-scheme:dark]"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                      {t("card.slot")} ({t("kst")})
                    </span>
                    <select
                      value={slot}
                      onChange={(e) => setSlot(e.target.value)}
                      className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm font-bold text-slate-200 tabular-nums focus:border-admin-primary focus:outline-none"
                    >
                      {slotOptions.map((s) => (
                        <option key={s} value={s} className="bg-slate-900">
                          {s}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={saveSchedule}
                      disabled={busy === "schedule"}
                      className="rounded-lg bg-admin-primary px-3 py-1.5 text-xs font-bold text-white hover:opacity-90 disabled:opacity-50"
                    >
                      {busy === "schedule" ? t("card.saving") : t("card.save")}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingSchedule(false);
                        setDate(kst.date);
                        setSlot(kst.hm);
                      }}
                      disabled={busy === "schedule"}
                      className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-300 hover:bg-slate-800 disabled:opacity-50"
                    >
                      {t("card.cancel")}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setEditingSchedule(true)}
                  className="inline-flex w-fit items-center gap-1 text-[11px] font-bold text-slate-400 hover:text-admin-primary"
                >
                  <span className="material-symbols-outlined text-[14px]">schedule</span>
                  {t("card.changeSchedule")}
                </button>
              )}
            </div>
          )}

          {/* 발행됨: 쇼츠 링크 + 공개 상태 뱃지 + (unlisted면) 스튜디오 딥링크 */}
          {short.status === "PUBLISHED" && (
            <div className="flex flex-col gap-2 border-t border-slate-800 pt-3">
              <div className="flex flex-wrap items-center gap-2">
                {short.shortsUrl && (
                  <a
                    href={short.shortsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-bold text-emerald-300 hover:bg-emerald-500/20"
                  >
                    <span className="material-symbols-outlined text-[16px]">open_in_new</span>
                    {t("card.viewOnShorts")}
                  </a>
                )}
                {privacy && (
                  <span
                    className={`inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-bold ${
                      PRIVACY_BADGE[privacy] ?? "border-slate-700 text-slate-400"
                    }`}
                  >
                    {t(`card.privacy.${privacy}`)}
                  </span>
                )}
              </div>
              {needsPublicSwitch && (
                <div className="flex flex-col gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                  <p className="text-[11px] font-semibold text-amber-300">{t("card.unlistedNote")}</p>
                  {short.ytVideoId && (
                    <a
                      href={`https://studio.youtube.com/video/${short.ytVideoId}/edit`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-amber-500/40 px-3 py-1.5 text-xs font-bold text-amber-300 hover:bg-amber-500/20"
                    >
                      <span className="material-symbols-outlined text-[16px]">open_in_new</span>
                      {t("card.openStudio")}
                    </a>
                  )}
                </div>
              )}
            </div>
          )}

          {/* 액션: 승인/반려 (편집 가능 상태) */}
          {editable && (
            <div className="flex flex-col gap-2 border-t border-slate-800 pt-3">
              {rejecting ? (
                <div className="flex flex-col gap-2">
                  <label className="text-[11px] font-bold text-slate-400">
                    {t("card.rejectReasonLabel")}
                  </label>
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={2}
                    maxLength={500}
                    placeholder={t("card.rejectReasonPlaceholder")}
                    className="w-full resize-y rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={reject}
                      disabled={busy === "reject"}
                      className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-500 disabled:opacity-50"
                    >
                      {busy === "reject" ? t("card.rejecting") : t("card.rejectConfirm")}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setRejecting(false);
                        setReason("");
                      }}
                      disabled={busy === "reject"}
                      className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-300 hover:bg-slate-800 disabled:opacity-50"
                    >
                      {t("card.cancel")}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  {short.status === "PENDING_APPROVAL" && (
                    <button
                      type="button"
                      onClick={approve}
                      disabled={busy === "approve"}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-admin-primary px-4 py-2 text-sm font-bold text-white hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
                    >
                      <span className="material-symbols-outlined text-base">check_circle</span>
                      {busy === "approve" ? t("card.approving") : t("card.approve")}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setRejecting(true)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/30 px-4 py-2 text-sm font-bold text-red-400 hover:bg-red-500/10 active:scale-[0.98]"
                  >
                    <span className="material-symbols-outlined text-base">cancel</span>
                    {t("card.reject")}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 크게 보기 — 쇼츠 영상 라이트박스(Esc·배경·X 닫기) */}
      <ImageLightbox
        images={zoomItems}
        index={zoom}
        onIndexChange={setZoom}
        labels={{ close: t("viewer.close"), prev: t("viewer.prev"), next: t("viewer.next") }}
      />
    </div>
  );
}
