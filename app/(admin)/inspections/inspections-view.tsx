"use client";

// 청소 검수 2패널 뷰 (T3.4 — Stitch b6-inspections 변환)
// - 좌: 태스크 목록 (승인 대기 우선 정렬은 RSC 책임) / 우: 제출 사진 vs 기준 사진 쌍 그리드
// - 행 선택·탭은 ?task=·?status= 쿼리 파라미터 Link (RSC 재조회, 새로고침 시 선택 유지)
// - 승인/반려는 기존 BE API 소비 (POST /api/cleaning-tasks/[id]/approve|reject) — 신규 API 표면 0
// - 쌍 라벨은 #E5E7EB (b6 대비 요구), 개수 불일치 시 남는 쪽 단독 표시
import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { CleaningStatus, CleaningType, PhotoSpace } from "@prisma/client";
import { formatDateTime } from "@/lib/format";
import QuickDateFilter from "@/components/admin/quick-date-filter";
import ImageLightbox, { type LightboxImage } from "@/components/image-lightbox";

export interface TaskListItem {
  id: string;
  type: CleaningType;
  status: CleaningStatus;
  createdAt: string; // ISO
  villaName: string;
  complex: string | null;
}

export interface BaselinePhoto {
  id: string;
  space: PhotoSpace;
  spaceLabel: string | null;
  url: string;
}

export interface SelectedTask {
  id: string;
  type: CleaningType;
  status: CleaningStatus;
  photoUrls: string[];
  rejectNote: string | null;
  approvedAt: string | null; // ISO
  dueDate: string | null; // ISO (@db.Date)
  createdAt: string; // ISO
  villaName: string;
  complex: string | null;
  baselinePhotos: BaselinePhoto[];
}

type TabKey = "all" | "submitted" | "pending" | "approved" | "rejected";
const TABS: TabKey[] = ["all", "submitted", "pending", "approved", "rejected"];

// 상태 배지 (b6: 승인 대기=amber, 승인됨=green / 청소 대기=slate, 반려됨=red outline)
const STATUS_BADGE_CLASS: Record<CleaningStatus, string> = {
  PENDING: "bg-slate-700/50 text-slate-400 border border-slate-600/50",
  PHOTOS_SUBMITTED: "bg-amber-500/10 text-amber-500 border border-amber-500/20",
  APPROVED: "bg-green-500/10 text-green-500 border border-green-500/20",
  REJECTED: "bg-transparent text-red-500 border border-red-500/50",
};

const REJECT_NOTE_MAX = 1000;

/** @db.Date ISO → "YYYY.MM.DD" (UTC 자정 고정값 전용) */
function dotDate(iso: string): string {
  return iso.slice(0, 10).replaceAll("-", ".");
}

interface Props {
  tasks: TaskListItem[];
  selected: SelectedTask | null;
  tab: string;
  counts: Record<TabKey, number>;
  range?: string;
}

export default function InspectionsView({ tasks, selected, tab, counts, range }: Props) {
  const t = useTranslations("adminInspections.list");
  const td = useTranslations("adminInspections.detail");
  const router = useRouter();

  const [busy, setBusy] = useState(false);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [rejectMode, setRejectMode] = useState(false);
  const [rejectNote, setRejectNote] = useState("");
  const [message, setMessage] = useState<{ tone: "ok" | "gate" | "error"; text: string } | null>(
    null
  );

  const actionable = selected?.status === "PHOTOS_SUBMITTED";

  /** 승인 — 성공 시 gateOpened=true면 판매 가능 전환 배너 (사업 핵심 원칙 3 게이트) */
  const approve = async () => {
    if (!selected || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/cleaning-tasks/${selected.id}/approve`, { method: "POST" });
      if (res.status === 409) {
        // 다른 곳에서 이미 처리됨 — 안내 후 최신 상태 재조회
        setMessage({ tone: "error", text: td("conflict") });
        router.refresh();
        return;
      }
      if (!res.ok) {
        setMessage({ tone: "error", text: td("actionError") });
        return;
      }
      const data = (await res.json()) as { gateOpened: boolean };
      setMessage(
        data.gateOpened
          ? { tone: "gate", text: td("gateOpened") }
          : { tone: "ok", text: td("approved") }
      );
      setRejectMode(false);
      // 선택을 URL에 고정 후 갱신 (QA D-2): 자동 선택 흐름에서 refresh가 첫 행으로
      // 튀며 key 리마운트로 gateOpened 배너가 소멸하는 것 방지 — key 불변 → 배너 지속
      router.replace(taskHref(selected.id), { scroll: false });
      router.refresh();
    } catch {
      setMessage({ tone: "error", text: td("actionError") });
    } finally {
      setBusy(false);
    }
  };

  /** 반려 — 1차 클릭: 사유 입력란 노출 / 2차: 사유와 함께 제출 (공백 거부) */
  const reject = async () => {
    if (!selected || busy) return;
    if (!rejectMode) {
      setRejectMode(true);
      setMessage(null);
      return;
    }
    const note = rejectNote.trim();
    if (!note) {
      setMessage({ tone: "error", text: td("rejectRequired") });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/cleaning-tasks/${selected.id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rejectNote: note }),
      });
      if (res.status === 409) {
        setMessage({ tone: "error", text: td("conflict") });
        router.refresh();
        return;
      }
      if (!res.ok) {
        setMessage({ tone: "error", text: td("actionError") });
        return;
      }
      setMessage({ tone: "ok", text: td("rejected") });
      setRejectMode(false);
      setRejectNote("");
      // 선택 URL 고정 — 승인과 동일 (QA D-2)
      router.replace(taskHref(selected.id), { scroll: false });
      router.refresh();
    } catch {
      setMessage({ tone: "error", text: td("actionError") });
    } finally {
      setBusy(false);
    }
  };

  /** 제출 사진·기준 사진 쌍 — photoUrls 순서 ↔ 기준 사진 space·sortOrder 순 매칭 */
  const pairCount = selected
    ? Math.max(selected.photoUrls.length, selected.baselinePhotos.length)
    : 0;

  const pairLabel = (i: number): string => {
    const baseline = selected?.baselinePhotos[i];
    if (baseline) return baseline.spaceLabel ?? td(`spaces.${baseline.space}`);
    return td("extraPhoto", { n: i - (selected?.baselinePhotos.length ?? 0) + 1 });
  };

  // 라이트박스 이미지 목록 — 쌍별 기준→청소후 순서대로 평탄화 (클릭 시 해당 위치에서 확대)
  const lightboxImages: LightboxImage[] = selected
    ? Array.from({ length: pairCount }, (_, i) => {
        const items: LightboxImage[] = [];
        const baseline = selected.baselinePhotos[i];
        const submittedUrl = selected.photoUrls[i];
        if (baseline) items.push({ url: baseline.url, label: `${pairLabel(i)} · ${td("baseline")}` });
        if (submittedUrl) items.push({ url: submittedUrl, label: `${pairLabel(i)} · ${td("after")}` });
        return items;
      }).flat()
    : [];
  const openLightbox = (url: string) => {
    const idx = lightboxImages.findIndex((im) => im.url === url);
    if (idx >= 0) setLightbox(idx);
  };

  // range는 모든 내부 링크에 보존 — 탭/행 전환 시 활성 날짜 필터 유지
  const rangeQs = range ? `&range=${range}` : "";
  const taskHref = (taskId: string) => `/inspections?status=${tab}&task=${taskId}${rangeQs}`;
  const tabHref = (key: TabKey) => `/inspections?status=${key}${rangeQs}`;

  const statusBadge = (status: CleaningStatus) => (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${STATUS_BADGE_CLASS[status]}`}
    >
      {t(`status.${status}`)}
    </span>
  );

  return (
    <div>
      {/* 페이지 헤더 + 상태 필터 탭 (b6 + 기존 admin 탭 패턴) */}
      <div className="flex flex-col gap-6 mb-6">
        <h1 className="text-2xl font-bold text-white">{t("title")}</h1>
        <div className="flex items-center gap-2 border-b border-admin-card overflow-x-auto">
          {TABS.map((key) => {
            const active = tab === key;
            return (
              <Link
                key={key}
                href={tabHref(key)}
                className={
                  active
                    ? "px-4 py-3 text-sm font-bold text-admin-primary border-b-2 border-admin-primary flex items-center gap-2 whitespace-nowrap"
                    : "px-4 py-3 text-sm font-medium text-admin-muted hover:text-white transition-colors flex items-center gap-2 whitespace-nowrap"
                }
              >
                {t(`tabs.${key}`)}
                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] bg-admin-card ${
                    active ? "text-admin-primary" : "text-admin-muted"
                  }`}
                >
                  {counts[key]}
                </span>
              </Link>
            );
          })}
        </div>
        {/* 빠른 날짜 필터 — createdAt 기준, 과거 지향 목록이라 nextMonth 제외 */}
        <QuickDateFilter
          presets={[
            "all",
            "today",
            "yesterday",
            "thisWeek",
            "lastWeek",
            "thisMonth",
            "lastMonth",
          ]}
        />
      </div>

      {/* 2패널 (b6) — 데스크톱: 좌 1/3 목록 + 우 상세 독립 스크롤 / <768px: 목록→상세 스택 */}
      <div className="bg-admin-bg border border-admin-card rounded-xl overflow-hidden flex flex-col md:flex-row md:h-[calc(100vh-16rem)] md:min-h-[480px]">
        {/* 좌측: 태스크 목록 */}
        <section className="md:w-1/3 md:border-r border-b md:border-b-0 border-admin-card flex flex-col shrink-0 max-h-[40vh] md:max-h-none">
          <div className="p-4 border-b border-admin-card flex items-center justify-between bg-admin-card/20 shrink-0">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
              {t("queueHeader")}
            </span>
            <span className="text-[10px] px-2 py-0.5 bg-slate-800 text-slate-300 rounded-full">
              {t("countBadge", { count: tasks.length })}
            </span>
          </div>
          <div className="flex-1 overflow-y-auto">
            {tasks.length === 0 ? (
              <p className="p-8 text-center text-sm text-admin-muted">{t("empty")}</p>
            ) : (
              tasks.map((task) => {
                const active = task.id === selected?.id;
                return (
                  <Link
                    key={task.id}
                    href={taskHref(task.id)}
                    aria-current={active ? "true" : undefined}
                    className={
                      active
                        ? "block p-4 border-b border-admin-card bg-admin-card border-l-4 border-l-admin-primary"
                        : "block p-4 border-b border-admin-card hover:bg-admin-card/30 transition-colors border-l-4 border-l-transparent"
                    }
                  >
                    <div className="flex justify-between items-start mb-2 gap-2">
                      <h3
                        className={`text-sm font-bold truncate ${active ? "text-white" : "text-slate-200"}`}
                      >
                        {task.villaName}
                      </h3>
                      <span className="text-[10px] text-slate-500 tabular-nums shrink-0">
                        {formatDateTime(new Date(task.createdAt))}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mb-3">{t(`typeLong.${task.type}`)}</p>
                    <div className="flex items-center justify-between">
                      {statusBadge(task.status)}
                      <span
                        className="material-symbols-outlined text-slate-600 text-sm"
                        aria-hidden
                      >
                        chevron_right
                      </span>
                    </div>
                  </Link>
                );
              })
            )}
          </div>
        </section>

        {/* 우측: 상세 패널 */}
        <section className="flex-1 flex flex-col min-w-0">
          {!selected ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 p-12 text-sm text-admin-muted">
              <span className="material-symbols-outlined text-4xl text-slate-700" aria-hidden>
                cleaning_services
              </span>
              {t("selectPrompt")}
            </div>
          ) : (
            <>
              {/* 상세 헤더 */}
              <div className="p-6 border-b border-admin-card shrink-0">
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <h2 className="text-xl font-bold text-white">
                    {selected.villaName} — {t(`typeLong.${selected.type}`)}
                  </h2>
                  {statusBadge(selected.status)}
                </div>
                <div className="flex items-center gap-4 text-xs text-slate-400 flex-wrap">
                  <span className="flex items-center gap-1 whitespace-nowrap">
                    <span className="material-symbols-outlined text-sm" aria-hidden>
                      photo_library
                    </span>
                    {td("photosSubmitted", { count: selected.photoUrls.length })}
                  </span>
                  <span className="flex items-center gap-1 whitespace-nowrap tabular-nums">
                    <span className="material-symbols-outlined text-sm" aria-hidden>
                      schedule
                    </span>
                    {td("createdAt", { datetime: formatDateTime(new Date(selected.createdAt)) })}
                  </span>
                  {selected.dueDate && (
                    <span className="flex items-center gap-1 whitespace-nowrap tabular-nums">
                      <span className="material-symbols-outlined text-sm" aria-hidden>
                        event
                      </span>
                      {td("dueDate", { date: dotDate(selected.dueDate) })}
                    </span>
                  )}
                  {selected.approvedAt && (
                    <span className="flex items-center gap-1 whitespace-nowrap tabular-nums text-green-500">
                      <span className="material-symbols-outlined text-sm" aria-hidden>
                        check_circle
                      </span>
                      {td("approvedAt", {
                        datetime: formatDateTime(new Date(selected.approvedAt)),
                      })}
                    </span>
                  )}
                </div>
              </div>

              {/* 사진 비교 그리드 — 스크롤 영역 */}
              <div className="flex-1 md:overflow-y-auto p-6 space-y-8">
                {/* 반려된 태스크 — 반려 사유 박스 */}
                {selected.status === "REJECTED" && selected.rejectNote && (
                  <div className="p-4 rounded-lg bg-red-900/20 border border-red-900/40">
                    <p className="text-xs font-bold text-red-400 mb-1 flex items-center gap-1">
                      <span className="material-symbols-outlined text-sm" aria-hidden>
                        cancel
                      </span>
                      {td("rejectNoteTitle")}
                    </p>
                    <p className="text-sm text-slate-300 whitespace-pre-wrap">
                      {selected.rejectNote}
                    </p>
                  </div>
                )}

                {pairCount === 0 ? (
                  <p className="py-12 text-center text-sm text-admin-muted">{td("noPhotos")}</p>
                ) : (
                  Array.from({ length: pairCount }, (_, i) => {
                    const baseline = selected.baselinePhotos[i];
                    const submittedUrl = selected.photoUrls[i];
                    return (
                      <div key={baseline?.id ?? `extra-${i}`}>
                        {/* 쌍 라벨 — 공간명, 밝은 라이트 그레이 #E5E7EB (b6 대비 요구) */}
                        <div className="flex items-center gap-2 mb-4">
                          <span className="w-1 h-4 bg-admin-primary rounded" aria-hidden />
                          <h4 className="text-sm font-bold text-[#E5E7EB]">{pairLabel(i)}</h4>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          {/* 기준 사진 — 개수 불일치(없음) 시 청소 후 단독 표시 */}
                          {baseline ? (
                            <div className="space-y-2">
                              <p className="text-[10px] text-[#E5E7EB] font-bold uppercase tracking-tight">
                                {td("baseline")}
                              </p>
                              <button
                                type="button"
                                onClick={() => openLightbox(baseline.url)}
                                aria-label={`${pairLabel(i)} — ${td("baseline")}`}
                                className="block w-full aspect-video rounded overflow-hidden border border-admin-card relative bg-slate-800 cursor-zoom-in"
                              >
                                <Image
                                  src={baseline.url}
                                  alt={`${pairLabel(i)} — ${td("baseline")}`}
                                  fill
                                  sizes="(max-width: 768px) 100vw, 33vw"
                                  className="object-cover"
                                />
                              </button>
                            </div>
                          ) : (
                            <div className="space-y-2">
                              <p className="text-[10px] text-[#E5E7EB] font-bold uppercase tracking-tight">
                                {td("baseline")}
                              </p>
                              <div className="aspect-video rounded border border-dashed border-slate-700 flex items-center justify-center text-xs text-slate-600">
                                {td("noBaseline")}
                              </div>
                            </div>
                          )}
                          {/* 청소 후 사진 — 없으면 기준 사진 단독 표시 */}
                          {submittedUrl ? (
                            <div className="space-y-2">
                              <p className="text-[10px] text-blue-400 font-bold uppercase tracking-tight">
                                {td("after")}
                              </p>
                              <button
                                type="button"
                                onClick={() => openLightbox(submittedUrl)}
                                aria-label={`${pairLabel(i)} — ${td("after")}`}
                                className="block w-full aspect-video rounded overflow-hidden border border-admin-primary/30 relative bg-slate-800 cursor-zoom-in"
                              >
                                <Image
                                  src={submittedUrl}
                                  alt={`${pairLabel(i)} — ${td("after")}`}
                                  fill
                                  sizes="(max-width: 768px) 100vw, 33vw"
                                  className="object-cover"
                                />
                              </button>
                            </div>
                          ) : (
                            <div className="space-y-2">
                              <p className="text-[10px] text-blue-400 font-bold uppercase tracking-tight">
                                {td("after")}
                              </p>
                              <div className="aspect-video rounded border border-dashed border-slate-700 flex items-center justify-center text-xs text-slate-600">
                                {td("noSubmission")}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* 하단 액션 바 (b6) — PHOTOS_SUBMITTED만 활성 */}
              <footer className="p-6 border-t border-admin-card flex flex-col gap-4 shrink-0">
                {/* 결과 메시지 — 게이트 열림은 강조 배너 */}
                {message && (
                  <div
                    role="status"
                    className={
                      message.tone === "gate"
                        ? "flex items-center gap-2 p-3 rounded-lg bg-green-900/20 border border-green-700/40 text-sm font-bold text-green-400"
                        : message.tone === "ok"
                          ? "text-xs font-medium text-emerald-500"
                          : "text-xs font-medium text-red-400"
                    }
                  >
                    {message.tone === "gate" && (
                      <span className="material-symbols-outlined text-base" aria-hidden>
                        storefront
                      </span>
                    )}
                    {message.text}
                  </div>
                )}

                <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                  {/* 반려 사유 입력 — 반려 선택 시 노출, 공백이면 제출 불가 */}
                  {rejectMode && actionable && (
                    <div className="flex-1">
                      <textarea
                        value={rejectNote}
                        onChange={(e) => setRejectNote(e.target.value)}
                        maxLength={REJECT_NOTE_MAX}
                        rows={2}
                        placeholder={td("rejectPlaceholder")}
                        className="w-full bg-admin-card border border-slate-700 text-sm text-white px-4 py-2.5 rounded focus:ring-1 focus:ring-red-500/50 focus:border-red-500/50 outline-none transition-all resize-none"
                      />
                      <p className="mt-1 text-[10px] text-slate-500 tabular-nums">
                        {td("noteLength", { len: rejectNote.length, max: REJECT_NOTE_MAX })}
                      </p>
                    </div>
                  )}
                  <div className="flex items-center gap-3 sm:ml-auto shrink-0">
                    {rejectMode && actionable && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setRejectMode(false);
                          setRejectNote("");
                          setMessage(null);
                        }}
                        className="px-4 py-2.5 text-sm font-bold text-admin-muted hover:text-white transition-colors disabled:opacity-50"
                      >
                        {td("cancelReject")}
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={!actionable || busy || (rejectMode && !rejectNote.trim())}
                      onClick={() => void reject()}
                      className="px-6 py-2.5 border border-red-500 text-red-500 font-bold text-sm rounded hover:bg-red-500/10 transition-colors flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                    >
                      <span className="material-symbols-outlined text-sm" aria-hidden>
                        cancel
                      </span>
                      {td("reject")}
                    </button>
                    {!rejectMode && (
                      <button
                        type="button"
                        disabled={!actionable || busy}
                        onClick={() => void approve()}
                        className="px-10 py-2.5 bg-green-600 text-white font-bold text-sm rounded hover:bg-green-700 transition-colors flex items-center gap-2 shadow-lg shadow-green-900/20 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-green-600"
                      >
                        <span className="material-symbols-outlined text-sm" aria-hidden>
                          check_circle
                        </span>
                        {td("approve")}
                      </button>
                    )}
                  </div>
                </div>

                {/* 안내 문구 (b6) — 정기 청소는 게이트에 영향 없음 */}
                <div className="flex items-center gap-2 text-slate-500">
                  <span className="material-symbols-outlined text-xs" aria-hidden>
                    info
                  </span>
                  <p className="text-[11px] font-medium tracking-tight">
                    {selected.type === "CHECKOUT" ? td("gateNote") : td("periodicNote")}
                  </p>
                </div>
              </footer>
            </>
          )}
        </section>
      </div>

      <ImageLightbox images={lightboxImages} index={lightbox} onIndexChange={setLightbox} />
    </div>
  );
}
