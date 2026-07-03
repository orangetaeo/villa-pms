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
import { buildInspectionRows, type SlotRef } from "@/lib/cleaning-photo-pairs";
import { formatDateTime } from "@/lib/format";
import QuickDateFilter from "@/components/admin/quick-date-filter";
import PaginationBar from "@/components/pagination-bar";
import ListSearch from "@/components/list-search";
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
  /** photoUrls와 병렬 슬롯 id — 있으면 기준 사진과 슬롯 매칭 페어링(스킵 슬롯 정렬 유지) */
  photoSlots: string[];
  rejectNote: string | null;
  approvedAt: string | null; // ISO
  dueDate: string | null; // ISO (@db.Date)
  createdAt: string; // ISO
  assigneeId: string | null; // 현재 청소 담당자(없으면 공급자 담당)
  assigneeName: string | null;
  villaName: string;
  complex: string | null;
  baselinePhotos: BaselinePhoto[];
}

export interface CleanerOption {
  id: string;
  name: string;
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
  /** ?task= 가 명시됐는지 — 모바일에서 목록/상세 전환 기준(첫 태스크 자동선택과 구분) */
  taskSelected: boolean;
  tab: string;
  counts: Record<TabKey, number>;
  range?: string;
  area?: string;
  areaOptions: string[];
  /** 개별 재배정 드롭다운용 CLEANER 목록 */
  cleaners: CleanerOption[];
  /** 좌측 큐 페이지네이션 (URL 모드) — total=정렬된 전체(상한 200) */
  pagination: { total: number; page: number; pageSize: number };
}

export default function InspectionsView({
  tasks,
  selected,
  taskSelected,
  tab,
  counts,
  range,
  area,
  areaOptions,
  cleaners,
  pagination,
}: Props) {
  const t = useTranslations("adminInspections.list");
  const td = useTranslations("adminInspections.detail");
  const router = useRouter();

  const [busy, setBusy] = useState(false);
  // 빌라명 검색 (controlled, 인메모리). 좌측 큐가 서버 페이지네이션이라 현재 페이지 안에서
  // 부분일치 필터 — 검색 활성 시 페이지네이션은 의미가 없어 숨기고, 큐 헤더 개수도 검색 결과로 바꾼다.
  const [search, setSearch] = useState("");
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [rejectMode, setRejectMode] = useState(false);
  const [rejectNote, setRejectNote] = useState("");
  const [message, setMessage] = useState<{ tone: "ok" | "gate" | "error"; text: string } | null>(
    null
  );

  const actionable = selected?.status === "PHOTOS_SUBMITTED";

  // 검색 필터 — 상태/지역/날짜로 서버가 거르고 슬라이스한 현재 페이지(tasks) 위에서 빌라명 부분일치.
  // (공급자명은 leak-checklist상 목록 select에 미포함이라 대상 아님 — 보고 참조)
  const searchQ = search.trim().toLowerCase();
  const filteredTasks = searchQ
    ? tasks.filter((task) => task.villaName.toLowerCase().includes(searchQ))
    : tasks;
  const searching = searchQ.length > 0;

  /** 개별 재배정 — 이 청소 1건만 다른 담당자에게(빌라 기본 담당과 별개). 빈값=미지정(공급자). */
  const reassign = async (assigneeId: string) => {
    if (!selected || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/cleaning-tasks/${selected.id}/reassign`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assigneeId: assigneeId || null }),
      });
      if (!res.ok) {
        setMessage({ tone: "error", text: td("reassignError") });
        return;
      }
      setMessage({ tone: "ok", text: td("reassigned") });
      router.refresh();
    } catch {
      setMessage({ tone: "error", text: td("reassignError") });
    } finally {
      setBusy(false);
    }
  };

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

  // 제출 사진·기준 사진 쌍 — photoSlots(슬롯 id) 매칭. 선택 슬롯(발코니 등)을 건너뛴
  // 제출도 정렬이 어긋나지 않는다. photoSlots 없는 레거시 제출은 종전 인덱스 페어링.
  const { rows: pairRows } = selected
    ? buildInspectionRows({
        photoUrls: selected.photoUrls,
        photoSlots: selected.photoSlots,
        baselines: selected.baselinePhotos,
      })
    : { rows: [] };

  /** 행 라벨 — 공간명(+침실/욕실 번호), 슬롯 미상이면 "추가 사진 n" */
  const rowLabel = (slot: SlotRef | null, unknownSeq: number): string => {
    if (!slot) return td("extraPhoto", { n: unknownSeq });
    const base = td(`spaces.${slot.space}`);
    return slot.index !== undefined ? `${base} ${slot.index}` : base;
  };
  // 라벨 미상 행 일련번호(추가 사진 1, 2, …) — 행 순서 기준 사전 계산
  let unknownSeq = 0;
  const pairLabels = pairRows.map((row) => rowLabel(row.slot, row.slot ? 0 : ++unknownSeq));

  // 라이트박스 이미지 목록 — 쌍별 기준→청소후 순서대로 평탄화 (클릭 시 해당 위치에서 확대)
  const lightboxImages: LightboxImage[] = pairRows.flatMap((row, i) => {
    const items: LightboxImage[] = [];
    if (row.baselineUrl) items.push({ url: row.baselineUrl, label: `${pairLabels[i]} · ${td("baseline")}` });
    if (row.submittedUrl) items.push({ url: row.submittedUrl, label: `${pairLabels[i]} · ${td("after")}` });
    return items;
  });
  const openLightbox = (url: string) => {
    const idx = lightboxImages.findIndex((im) => im.url === url);
    if (idx >= 0) setLightbox(idx);
  };

  // range·area는 모든 내부 링크에 보존 — 탭/행 전환 시 활성 날짜·지역 필터 유지
  const rangeQs = range ? `&range=${range}` : "";
  const areaQs = area ? `&area=${encodeURIComponent(area)}` : "";
  const taskHref = (taskId: string) =>
    `/inspections?status=${tab}&task=${taskId}${rangeQs}${areaQs}`;
  const tabHref = (key: TabKey) => `/inspections?status=${key}${rangeQs}${areaQs}`;

  // 지역 변경 — 목록이 바뀌므로 선택(task)은 해제, 탭·날짜는 유지
  const changeArea = (value: string) => {
    const sp = new URLSearchParams();
    sp.set("status", tab);
    if (range) sp.set("range", range);
    if (value) sp.set("area", value);
    router.replace(`/inspections?${sp.toString()}`);
  };

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
        {/* 빠른 날짜 필터 + 지역(단지) 필터 — createdAt 기준, 과거 지향 목록이라 nextMonth 제외 */}
        <div className="flex flex-wrap items-center gap-3">
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
          {areaOptions.length > 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 whitespace-nowrap">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                {t("area")}
              </span>
              <select
                aria-label={t("area")}
                className="cursor-pointer border-none bg-transparent p-0 pr-6 text-sm text-slate-300 focus:ring-0"
                value={area ?? ""}
                onChange={(e) => changeArea(e.target.value)}
              >
                <option value="" className="bg-slate-900">
                  {t("allAreas")}
                </option>
                {areaOptions.map((a) => (
                  <option key={a} value={a} className="bg-slate-900">
                    {a}
                  </option>
                ))}
              </select>
            </div>
          )}
          {/* 빌라명 검색 — 현재 큐(현재 페이지) 인메모리 부분일치 */}
          <ListSearch
            placeholder={t("searchPlaceholder")}
            value={search}
            onChange={setSearch}
            className="max-w-xs"
          />
        </div>
      </div>

      {/* 2패널 (b6) — 데스크톱: 좌 1/3 목록 + 우 상세 독립 스크롤 / <768px: 목록→상세 스택 */}
      <div className="bg-admin-bg border border-admin-card rounded-xl overflow-hidden flex flex-col md:flex-row md:h-[calc(100vh-16rem)] md:min-h-[480px]">
        {/* 좌측: 태스크 목록 — 모바일은 마스터-디테일(선택 시 목록 숨기고 상세 전체화면) */}
        <section
          className={`md:w-1/3 md:border-r border-b md:border-b-0 border-admin-card flex-col shrink-0 md:max-h-none md:flex ${
            taskSelected ? "hidden md:flex" : "flex"
          }`}
        >
          <div className="p-4 border-b border-admin-card flex items-center justify-between bg-admin-card/20 shrink-0">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
              {t("queueHeader")}
            </span>
            <span className="text-[10px] px-2 py-0.5 bg-slate-800 text-slate-300 rounded-full">
              {t("countBadge", {
                count: searching ? filteredTasks.length : counts[tab as TabKey] ?? pagination.total,
              })}
            </span>
          </div>
          <div className="flex-1 overflow-y-auto">
            {filteredTasks.length === 0 ? (
              <p className="p-8 text-center text-sm text-admin-muted">
                {searching ? t("searchEmpty") : t("empty")}
              </p>
            ) : (
              filteredTasks.map((task) => {
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
          {/* 큐 페이지네이션 (URL 모드, 다크) — 1페이지뿐이어도 요약·개수선택 노출.
              검색 중에는 현재 페이지 안 인메모리 필터라 페이지 이동이 무의미해 숨김 */}
          {!searching && pagination.total > 0 && (
            <div className="shrink-0 px-3 pb-3">
              <PaginationBar
                total={pagination.total}
                page={pagination.page}
                pageSize={pagination.pageSize}
              />
            </div>
          )}
        </section>

        {/* 우측: 상세 패널 — 모바일은 선택 시에만 표시(목록 대체) */}
        <section
          className={`flex-1 flex-col min-w-0 ${taskSelected ? "flex" : "hidden md:flex"}`}
        >
          {/* 모바일 전용: 목록으로 돌아가기 (선택 유무와 무관하게 항상 노출) */}
          <Link
            href={tabHref(tab as TabKey)}
            className="md:hidden flex items-center gap-1 px-4 pt-4 text-sm font-medium text-admin-muted hover:text-white shrink-0"
          >
            <span className="material-symbols-outlined text-base" aria-hidden>
              arrow_back
            </span>
            {t("backToList")}
          </Link>
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

                {/* 개별 담당자 재배정 — 이 청소 1건만 다른 직원에게(빌라 기본 담당과 별개, 일회성) */}
                <div className="mt-3 flex items-center gap-2">
                  <span className="material-symbols-outlined text-sm text-slate-400" aria-hidden>
                    assignment_ind
                  </span>
                  <span className="text-xs text-slate-400 whitespace-nowrap">
                    {td("assigneeLabel")}
                  </span>
                  <select
                    aria-label={td("assigneeLabel")}
                    value={selected.assigneeId ?? ""}
                    disabled={busy}
                    onChange={(e) => void reassign(e.target.value)}
                    className="min-w-0 flex-1 rounded-lg bg-slate-900/60 border border-slate-700 px-2 py-1.5 text-xs text-white focus:border-admin-primary focus:outline-none disabled:opacity-50"
                  >
                    {/* 미지정 = 공급자 담당 */}
                    <option value="">{td("assigneeUnassigned")}</option>
                    {cleaners.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
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

                {pairRows.length === 0 ? (
                  <p className="py-12 text-center text-sm text-admin-muted">{td("noPhotos")}</p>
                ) : (
                  pairRows.map((row, i) => (
                    <div key={row.key}>
                      {/* 쌍 라벨 — 공간명, 밝은 라이트 그레이 #E5E7EB (b6 대비 요구) */}
                      <div className="flex items-center gap-2 mb-4">
                        <span className="w-1 h-4 bg-admin-primary rounded" aria-hidden />
                        <h4 className="text-sm font-bold text-[#E5E7EB]">{pairLabels[i]}</h4>
                      </div>
                      <div className="grid grid-cols-2 gap-3 sm:gap-4">
                        {/* 기준 사진 — 없으면(기준 미등록) 자리 표시 */}
                        {row.baselineUrl ? (
                          <div className="space-y-2">
                            <p className="text-[10px] text-[#E5E7EB] font-bold uppercase tracking-tight">
                              {td("baseline")}
                            </p>
                            <button
                              type="button"
                              onClick={() => openLightbox(row.baselineUrl as string)}
                              aria-label={`${pairLabels[i]} — ${td("baseline")}`}
                              className="block w-full aspect-video rounded overflow-hidden border border-admin-card relative bg-slate-800 cursor-zoom-in"
                            >
                              <Image
                                src={row.baselineUrl}
                                alt={`${pairLabels[i]} — ${td("baseline")}`}
                                fill
                                sizes="(max-width: 768px) 50vw, 33vw"
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
                        {/* 청소 후 사진 — 없으면(스킵 슬롯 등) 자리 표시 */}
                        {row.submittedUrl ? (
                          <div className="space-y-2">
                            <p className="text-[10px] text-blue-400 font-bold uppercase tracking-tight">
                              {td("after")}
                            </p>
                            <button
                              type="button"
                              onClick={() => openLightbox(row.submittedUrl as string)}
                              aria-label={`${pairLabels[i]} — ${td("after")}`}
                              className="block w-full aspect-video rounded overflow-hidden border border-admin-primary/30 relative bg-slate-800 cursor-zoom-in"
                            >
                              <Image
                                src={row.submittedUrl}
                                alt={`${pairLabels[i]} — ${td("after")}`}
                                fill
                                sizes="(max-width: 768px) 50vw, 33vw"
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
                  ))
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
