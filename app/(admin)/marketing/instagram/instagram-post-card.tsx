"use client";

// 인스타그램 포스트 행(list row) — 접힘: 요약 1줄(썸네일·뱃지·빌라·예정시각), 펼침: 상세 + 액션.
//   ★ 목록이 화면을 과점하지 않도록 기본 접힘. open/onToggle 은 큐(부모)가 소유 → "전체 펼치기/접기" 지원.
//   편집/승인/반려 가능 상태: PENDING_APPROVAL·QUEUED(편집·반려), PENDING_APPROVAL(승인).
//   ★ 발행됨(PUBLISHED)은 API 수정 불가(인스타 정책) → permalink 링크 + 안내만.
//   ★ scheduledAt 은 KST 슬롯(07:30/12:30/20:00). 표시·편집 모두 KST(라벨 명기), 저장은 UTC ISO.
import { useState } from "react";
import { useTranslations } from "next-intl";
import { DateField } from "@/components/date-field";
import type { SerializedIgPost } from "@/lib/instagram/serialize";

const KST_OFFSET_MS = 9 * 3600 * 1000;
const SLOT_OPTIONS = ["07:30", "12:30", "20:00"] as const;

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

const KIND_BADGE: Record<string, string> = {
  VILLA_SHOWCASE: "bg-teal-500/15 border-teal-500/30 text-teal-300",
  SERVICE: "bg-indigo-500/15 border-indigo-500/30 text-indigo-300",
  INFO: "bg-slate-600/20 border-slate-600/40 text-slate-300",
  REELS: "bg-fuchsia-500/15 border-fuchsia-500/30 text-fuchsia-300",
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

export default function InstagramPostCard({
  post,
  open,
  onToggle,
  onChanged,
  onConflict,
  notify,
}: {
  post: SerializedIgPost;
  open: boolean;
  onToggle: () => void;
  onChanged: () => void | Promise<void>;
  onConflict: () => void;
  notify: (msg: string, kind?: "ok" | "err") => void;
}) {
  const t = useTranslations("adminInstagram");
  const editable = EDITABLE.has(post.status);

  const kst = toKst(post.scheduledAt);
  // 현재 슬롯이 표준 3슬롯이 아니면 옵션에 추가(값 유실 방지)
  const slotOptions: string[] = SLOT_OPTIONS.includes(kst.hm as (typeof SLOT_OPTIONS)[number])
    ? [...SLOT_OPTIONS]
    : [kst.hm, ...SLOT_OPTIONS];

  const [editingCaption, setEditingCaption] = useState(false);
  const [caption, setCaption] = useState(post.caption);
  const [editingSchedule, setEditingSchedule] = useState(false);
  const [date, setDate] = useState(kst.date);
  const [slot, setSlot] = useState(kst.hm);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<null | "caption" | "schedule" | "approve" | "reject">(null);

  // 공통 응답 처리: 409 → onConflict, ok → 성공콜백, 그 외 → 에러 토스트
  async function handle(
    res: Response,
    okMsg: string,
    after?: () => void
  ): Promise<boolean> {
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

  const saveCaption = async () => {
    if (busy) return;
    const next = caption.trim();
    if (!next || next === post.caption) {
      setEditingCaption(false);
      return;
    }
    setBusy("caption");
    try {
      const res = await fetch(`/api/instagram/posts/${post.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caption: next }),
      });
      await handle(res, t("toast.saved"), () => setEditingCaption(false));
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
      const res = await fetch(`/api/instagram/posts/${post.id}`, {
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
      const res = await fetch(`/api/instagram/posts/${post.id}/approve`, { method: "POST" });
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
      const res = await fetch(`/api/instagram/posts/${post.id}/reject`, {
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

  const media = post.media.filter((m) => m.renderedUrl);
  const cover = media[0];
  const rest = media.slice(1, 4);
  const extra = media.length - 4;
  const hasWarning = post.flaggedTerms.length > 0 || !!post.failReason;
  const whenLabel =
    post.status === "PUBLISHED" ? t("card.publishedAt") : t("card.scheduledAt");
  const whenValue =
    post.status === "PUBLISHED" && post.publishedAt
      ? `${toKst(post.publishedAt).display} ${t("kst")}`
      : `${kst.display} ${t("kst")}`;

  return (
    <div className="rounded-xl border border-slate-800/50 bg-admin-card">
      {/* 요약 줄(항상 표시) — 클릭 시 펼치기/접기 */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        title={open ? t("list.collapse") : t("list.expand")}
        className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-slate-800/30"
      >
        {/* 썸네일(4:5) */}
        {cover ? (
          // 외부 R2 렌더 URL — next/image remotePatterns 의존 제거 위해 img 사용(관례)
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={cover.renderedUrl}
            alt=""
            loading="lazy"
            className="h-14 w-11 shrink-0 rounded-md border border-slate-700 object-cover"
          />
        ) : (
          <div className="flex h-14 w-11 shrink-0 items-center justify-center rounded-md border border-dashed border-slate-700 text-[9px] leading-tight text-slate-600">
            {t("card.noMedia")}
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={`inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-bold ${
                KIND_BADGE[post.kind] ?? "border-slate-700 text-slate-400"
              }`}
            >
              {t(`kind.${post.kind}`)}
            </span>
            <span
              className={`inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-bold ${
                STATUS_BADGE[post.status] ?? "border-slate-700 text-slate-400"
              }`}
            >
              {t(`status.${post.status}`)}
            </span>
            {post.media.length > 0 && (
              <span className="text-[10px] font-medium text-slate-500">
                {t("card.slides", { n: post.media.length })}
              </span>
            )}
            {/* 발행됨 도달 뱃지 — 인사이트 수집분(latestReach)만. 미수집이면 미표시. */}
            {post.status === "PUBLISHED" && post.latestReach != null && (
              <span className="inline-flex items-center gap-1 rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                <span className="material-symbols-outlined text-[13px]">visibility</span>
                {t("card.reachBadge", { n: post.latestReach.toLocaleString("ko-KR") })}
              </span>
            )}
            {/* 접힘 상태에서도 문제를 놓치지 않도록 경고 아이콘만 요약에 노출 */}
            {hasWarning && (
              <span
                className={`material-symbols-outlined text-[15px] ${
                  post.failReason ? "text-red-400" : "text-amber-400"
                }`}
              >
                warning
              </span>
            )}
          </div>

          <p className="truncate text-sm font-bold text-white">
            {post.villaName ?? t("card.noVilla")}
          </p>

          {/* 발행 예정/시각 — KST 명기 */}
          <p className="truncate text-[11px] text-slate-400 tabular-nums">
            <span className="text-slate-500">{whenLabel}</span> {whenValue}
          </p>
        </div>

        <span className="material-symbols-outlined shrink-0 text-slate-500">
          {open ? "expand_less" : "expand_more"}
        </span>
      </button>

      {open && (
        <div className="flex flex-col gap-3 border-t border-slate-800 p-4">
          {/* 캐러셀 썸네일 전체 */}
          {media.length > 0 && (
            <div className="flex flex-wrap items-start gap-1.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={cover.renderedUrl}
                alt={cover.overlayText ?? post.villaName ?? ""}
                loading="lazy"
                className="h-40 w-32 rounded-lg border border-slate-700 object-cover"
              />
              {rest.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  {rest.map((m, i) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={i}
                      src={m.renderedUrl}
                      alt=""
                      loading="lazy"
                      className="h-[46px] w-[38px] rounded-md border border-slate-700 object-cover"
                    />
                  ))}
                  {extra > 0 && (
                    <div className="flex h-[46px] w-[38px] items-center justify-center rounded-md border border-slate-700 bg-slate-800 text-[11px] font-bold text-slate-300">
                      +{extra}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* 금칙어 경고 */}
          {post.flaggedTerms.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5">
              <span className="material-symbols-outlined text-[16px] text-amber-400">warning</span>
              <span className="text-[11px] font-bold text-amber-400">{t("card.flagged")}</span>
              <span className="text-[11px] text-amber-300/90">
                {t("card.flaggedTerms", { terms: post.flaggedTerms.join(", ") })}
              </span>
            </div>
          )}

          {/* 실패 사유 */}
          {post.failReason && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-[11px] text-red-300">
              <span className="font-bold">{t("card.failReason")}:</span> {post.failReason}
            </div>
          )}

          {/* 캡션 */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                {t("card.captionLabel")}
              </span>
              {editable && !editingCaption && (
                <button
                  type="button"
                  onClick={() => {
                    setCaption(post.caption);
                    setEditingCaption(true);
                  }}
                  className="inline-flex items-center gap-1 text-[11px] font-bold text-admin-primary hover:underline"
                >
                  <span className="material-symbols-outlined text-[14px]">edit</span>
                  {t("card.editCaption")}
                </button>
              )}
            </div>
            {editingCaption ? (
              <div className="flex flex-col gap-2">
                <textarea
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  rows={6}
                  maxLength={2200}
                  className="w-full resize-y rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-admin-primary focus:outline-none focus:ring-1 focus:ring-admin-primary"
                />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={saveCaption}
                    disabled={busy === "caption"}
                    className="inline-flex items-center gap-1 rounded-lg bg-admin-primary px-3 py-1.5 text-xs font-bold text-white hover:opacity-90 disabled:opacity-50"
                  >
                    {busy === "caption" ? t("card.saving") : t("card.save")}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingCaption(false);
                      setCaption(post.caption);
                    }}
                    disabled={busy === "caption"}
                    className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-300 hover:bg-slate-800 disabled:opacity-50"
                  >
                    {t("card.cancel")}
                  </button>
                </div>
              </div>
            ) : (
              <p className="whitespace-pre-wrap break-words rounded-lg bg-slate-900/50 px-3 py-2 text-[13px] leading-relaxed text-slate-300">
                {post.caption}
              </p>
            )}
          </div>

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

          {/* 발행됨: permalink + 안내 */}
          {post.status === "PUBLISHED" && (
            <div className="flex flex-col gap-2 border-t border-slate-800 pt-3">
              {post.igPermalink && (
                <a
                  href={post.igPermalink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-bold text-emerald-300 hover:bg-emerald-500/20"
                >
                  <span className="material-symbols-outlined text-[16px]">open_in_new</span>
                  {t("card.viewOnInstagram")}
                </a>
              )}
              <p className="text-[11px] text-slate-500">{t("card.publishedLockNote")}</p>
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
                  {post.status === "PENDING_APPROVAL" && (
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
    </div>
  );
}
