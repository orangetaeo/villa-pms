"use client";

// 유튜브 쇼츠 카드 — 세로(9:16) 영상 미리보기 + 메타 + 상태별 액션(제목·설명 편집·시간 변경·승인·반려).
//   편집/반려 가능 상태: PENDING_APPROVAL·QUEUED. 승인: PENDING_APPROVAL만.
//   ★ 발행됨(PUBLISHED)은 API 수정 불가 → shortsUrl 링크 + privacyStatus 안내(unlisted면 스튜디오 딥링크).
//   ★ scheduledAt 은 KST 슬롯(12:00/19:30). 표시·편집 모두 KST(라벨 명기), 저장은 UTC ISO.
//   ★ 원가·마진·시크릿 필드는 SerializedYtShort 에 부재(누수 불가).
import { useState } from "react";
import { useTranslations } from "next-intl";
import { DateField } from "@/components/date-field";
import type { SerializedYtShort } from "@/lib/youtube/serialize";

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

export default function YoutubeShortCard({
  short,
  onChanged,
  onConflict,
  notify,
}: {
  short: SerializedYtShort;
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

  const [playing, setPlaying] = useState(false);
  const [descOpen, setDescOpen] = useState(false);
  const [editingMeta, setEditingMeta] = useState(false);
  const [title, setTitle] = useState(short.title);
  const [description, setDescription] = useState(short.description);
  const [editingSchedule, setEditingSchedule] = useState(false);
  const [date, setDate] = useState(kst.date);
  const [slot, setSlot] = useState(kst.hm);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<null | "meta" | "schedule" | "approve" | "reject">(null);

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

  const privacy = short.ytPrivacyStatus ?? undefined;
  const needsPublicSwitch = short.status === "PUBLISHED" && privacy === "unlisted";

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-slate-800/50 bg-admin-card p-4">
      {/* 상단: 세로(9:16) 영상 미리보기 + 메타 */}
      <div className="flex gap-3">
        {/* 9:16 세로 썸네일 — 클릭 시 재생 */}
        <div className="w-28 shrink-0">
          {playing && short.videoUrl ? (
            // 외부 R2 영상 URL — controls 재생
            <video
              src={short.videoUrl}
              poster={short.posterUrl ?? undefined}
              controls
              autoPlay
              playsInline
              className="aspect-[9/16] w-28 rounded-lg border border-slate-700 bg-black object-cover"
            />
          ) : short.posterUrl || short.videoUrl ? (
            <button
              type="button"
              onClick={() => setPlaying(true)}
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

        {/* 메타 */}
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
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
          </div>

          <p className="truncate text-sm font-bold text-white">
            {short.villaName ?? t("card.noVilla")}
          </p>

          {/* 발행 예정/시각 — KST 명기 */}
          <p className="text-xs text-slate-400 tabular-nums">
            <span className="text-slate-500">
              {short.status === "PUBLISHED" ? t("card.publishedAt") : t("card.scheduledAt")}
            </span>{" "}
            {short.status === "PUBLISHED" && short.publishedAt
              ? `${toKst(short.publishedAt).display} ${t("kst")}`
              : `${kst.display} ${t("kst")}`}
          </p>

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
        </div>
      </div>

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
  );
}
