"use client";

// 빌라별 공실 보드 격자 (b11-availability-board 변환, 운영자 다크 ko)
// 빌라(행)×날짜(열) 채널매니저 타임라인. 빌라명 열 sticky + 날짜 가로 스크롤, 월/일 2단 헤더.
// 셀 3상태(AVAILABLE/MANUAL/ICAL) 색+패턴+아이콘 (색약 대응). 셀 탭 → 잠금/해제 팝오버.
// 잠금/해제: 기존 /api/calendar-blocks (ADMIN 허용으로 보강됨). 낙관적 업데이트 + router.refresh().
// i18n: (admin)/layout.tsx 화이트리스트 수정 금지 → 모든 문구를 서버에서 props(strings)로 받음.
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import type { BoardBookingSummary, BoardCell } from "@/lib/availability";

export interface BoardColumn {
  iso: string; // YYYY-MM-DD
  day: number;
  dow: number; // 0=일 … 6=토
  isWeekend: boolean;
  isToday: boolean;
  isMonthStart?: boolean;
}

export interface BoardMonthGroup {
  ym: string; // YYYY-MM
  label: string;
  span: number; // colspan
  startIndex: number; // columns 내 시작 인덱스
}

export interface BoardRow {
  id: string;
  name: string;
  complex: string | null;
  checkedLabel: string | null; // "M/D" or null
  needCheck: boolean;
  qualityScore: number; // 청소 검수 통과율(0~100) — 판매 후순위 정렬·표시 (Phase 2)
  days: BoardCell[];
}

export interface BoardStrings {
  villaCount: string;
  qualityTitle: string; // 품질점수 배지 툴팁 (Phase 2)
  search: string;
  area: string;
  allAreas: string;
  villa: string;
  allVillas: string;
  needCheckOnly: string;
  today: string;
  prevPeriod: string;
  nextPeriod: string;
  legendAvailable: string;
  legendManual: string;
  legendIcal: string;
  legendBooking: string;
  legendChecked: string;
  legendNeedCheck: string;
  badgeChecked: string; // contains {date}
  badgeNeedCheck: string; // contains {date}
  badgeNever: string;
  confirmCheck: string;
  empty: string;
  cellAvailable: string;
  cellManual: string;
  cellIcal: string;
  cellBooking: string;
  // ── DIRECT 빌라 예약 팝오버 ──
  bkStatusHold: string;
  bkStatusConfirmed: string;
  bkStatusCheckedIn: string;
  bkNights: string; // {n}
  bkGuest: string;
  bkGuestCount: string; // {n}
  bkChannel: string;
  bkChannelTravel: string;
  bkChannelLand: string;
  bkChannelDirect: string;
  bkSeller: string;
  bkSellerOperator: string;
  bkSellerSupplier: string;
  bkCost: string;
  bkSale: string;
  bkDeposit: string;
  bkDepositNone: string;
  bkDepositHeld: string;
  bkDepositRefunded: string;
  bkDepositPartial: string;
  bkHoldExpires: string; // {time}
  bkHoldExpired: string;
  bkOpenDetail: string;
  weekdays: string[]; // [일,월,…,토]
  popStateLabel: string;
  popStateAvailable: string;
  popStateManual: string;
  popLock: string;
  popUnlock: string;
  popProcessing: string;
  popHint: string;
  popConflict: string;
  popError: string;
  popClose: string;
  icalTitle: string;
  icalDesc: string;
  icalInfo: string;
  rangeDays: string; // contains {n}
  rangeDateRange: string; // contains {start} {end}
  rangeSummary: string; // contains {lockable} {unlockable}
  rangeLock: string; // contains {n}
  rangeUnlock: string; // contains {n}
  rangeHint: string;
  rangeProcessing: string;
  rangeError: string;
  collapseList: string; // 빌라명 열 접기 토글 라벨
  expandList: string; // 빌라명 열 펴기 토글 라벨
  selectHint: string; // 길게눌러 드래그 안내
  rangeModeLabel: string; // 범위 선택(두 번 탭) 토글 라벨
  rangeModeHint: string; // 범위 선택 모드 ON, 시작 전 안내
  rangeModeAnchorHint: string; // 범위 선택 모드 ON, 시작 탭 후 안내
}

interface Props {
  columns: BoardColumn[];
  monthGroups: BoardMonthGroup[];
  rows: BoardRow[];
  areaOptions: string[];
  /** 빌라 셀렉터 옵션 — 선택된 지역의 빌라(지역 미선택 시 전체) */
  villaOptions: { id: string; name: string }[];
  startMonth: string;
  prevMonth: string | null; // null = 현재 기간(이전이 전부 과거) → 비활성
  nextMonth: string;
  thisMonth: string;
  periodLabel: string;
  area: string;
  villaId: string;
  search: string;
  needCheckOnly: boolean;
  strings: BoardStrings;
}

// b11 NOTES 셀 토큰 (globals.css 수정 금지 → 컴포넌트 스코프 <style> 주입)
const BOARD_CSS = `
.nowrap-cell { white-space: nowrap; }
.ab-scroll::-webkit-scrollbar { width: 10px; height: 10px; }
.ab-scroll::-webkit-scrollbar-track { background: #0F172A; }
.ab-scroll::-webkit-scrollbar-thumb { background: #334155; border-radius: 5px; }
.ab-scroll::-webkit-scrollbar-thumb:hover { background: #475569; }
.ab-cell-available { background-color: transparent; }
.ab-cell-available:hover { background-color: rgba(59,130,246,0.10); }
.ab-cell-manual {
  background-color: #475569;
  background-image: repeating-linear-gradient(45deg, rgba(15,23,42,0.55) 0, rgba(15,23,42,0.55) 2px, transparent 2px, transparent 7px);
}
.ab-cell-manual:hover { background-color: #64748B; }
.ab-cell-ical {
  background-color: rgba(245,158,11,0.22);
  background-image: repeating-linear-gradient(-45deg, rgba(245,158,11,0.55) 0, rgba(245,158,11,0.55) 2px, transparent 2px, transparent 7px);
  cursor: not-allowed;
}
.ab-cell-booking-confirmed { background-color: #0F766E; cursor: pointer; }
.ab-cell-booking-confirmed:hover { background-color: #0D9488; }
.ab-cell-booking-hold {
  background-color: rgba(13,148,136,0.30);
  background-image: repeating-linear-gradient(45deg, rgba(13,148,136,0.65) 0, rgba(13,148,136,0.65) 2px, transparent 2px, transparent 7px);
  cursor: pointer;
}
.ab-cell-booking-hold:hover { background-color: rgba(13,148,136,0.45); }
.ab-col-today { box-shadow: inset 1px 0 0 #3B82F6, inset -1px 0 0 #3B82F6; }
.ab-col-weekend { background-color: rgba(2,6,23,0.35); }
.ab-month-edge { box-shadow: inset 2px 0 0 #334155; }
.ab-sticky-col { position: sticky; left: 0; z-index: 20; background-color: #1E293B; }
.ab-grid-cell { width: 36px; min-width: 36px; height: 44px; border-right: 1px solid rgba(30,41,59,0.6); border-bottom: 1px solid rgba(30,41,59,0.6); cursor: pointer; transition: background-color .12s; padding: 0; }
.ab-range-sel { box-shadow: inset 0 0 0 2px #3B82F6; background-color: rgba(59,130,246,0.22) !important; background-image: none !important; }
.ab-dragging { user-select: none; -webkit-user-select: none; }
.ab-dragging .ab-grid-cell { cursor: ew-resize; }
`;

const ROW_H = 34; // 월 헤더 행 높이 (일 행 sticky top 계산용)

type PopState =
  | { kind: "block"; villaId: string; villaName: string; col: BoardColumn; status: "AVAILABLE" | "MANUAL"; blockId: string | null; x: number; y: number }
  | { kind: "ical"; col: BoardColumn; x: number; y: number }
  | { kind: "booking"; villaName: string; booking: BoardBookingSummary; x: number; y: number };

/** 가로 드래그 진행 상태 (마우스/펜 = 즉시 드래그, 터치 = 길게눌러 드래그) */
interface DragState {
  villaId: string;
  anchorIdx: number;
  overIdx: number;
  touch?: boolean; // 터치 길게눌러 드래그로 시작됨 → 종료는 touchend 가 담당
}

/** 드래그로 확정된 범위 팝오버 */
interface RangePop {
  villaId: string;
  villaName: string;
  lo: number; // 시작 컬럼 인덱스 (포함)
  hi: number; // 끝 컬럼 인덱스 (포함)
  x: number;
  y: number;
}

/** YYYY-MM-DD → "YYYY.MM.DD (요일)" */
function fmtDateDow(iso: string, weekdays: string[]): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${y}.${String(m).padStart(2, "0")}.${String(d).padStart(2, "0")} (${weekdays[dow]})`;
}

/** YYYY-MM-DD → "M/D" (예약 팝오버 기간 표기용) */
function fmtMd(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${Number(m)}/${Number(d)}`;
}

/** 천 단위 콤마 — 숫자/BigInt 문자열 모두 안전(부동소수점 미사용) */
function fmtThousands(v: number | string): string {
  return v.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * HOLD 만료까지 남은 시간 "Xh Ym" / "Ym". 이미 지났으면 null.
 * 팝오버는 클릭 시 클라이언트에서만 렌더되므로 Date.now() 하이드레이션 불일치 없음.
 */
function fmtHoldRemaining(iso: string): string | null {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return null;
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default function AvailabilityBoardClient({
  columns,
  monthGroups,
  rows,
  areaOptions,
  villaOptions,
  startMonth,
  prevMonth,
  nextMonth,
  thisMonth,
  periodLabel,
  area,
  villaId,
  search,
  needCheckOnly,
  strings: s,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // 빌라명 열(sticky) 접기/펴기 — 모바일에서 달력 가시 영역 확보용. 접으면 48px(상태 아이콘만)
  const [villaColCollapsed, setVillaColCollapsed] = useState(false);
  const colW = villaColCollapsed ? 48 : 240;

  // 낙관적 셀 상태 오버레이: "villaId|iso" → BoardCell. 서버 refresh 시 비움.
  const [optimistic, setOptimistic] = useState<Record<string, BoardCell>>({});
  // 낙관적 확인일 오버레이: villaId → "M/D"
  const [checkedOverlay, setCheckedOverlay] = useState<Record<string, string>>({});
  const [pop, setPop] = useState<PopState | null>(null);
  const [pending, setPending] = useState(false);
  const [errorKey, setErrorKey] = useState<"conflict" | "error" | null>(null);

  // ── 가로 드래그 범위 선택 (마우스/펜 = 즉시, 터치 = 길게눌러) ──
  const [drag, setDrag] = useState<DragState | null>(null);
  const [rangePop, setRangePop] = useState<RangePop | null>(null);
  const [rangePending, setRangePending] = useState(false);
  const [rangeError, setRangeError] = useState(false);
  // 두 번 탭(보조 모드): 시작 날짜 탭 → (스크롤) → 끝 날짜 탭. 긴 범위용. 길게눌러 드래그와 병행.
  const [rangeMode, setRangeMode] = useState(false);
  const [tapAnchor, setTapAnchor] = useState<{ villaId: string; idx: number } | null>(null);
  // 드래그로 여러 셀 이동했는지 — 뒤따르는 onClick 이 단일 팝오버를 또 열지 않도록 가드
  const movedRef = useRef(false);
  // 최신 drag 값을 window pointerup / touchend 핸들러에서 읽기 위한 ref
  const dragRef = useRef<DragState | null>(null);
  dragRef.current = drag;
  // 마지막 포인터/터치 좌표 (범위 팝오버 위치 산출용)
  const lastPointerRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  // 가로 스크롤 컨테이너 (터치 네이티브 리스너 부착용)
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // 범위 팝오버 열기 — 드래그·두 번 탭 공통. 화면 밖으로 안 나가게 좌표 클램프.
  function openRangePop(villaId: string, villaName: string, lo: number, hi: number, x: number, y: number) {
    setErrorKey(null);
    setPop(null);
    setRangeError(false);
    setRangePop({
      villaId,
      villaName,
      lo,
      hi,
      x: Math.max(8, Math.min(x, window.innerWidth - 280)),
      y: Math.max(8, Math.min(y + 8, window.innerHeight - 260)),
    });
  }

  // 드래그 확정 → 범위 팝오버. 마우스/펜은 pointerup, 터치는 touchend 에서 호출.
  function finalizeDrag(d: DragState) {
    const lo = Math.min(d.anchorIdx, d.overIdx);
    const hi = Math.max(d.anchorIdx, d.overIdx);
    setDrag(null);
    dragRef.current = null;
    if (lo === hi) {
      // 움직임 없음 → 단일 셀 동작은 onClick 가 처리. 여기선 아무것도 안 함.
      movedRef.current = false;
      return;
    }
    // 여러 셀 → 범위 팝오버. 뒤따르는 onClick 차단 플래그 유지(클릭 핸들러가 리셋)
    movedRef.current = true;
    const row = rows.find((r) => r.id === d.villaId);
    if (!row) return;
    openRangePop(d.villaId, row.name, lo, hi, lastPointerRef.current.x, lastPointerRef.current.y);
  }
  // 최신 finalizeDrag 를 네이티브 리스너(mount 1회 등록)에서 stale 없이 호출
  const finalizeRef = useRef(finalizeDrag);
  finalizeRef.current = finalizeDrag;

  // 드래그 종료(마우스/펜) — window pointerup 한 번만 등록. 터치는 touch:true 라 건너뜀.
  useEffect(() => {
    function onUp() {
      const d = dragRef.current;
      if (!d || d.touch) return; // 터치 드래그는 touchend 가 확정
      finalizeRef.current(d);
    }
    window.addEventListener("pointerup", onUp);
    return () => window.removeEventListener("pointerup", onUp);
  }, []);

  // ── 터치: 길게눌러(0.4s) 드래그로 범위 선택 ──
  // 누른 직후 0.4s 안에 손가락이 움직이면 스크롤 의도로 보고 취소(정상 스크롤 유지).
  // 0.4s 유지되면 선택 모드 진입 → touchmove preventDefault 로 스크롤 잠그고 손가락 밑 셀 추적.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const LONG_PRESS_MS = 400;
    const MOVE_CANCEL_PX = 8; // 진입 전 이 이상 움직이면 스크롤로 간주
    let timer: number | null = null;
    let anchorVillaId: string | null = null;
    let startX = 0;
    let startY = 0;
    let dragging = false;

    function cellAt(x: number, y: number): { villaId: string; idx: number; ical: boolean } | null {
      const t = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest(
        "[data-ab-cell]"
      ) as HTMLElement | null;
      if (!t) return null;
      const villaId = t.getAttribute("data-villa");
      const idx = Number(t.getAttribute("data-idx"));
      if (!villaId || Number.isNaN(idx)) return null;
      return { villaId, idx, ical: t.classList.contains("ab-cell-ical") };
    }

    function clearTimer() {
      if (timer != null) {
        window.clearTimeout(timer);
        timer = null;
      }
    }

    function onTouchStart(e: TouchEvent) {
      if (e.touches.length !== 1) return; // 멀티터치(핀치 등) 무시
      const tt = e.touches[0];
      const c = cellAt(tt.clientX, tt.clientY);
      if (!c || c.ical) return; // 셀 밖 / iCal 셀에선 시작 안 함
      startX = tt.clientX;
      startY = tt.clientY;
      anchorVillaId = c.villaId;
      dragging = false;
      clearTimer();
      timer = window.setTimeout(() => {
        timer = null;
        dragging = true;
        navigator.vibrate?.(30); // 진입 햅틱
        lastPointerRef.current = { x: startX, y: startY };
        setDrag({ villaId: c.villaId, anchorIdx: c.idx, overIdx: c.idx, touch: true });
      }, LONG_PRESS_MS);
    }

    function onTouchMove(e: TouchEvent) {
      const tt = e.touches[0];
      if (!tt) return;
      if (!dragging) {
        // 진입 전 움직임 → 스크롤 의도. 타이머 취소하고 브라우저 기본 스크롤 허용.
        if (timer != null) {
          const dx = Math.abs(tt.clientX - startX);
          const dy = Math.abs(tt.clientY - startY);
          if (dx > MOVE_CANCEL_PX || dy > MOVE_CANCEL_PX) {
            clearTimer();
            anchorVillaId = null;
          }
        }
        return;
      }
      // 선택 모드 — 스크롤 잠그고 손가락 밑 셀로 범위 확장(같은 빌라 행 안에서만)
      e.preventDefault();
      lastPointerRef.current = { x: tt.clientX, y: tt.clientY };
      const c = cellAt(tt.clientX, tt.clientY);
      if (c && c.villaId === anchorVillaId) {
        const d = dragRef.current;
        if (d && d.overIdx !== c.idx) setDrag({ ...d, overIdx: c.idx });
      }
    }

    function onTouchEnd() {
      clearTimer();
      if (dragging) {
        dragging = false;
        const d = dragRef.current;
        if (d) finalizeRef.current(d);
      }
      anchorVillaId = null;
    }

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("touchcancel", onTouchEnd);
    return () => {
      clearTimer();
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, []);

  // 화면 밖 클릭 → 팝오버 닫기
  const popRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!pop) return;
    function onDoc(e: MouseEvent) {
      if (pending) return; // 처리 중에는 외부 클릭으로 닫지 않음
      const target = e.target as HTMLElement;
      if (popRef.current?.contains(target)) return;
      if (target.closest("[data-ab-cell]")) return;
      setPop(null);
      setErrorKey(null);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [pop, pending]);

  // 범위 팝오버 외부 클릭 닫기
  const rangePopRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!rangePop) return;
    function onDoc(e: MouseEvent) {
      if (rangePending) return;
      const target = e.target as HTMLElement;
      if (rangePopRef.current?.contains(target)) return;
      if (target.closest("[data-ab-cell]")) return;
      setRangePop(null);
      setRangeError(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [rangePop, rangePending]);

  function closePop() {
    if (pending) return;
    setPop(null);
    setErrorKey(null);
  }

  // 필터/기간 → searchParams 갱신. 현재 URL 파라미터를 통째로 복제한 뒤 바뀌는 값만 덮어쓴다.
  // (알려진 필터만 열거해 재조립하면 신규 필터 파라미터가 조용히 유실됨 — /villas·/bookings 클론 패턴.
  //  빈 문자열·null 패치는 해당 파라미터 제거 = 기본값이면 URL 에서 빠지는 기존 동작 유지)
  function navigate(patch: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v == null || v === "") next.delete(k);
      else next.set(k, v);
    }
    const qs = next.toString();
    router.replace(qs ? `/availability?${qs}` : "/availability");
  }

  function cellOf(villaId: string, idx: number): BoardCell {
    const iso = columns[idx].iso;
    // 행이 필터로 사라진 사이 드래그가 호출될 수 있으므로 non-null 단정 대신 안전 폴백.
    return (
      optimistic[`${villaId}|${iso}`] ??
      rows.find((r) => r.id === villaId)?.days[idx] ??
      { status: "AVAILABLE", blockId: null }
    );
  }

  // ── 드래그 시작 (마우스/펜 + 주버튼, ICAL 셀 제외) ──
  function onCellPointerDown(
    e: React.PointerEvent,
    row: BoardRow,
    idx: number,
    cell: BoardCell
  ) {
    if (e.pointerType !== "mouse" && e.pointerType !== "pen") return; // 터치는 기존 탭 유지
    if (e.button !== 0) return; // 주버튼만
    if (cell.status === "ICAL" || cell.status === "BOOKING") return; // iCal·예약 셀은 읽기전용 — 드래그 시작 안 함
    lastPointerRef.current = { x: e.clientX, y: e.clientY };
    movedRef.current = false;
    setDrag({ villaId: row.id, anchorIdx: idx, overIdx: idx });
  }

  // 같은 행 위로 드래그 — overIdx 갱신
  function onCellPointerEnter(e: React.PointerEvent, villaId: string, idx: number) {
    const d = dragRef.current;
    if (!d || d.villaId !== villaId) return;
    lastPointerRef.current = { x: e.clientX, y: e.clientY };
    if (d.overIdx !== idx) setDrag({ ...d, overIdx: idx });
  }

  function onCellTap(e: React.MouseEvent, row: BoardRow, col: BoardColumn, cell: BoardCell, idx: number) {
    // 드래그로 범위 선택된 직후의 click 은 무시 (단일 팝오버 중복 오픈 방지)
    if (movedRef.current) {
      movedRef.current = false;
      return;
    }
    // 예약 셀(BOOKING, DIRECT 빌라) → 범위 모드와 무관하게 예약 팝오버 (읽기전용).
    // BOOKING 셀은 잠금/범위 대상이 아니므로 어떤 경우에도 여기서 종료한다.
    if (cell.status === "BOOKING") {
      setTapAnchor(null);
      setErrorKey(null);
      if (cell.booking) {
        setPop({
          kind: "booking",
          villaName: row.name,
          booking: cell.booking,
          x: Math.min(e.clientX, window.innerWidth - 296),
          y: Math.min(e.clientY + 8, window.innerHeight - 320),
        });
      }
      return;
    }
    // ── 두 번 탭 범위 모드: 첫 탭=시작, 둘째 탭=끝 → 범위 팝오버 ──
    if (rangeMode && cell.status !== "ICAL") {
      if (!tapAnchor || tapAnchor.villaId !== row.id) {
        // 시작 지정(또는 다른 빌라로 시작점 이동)
        setTapAnchor({ villaId: row.id, idx });
        return;
      }
      const lo = Math.min(tapAnchor.idx, idx);
      const hi = Math.max(tapAnchor.idx, idx);
      setTapAnchor(null);
      if (lo === hi) {
        // 같은 날짜 재탭 → 단일 잠금/해제 팝오버로 폴백
        setErrorKey(null);
        setPop({
          kind: "block",
          villaId: row.id,
          villaName: row.name,
          col,
          status: cell.status,
          blockId: cell.blockId,
          x: Math.min(e.clientX, window.innerWidth - 280),
          y: Math.min(e.clientY + 8, window.innerHeight - 220),
        });
        return;
      }
      openRangePop(row.id, row.name, lo, hi, e.clientX, e.clientY);
      return;
    }
    setErrorKey(null);
    const x = Math.min(e.clientX, window.innerWidth - 280);
    const y = Math.min(e.clientY + 8, window.innerHeight - 220);
    if (cell.status === "ICAL") {
      setPop({ kind: "ical", col, x, y });
      return;
    }
    setPop({
      kind: "block",
      villaId: row.id,
      villaName: row.name,
      col,
      status: cell.status,
      blockId: cell.blockId,
      x,
      y,
    });
  }

  // 잠금/해제 실행 — 낙관적 업데이트 후 API, 실패 시 롤백
  async function submit(action: "lock" | "unlock") {
    if (!pop || pop.kind !== "block" || pending) return;
    const key = `${pop.villaId}|${pop.col.iso}`;
    const prev = optimistic[key];
    setPending(true);
    setErrorKey(null);
    // 낙관적 반영
    setOptimistic((o) => ({
      ...o,
      [key]: action === "lock" ? { status: "MANUAL", blockId: null } : { status: "AVAILABLE", blockId: null },
    }));
    try {
      const res =
        action === "lock"
          ? await fetch("/api/calendar-blocks", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ villaId: pop.villaId, date: pop.col.iso }),
            })
          : await fetch(`/api/calendar-blocks/${pop.blockId}`, { method: "DELETE" });
      if (res.ok) {
        if (action === "lock") {
          // 생성된 블록 id 를 오버레이에 반영 → 잠근 직후 같은 셀을 다시 열어도 해제 가능.
          // (기존 버그: blockId=null 오버레이가 refresh 된 서버값을 가려 해제 버튼이 계속 비활성)
          try {
            const data: { id?: string } = await res.json();
            if (data?.id) {
              setOptimistic((o) => ({ ...o, [key]: { status: "MANUAL", blockId: data.id! } }));
            }
          } catch {
            /* 응답 파싱 실패 — 다음 새로고침에서 서버 값으로 정확 반영 */
          }
        }
        setPop(null);
        router.refresh(); // 서버 재조회 → 정확한 blockId 동기화 후 오버레이 폐기
      } else {
        // 롤백
        setOptimistic((o) => {
          const n = { ...o };
          if (prev === undefined) delete n[key];
          else n[key] = prev;
          return n;
        });
        setErrorKey(res.status === 409 ? "conflict" : "error");
      }
    } catch {
      setOptimistic((o) => {
        const n = { ...o };
        if (prev === undefined) delete n[key];
        else n[key] = prev;
        return n;
      });
      setErrorKey("error");
    } finally {
      setPending(false);
    }
  }

  // 범위 구간 상태 집계 — lockable(AVAILABLE 수), unlockable(MANUAL 수). ICAL 제외.
  function rangeCounts(rp: RangePop): { lockable: number; unlockable: number } {
    let lockable = 0;
    let unlockable = 0;
    for (let idx = rp.lo; idx <= rp.hi; idx++) {
      const st = cellOf(rp.villaId, idx).status;
      if (st === "AVAILABLE") lockable += 1;
      else if (st === "MANUAL") unlockable += 1;
    }
    return { lockable, unlockable };
  }

  // 범위 일괄 잠금/해제 — 낙관적 오버레이 + bulk API, 실패 시 롤백
  async function submitRange(action: "lock" | "unlock") {
    if (!rangePop || rangePending) return;
    const rp = rangePop;
    setRangePending(true);
    setRangeError(false);

    // 낙관적: lock → AVAILABLE 셀을 MANUAL 로, unlock → MANUAL 셀을 AVAILABLE 로
    const prevByKey: Record<string, BoardCell | undefined> = {};
    setOptimistic((o) => {
      const next = { ...o };
      for (let idx = rp.lo; idx <= rp.hi; idx++) {
        const iso = columns[idx].iso;
        const key = `${rp.villaId}|${iso}`;
        const st = cellOf(rp.villaId, idx).status;
        if (action === "lock" && st === "AVAILABLE") {
          prevByKey[key] = o[key];
          next[key] = { status: "MANUAL", blockId: null };
        } else if (action === "unlock" && st === "MANUAL") {
          prevByKey[key] = o[key];
          next[key] = { status: "AVAILABLE", blockId: null };
        }
      }
      return next;
    });

    try {
      const res = await fetch("/api/calendar-blocks/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          villaId: rp.villaId,
          startDate: columns[rp.lo].iso,
          endDate: columns[rp.hi].iso, // inclusive
          action,
        }),
      });
      if (res.ok) {
        setRangePop(null);
        // 이번에 설정한 오버레이(blockId=null)를 제거 → refresh 된 서버값(정확한 blockId)이 적용되어
        // 일괄 잠금한 셀도 곧바로 해제 가능. (bulk API 는 생성된 블록 id 를 돌려주지 않음)
        setOptimistic((o) => {
          const n = { ...o };
          for (const key of Object.keys(prevByKey)) delete n[key];
          return n;
        });
        router.refresh(); // 서버 재조회 → 정확 blockId·skip 결과 반영
      } else {
        // 롤백
        setOptimistic((o) => {
          const n = { ...o };
          for (const key of Object.keys(prevByKey)) {
            const prev = prevByKey[key];
            if (prev === undefined) delete n[key];
            else n[key] = prev;
          }
          return n;
        });
        setRangeError(true);
      }
    } catch {
      setOptimistic((o) => {
        const n = { ...o };
        for (const key of Object.keys(prevByKey)) {
          const prev = prevByKey[key];
          if (prev === undefined) delete n[key];
          else n[key] = prev;
        }
        return n;
      });
      setRangeError(true);
    } finally {
      setRangePending(false);
    }
  }

  // "확인했음" — POST 후 응답으로 뱃지 즉시 갱신
  const [checkingId, setCheckingId] = useState<string | null>(null);
  async function confirmChecked(villaId: string) {
    if (checkingId) return;
    setCheckingId(villaId);
    try {
      const res = await fetch(`/api/villas/${villaId}/availability-checked`, { method: "POST" });
      if (res.ok) {
        const data: { availabilityCheckedAt?: string } = await res.json();
        if (data.availabilityCheckedAt) {
          const [, m, d] = data.availabilityCheckedAt.slice(0, 10).split("-");
          setCheckedOverlay((c) => ({ ...c, [villaId]: `${Number(m)}/${Number(d)}` }));
        }
        router.refresh();
      }
    } catch {
      /* 무시 — 다음 새로고침 시 정확 반영 */
    } finally {
      setCheckingId(null);
    }
  }

  const popDateBlock = pop?.kind === "block" ? fmtDateDow(pop.col.iso, s.weekdays) : "";
  const popDateIcal = pop?.kind === "ical" ? fmtDateDow(pop.col.iso, s.weekdays) : "";

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: BOARD_CSS }} />

      {/* ===== 필터 / 기간 바 ===== */}
      {/* 코치마크 앵커 */}
      <div data-tour="avail-filters" className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-800/50 bg-admin-card p-3 shadow-sm">
        {/* 검색 */}
        <div className="relative">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">
            search
          </span>
          <input
            className="w-56 rounded-lg border border-slate-700 bg-slate-900 py-2 pl-9 pr-4 text-sm text-slate-300 focus:border-admin-primary focus:ring-1 focus:ring-admin-primary"
            placeholder={s.search}
            type="text"
            defaultValue={search}
            onKeyDown={(e) => {
              if (e.key === "Enter") navigate({ search: e.currentTarget.value.trim() });
            }}
          />
        </div>
        {/* 지역 */}
        <div className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 whitespace-nowrap">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
            {s.area}
          </span>
          <select
            aria-label={s.area}
            className="cursor-pointer border-none bg-transparent p-0 pr-6 text-sm text-slate-300 focus:ring-0"
            value={area}
            onChange={(e) => navigate({ area: e.target.value, villaId: null })}
          >
            <option value="" className="bg-slate-900">
              {s.allAreas}
            </option>
            {areaOptions.map((opt) => (
              <option key={opt} value={opt} className="bg-slate-900">
                {opt}
              </option>
            ))}
          </select>
        </div>
        {/* 빌라 — 선택 지역의 빌라 목록(지역 미선택 시 전체). 선택 시 그 빌라만 표시 */}
        <div className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 whitespace-nowrap">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
            {s.villa}
          </span>
          <select
            aria-label={s.villa}
            className="max-w-[12rem] cursor-pointer truncate border-none bg-transparent p-0 pr-6 text-sm text-slate-300 focus:ring-0"
            value={villaId}
            onChange={(e) => navigate({ villaId: e.target.value })}
          >
            <option value="" className="bg-slate-900">
              {s.allVillas}
            </option>
            {villaOptions.map((v) => (
              <option key={v.id} value={v.id} className="bg-slate-900">
                {v.name}
              </option>
            ))}
          </select>
        </div>
        {/* 확인 필요만 */}
        <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 whitespace-nowrap">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-slate-600 bg-slate-800 text-admin-primary focus:ring-admin-primary"
            checked={needCheckOnly}
            onChange={(e) => navigate({ needCheck: e.target.checked ? "1" : null })}
          />
          <span className="text-sm font-medium text-slate-300">{s.needCheckOnly}</span>
        </label>

        <div className="flex-1" />

        {/* 기간 네비 */}
        <button
          type="button"
          className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-bold text-slate-300 transition hover:bg-slate-800 whitespace-nowrap"
          onClick={() => navigate({ startMonth: thisMonth })}
        >
          {s.today}
        </button>
        <div className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-1 py-1 whitespace-nowrap">
          <button
            type="button"
            aria-label={s.prevPeriod}
            disabled={!prevMonth}
            className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-400"
            onClick={() => prevMonth && navigate({ startMonth: prevMonth })}
          >
            <span className="material-symbols-outlined text-sm">chevron_left</span>
          </button>
          <span className="px-2 text-sm font-bold tabular-nums text-white">{periodLabel}</span>
          <button
            type="button"
            aria-label={s.nextPeriod}
            className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-800 hover:text-white"
            onClick={() => navigate({ startMonth: nextMonth })}
          >
            <span className="material-symbols-outlined text-sm">chevron_right</span>
          </button>
        </div>
      </div>

      {/* ===== 범례 ===== */}
      {/* 코치마크 앵커 */}
      <div data-tour="avail-legend" className="flex flex-wrap items-center gap-x-6 gap-y-2 px-1">
        <div className="flex items-center gap-2 whitespace-nowrap">
          <span className="ab-cell-available inline-block h-5 w-5 rounded border border-slate-600" />
          <span className="text-sm font-medium text-slate-300">{s.legendAvailable}</span>
        </div>
        <div className="flex items-center gap-2 whitespace-nowrap">
          <span className="ab-cell-manual inline-block h-5 w-5 rounded border border-slate-600" />
          <span className="text-sm font-medium text-slate-300">{s.legendManual}</span>
        </div>
        <div className="flex items-center gap-2 whitespace-nowrap">
          <span className="ab-cell-ical relative inline-block h-5 w-5 rounded border border-amber-500/40">
            <span
              className="material-symbols-outlined absolute inset-0 flex items-center justify-center text-amber-400"
              style={{ fontSize: 12 }}
            >
              sync
            </span>
          </span>
          <span className="text-sm font-medium text-slate-300">{s.legendIcal}</span>
        </div>
        <div className="flex items-center gap-2 whitespace-nowrap">
          <span className="ab-cell-booking-confirmed inline-block h-5 w-5 rounded border border-teal-500/40" />
          <span className="text-sm font-medium text-slate-300">{s.legendBooking}</span>
        </div>
        <div className="ml-auto flex items-center gap-2 whitespace-nowrap">
          <span className="material-symbols-outlined text-[18px] text-green-500">check_circle</span>
          <span className="text-sm font-medium text-slate-300">{s.legendChecked}</span>
          <span className="material-symbols-outlined ml-3 text-[18px] text-amber-400">warning</span>
          <span className="text-sm font-medium text-slate-300">{s.legendNeedCheck}</span>
        </div>
      </div>

      {/* ===== 범위 선택 도구막대 (두 번 탭 토글 + 안내) ===== */}
      <div className="flex flex-wrap items-center gap-2 px-1">
        <button
          type="button"
          onClick={() => {
            setRangeMode((v) => !v);
            setTapAnchor(null);
          }}
          aria-pressed={rangeMode ? "true" : "false"}
          className={
            "inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 py-1.5 text-xs font-bold transition " +
            (rangeMode
              ? "border-admin-primary bg-admin-primary/15 text-admin-primary"
              : "border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800")
          }
        >
          <span className="material-symbols-outlined text-[16px]">date_range</span>
          {s.rangeModeLabel}
        </button>
        <span className="text-[11px] leading-relaxed text-slate-500">
          {rangeMode ? (tapAnchor ? s.rangeModeAnchorHint : s.rangeModeHint) : s.selectHint}
        </span>
      </div>

      {/* ===== 타임라인 격자 ===== */}
      {/* 코치마크 앵커 */}
      <div ref={scrollRef} data-tour="avail-grid" className={"ab-scroll relative overflow-auto rounded-xl border border-slate-800/50 bg-admin-card shadow-lg" + (drag ? " ab-dragging" : "")}>
        {rows.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-sm text-slate-500">
            {s.empty}
          </div>
        ) : (
          <table className="border-collapse" style={{ tableLayout: "fixed" }}>
            <thead>
              {/* 월 라벨 행 */}
              <tr>
                <th
                  className={
                    "ab-sticky-col py-2 text-left align-bottom " +
                    (villaColCollapsed ? "px-1" : "px-4")
                  }
                  style={{
                    zIndex: 30,
                    top: 0,
                    minWidth: colW,
                    width: colW,
                    background: "#0F172A",
                    borderBottom: "1px solid #1E293B",
                    borderRight: "1px solid #1E293B",
                  }}
                >
                  <div
                    className={
                      "flex items-center gap-1 " +
                      (villaColCollapsed ? "justify-center" : "justify-between")
                    }
                  >
                    {!villaColCollapsed && (
                      <span className="truncate text-[11px] font-bold uppercase tracking-wider text-slate-500">
                        {s.villaCount}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => setVillaColCollapsed((v) => !v)}
                      aria-label={villaColCollapsed ? s.expandList : s.collapseList}
                      title={villaColCollapsed ? s.expandList : s.collapseList}
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-slate-700 text-slate-400 transition hover:bg-slate-800 hover:text-white"
                    >
                      <span className="material-symbols-outlined text-[16px]">
                        {villaColCollapsed ? "chevron_right" : "chevron_left"}
                      </span>
                    </button>
                  </div>
                </th>
                {monthGroups.map((g) => (
                  <th
                    key={g.ym}
                    colSpan={g.span}
                    className="ab-month-edge sticky top-0 whitespace-nowrap px-3 py-2 text-left text-sm font-black text-white"
                    style={{
                      background: "#0F172A",
                      borderBottom: "1px solid #1E293B",
                      zIndex: 25,
                    }}
                  >
                    {g.label}
                  </th>
                ))}
              </tr>
              {/* 일/요일 행 */}
              <tr>
                <th
                  className="ab-sticky-col px-4 py-2 text-left"
                  style={{
                    zIndex: 30,
                    top: ROW_H,
                    minWidth: colW,
                    width: colW,
                    background: "#1E293B",
                    borderBottom: "1px solid #1E293B",
                    borderRight: "1px solid #1E293B",
                  }}
                />
                {columns.map((c) => (
                  <th
                    key={c.iso}
                    className={
                      "sticky px-0 py-1 text-center align-middle nowrap-cell" +
                      (c.isMonthStart ? " ab-month-edge" : "") +
                      (c.isToday ? " ab-col-today" : "") +
                      (c.isWeekend ? " ab-col-weekend" : "")
                    }
                    style={{
                      top: ROW_H,
                      minWidth: 36,
                      width: 36,
                      background: "#1E293B",
                      borderBottom: "1px solid #1E293B",
                      zIndex: 24,
                    }}
                  >
                    <div
                      className={
                        "text-[10px] font-bold leading-none tabular-nums " +
                        (c.isToday
                          ? "text-[#3B82F6]"
                          : c.isWeekend
                            ? "text-rose-400"
                            : "text-slate-400")
                      }
                    >
                      {c.day}
                    </div>
                    <div
                      className={
                        "mt-0.5 text-[9px] leading-none " +
                        (c.isToday ? "text-[#3B82F6]" : "text-slate-600")
                      }
                    >
                      {s.weekdays[c.dow]}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const checkedLabel = checkedOverlay[row.id] ?? row.checkedLabel;
                const needCheck = checkedOverlay[row.id] ? false : row.needCheck;
                return (
                  <tr key={row.id} className="group">
                    {/* sticky 빌라명 + 확인 뱃지 + 확인했음 */}
                    <td
                      className={
                        "ab-sticky-col align-middle " +
                        (villaColCollapsed ? "px-1 py-1.5" : "px-4 py-1.5")
                      }
                      style={{
                        minWidth: colW,
                        width: colW,
                        borderRight: "1px solid #1E293B",
                        borderBottom: "1px solid rgba(30,41,59,0.6)",
                      }}
                    >
                      {villaColCollapsed ? (
                        <div
                          className="flex items-center justify-center"
                          title={`${row.name}${row.complex ? ` · ${row.complex}` : ""}`}
                        >
                          <span
                            className={
                              "material-symbols-outlined text-[16px] " +
                              (needCheck ? "text-amber-400" : "text-green-500")
                            }
                          >
                            {needCheck ? "warning" : "check_circle"}
                          </span>
                        </div>
                      ) : (
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold text-slate-100 nowrap-cell">
                            {row.name}
                          </p>
                          {row.complex && (
                            <p className="truncate text-[10px] text-slate-500 nowrap-cell">
                              {row.complex}
                            </p>
                          )}
                          <span
                            className={
                              "mt-0.5 inline-block rounded px-1 py-px text-[9px] font-bold tabular-nums " +
                              (row.qualityScore >= 90
                                ? "bg-green-500/15 text-green-400"
                                : row.qualityScore >= 70
                                  ? "bg-amber-500/15 text-amber-400"
                                  : "bg-red-500/15 text-red-400")
                            }
                            title={s.qualityTitle}
                          >
                            ★ {row.qualityScore}
                          </span>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          {needCheck ? (
                            <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-amber-500/30 bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-400">
                              <span className="material-symbols-outlined" style={{ fontSize: 13 }}>
                                warning
                              </span>
                              {checkedLabel
                                ? s.badgeNeedCheck.replace("{date}", checkedLabel)
                                : s.badgeNever}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-green-500/20 bg-green-500/10 px-2 py-0.5 text-[10px] font-bold text-green-400">
                              <span className="material-symbols-outlined" style={{ fontSize: 13 }}>
                                check_circle
                              </span>
                              {s.badgeChecked.replace("{date}", checkedLabel ?? "")}
                            </span>
                          )}
                          <button
                            type="button"
                            title={s.confirmCheck}
                            aria-label={s.confirmCheck}
                            disabled={checkingId === row.id}
                            onClick={() => confirmChecked(row.id)}
                            className="flex h-6 w-6 items-center justify-center rounded-md border border-slate-700 text-slate-400 transition hover:bg-slate-800 hover:text-white disabled:opacity-50"
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: 15 }}>
                              {checkingId === row.id ? "hourglass_empty" : "task_alt"}
                            </span>
                          </button>
                        </div>
                      </div>
                      )}
                    </td>
                    {/* 날짜 셀 */}
                    {columns.map((c, idx) => {
                      const cell = cellOf(row.id, idx);
                      let cls = "ab-grid-cell relative";
                      if (c.isMonthStart) cls += " ab-month-edge";
                      if (c.isToday) cls += " ab-col-today";
                      if (cell.status === "AVAILABLE") {
                        cls += " ab-cell-available" + (c.isWeekend ? " ab-col-weekend" : "");
                      } else if (cell.status === "MANUAL") {
                        cls += " ab-cell-manual";
                      } else if (cell.status === "ICAL") {
                        cls += " ab-cell-ical";
                      } else {
                        // BOOKING (DIRECT 빌라) — HOLD 는 점선 패턴, 확정/체크인은 단색
                        cls +=
                          cell.booking?.status === "HOLD"
                            ? " ab-cell-booking-hold"
                            : " ab-cell-booking-confirmed";
                      }
                      // 드래그 중인 빌라의 선택 구간 하이라이트
                      const inDragRange =
                        drag !== null &&
                        drag.villaId === row.id &&
                        idx >= Math.min(drag.anchorIdx, drag.overIdx) &&
                        idx <= Math.max(drag.anchorIdx, drag.overIdx);
                      if (inDragRange) cls += " ab-range-sel";
                      // 두 번 탭 모드: 시작 셀 강조
                      if (tapAnchor && tapAnchor.villaId === row.id && tapAnchor.idx === idx)
                        cls += " ab-range-sel";
                      const title =
                        cell.status === "AVAILABLE"
                          ? s.cellAvailable
                          : cell.status === "MANUAL"
                            ? s.cellManual
                            : cell.status === "ICAL"
                              ? s.cellIcal
                              : s.cellBooking;
                      return (
                        <td
                          key={c.iso}
                          data-ab-cell
                          data-villa={row.id}
                          data-idx={idx}
                          className={cls}
                          title={title}
                          onPointerDown={(e) => onCellPointerDown(e, row, idx, cell)}
                          onPointerEnter={(e) => onCellPointerEnter(e, row.id, idx)}
                          onClick={(e) => onCellTap(e, row, c, cell, idx)}
                        >
                          {cell.status === "ICAL" && (
                            <span
                              className="material-symbols-outlined pointer-events-none absolute inset-0 flex items-center justify-center text-amber-300/90"
                              style={{ fontSize: 13 }}
                            >
                              sync
                            </span>
                          )}
                          {/* 공급자 직접판매 예약 마커 — 우리 예약(OPERATOR)과 구분 */}
                          {cell.status === "BOOKING" && cell.booking?.seller === "SUPPLIER" && (
                            <span
                              className="material-symbols-outlined pointer-events-none absolute inset-0 flex items-center justify-center text-orange-100/90"
                              style={{ fontSize: 12 }}
                            >
                              storefront
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ===== 잠금/해제 팝오버 ===== */}
      {pop?.kind === "block" && (
        <div
          ref={popRef}
          className="fixed z-[60] w-64 rounded-xl border border-slate-700 bg-admin-card p-4 shadow-2xl"
          style={{ left: pop.x, top: pop.y }}
        >
          <div className="mb-1 flex items-center justify-between">
            <p className="truncate text-xs font-medium text-slate-400">{pop.villaName}</p>
            <button
              type="button"
              onClick={closePop}
              className="text-slate-500 hover:text-white"
              aria-label={s.popClose}
            >
              <span className="material-symbols-outlined text-sm">close</span>
            </button>
          </div>
          <p className="mb-1 text-base font-black tabular-nums text-white">{popDateBlock}</p>
          <p className="mb-3 text-xs text-slate-400">
            {s.popStateLabel}:{" "}
            <span className="font-bold text-slate-200">
              {pop.status === "MANUAL" ? s.popStateManual : s.popStateAvailable}
            </span>
          </p>
          {errorKey && (
            <p className="mb-3 rounded-lg bg-red-500/10 p-2.5 text-xs font-medium text-red-400">
              {errorKey === "conflict" ? s.popConflict : s.popError}
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pending || pop.status === "MANUAL"}
              onClick={() => submit("lock")}
              className="flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-slate-600 py-2.5 text-sm font-bold text-white transition hover:bg-slate-500 disabled:opacity-40"
            >
              <span className="material-symbols-outlined text-[16px]">lock</span>
              {pending && pop.status === "AVAILABLE" ? s.popProcessing : s.popLock}
            </button>
            <button
              type="button"
              disabled={pending || pop.status === "AVAILABLE" || !pop.blockId}
              onClick={() => submit("unlock")}
              className="flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-700 bg-slate-800 py-2.5 text-sm font-bold text-slate-300 transition hover:bg-slate-700 disabled:opacity-40"
            >
              <span className="material-symbols-outlined text-[16px]">lock_open</span>
              {pending && pop.status === "MANUAL" ? s.popProcessing : s.popUnlock}
            </button>
          </div>
          <p className="mt-2.5 text-[10px] leading-relaxed text-slate-500">{s.popHint}</p>
        </div>
      )}

      {/* ===== iCal 읽기전용 팝오버 ===== */}
      {pop?.kind === "ical" && (
        <div
          ref={popRef}
          className="fixed z-[60] w-64 rounded-xl border border-amber-500/40 bg-admin-card p-4 shadow-2xl"
          style={{ left: pop.x, top: pop.y }}
        >
          <div className="mb-1 flex items-center justify-between">
            <p className="flex items-center gap-1 whitespace-nowrap text-xs font-bold text-amber-400">
              <span className="material-symbols-outlined text-sm">sync</span>
              {s.icalTitle}
            </p>
            <button
              type="button"
              onClick={closePop}
              className="text-slate-500 hover:text-white"
              aria-label={s.popClose}
            >
              <span className="material-symbols-outlined text-sm">close</span>
            </button>
          </div>
          <p className="mb-2 text-base font-black tabular-nums text-white">{popDateIcal}</p>
          <p className="mb-3 text-xs text-slate-400">{s.icalDesc}</p>
          <div className="flex items-start gap-2 rounded-lg bg-slate-800/60 px-3 py-2 text-[11px] leading-relaxed text-slate-500">
            <span className="material-symbols-outlined shrink-0 text-sm text-slate-500">info</span>
            {s.icalInfo}
          </div>
        </div>
      )}

      {/* ===== DIRECT 빌라 예약 팝오버 (읽기전용) ===== */}
      {pop?.kind === "booking" &&
        (() => {
          const b = pop.booking;
          const statusLabel =
            b.status === "HOLD"
              ? s.bkStatusHold
              : b.status === "CONFIRMED"
                ? s.bkStatusConfirmed
                : s.bkStatusCheckedIn;
          const badgeCls =
            b.status === "HOLD"
              ? "bg-amber-500/10 border border-amber-500/30 text-amber-400"
              : b.status === "CHECKED_IN"
                ? "bg-indigo-500/15 border border-indigo-500/30 text-indigo-300"
                : "bg-teal-500/15 border border-teal-500/30 text-teal-300";
          const channelLabel =
            b.channel === "TRAVEL_AGENCY"
              ? s.bkChannelTravel
              : b.channel === "LAND_AGENCY"
                ? s.bkChannelLand
                : s.bkChannelDirect;
          const depositLabel =
            b.depositStatus === "HELD"
              ? s.bkDepositHeld
              : b.depositStatus === "REFUNDED"
                ? s.bkDepositRefunded
                : b.depositStatus === "PARTIAL_DEDUCTED"
                  ? s.bkDepositPartial
                  : s.bkDepositNone;
          const remaining =
            b.status === "HOLD" && b.holdExpiresAt ? fmtHoldRemaining(b.holdExpiresAt) : undefined;
          // 판매가 — saleCurrency 가 null 이면 재무 게이트 차단(STAFF) → 행 자체 미표시
          const saleText =
            b.saleCurrency === "KRW" && b.totalSaleKrw != null
              ? `₩${fmtThousands(b.totalSaleKrw)}`
              : b.saleCurrency === "VND" && b.totalSaleVnd != null
                ? `${fmtThousands(b.totalSaleVnd)} VND`
                : null;
          return (
            <div
              ref={popRef}
              className="fixed z-[60] w-72 rounded-xl border border-teal-600/50 bg-admin-card p-4 shadow-2xl"
              style={{ left: pop.x, top: pop.y }}
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="truncate text-xs font-medium text-slate-400">{pop.villaName}</p>
                <button
                  type="button"
                  onClick={closePop}
                  className="shrink-0 text-slate-500 hover:text-white"
                  aria-label={s.popClose}
                >
                  <span className="material-symbols-outlined text-sm">close</span>
                </button>
              </div>
              <div className="mb-2 flex items-center gap-2">
                <span className={`rounded-md px-2 py-0.5 text-xs font-bold ${badgeCls}`}>
                  {statusLabel}
                </span>
                <span className="text-sm font-black tabular-nums text-white">
                  {fmtMd(b.checkIn)} ~ {fmtMd(b.checkOut)}
                </span>
                <span className="text-xs font-medium text-slate-400">
                  {s.bkNights.replace("{n}", String(b.nights))}
                </span>
              </div>
              <dl className="space-y-1.5 text-xs">
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">{s.bkGuest}</dt>
                  <dd className="truncate font-medium text-slate-200">
                    {b.guestName}{" "}
                    <span className="text-slate-400">
                      {s.bkGuestCount.replace("{n}", String(b.guestCount))}
                    </span>
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">{s.bkChannel}</dt>
                  <dd className="truncate font-medium text-slate-200">
                    {channelLabel}
                    {b.agencyName ? ` · ${b.agencyName}` : ""}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">{s.bkSeller}</dt>
                  <dd className="font-medium">
                    <span
                      className={
                        b.seller === "SUPPLIER"
                          ? "text-orange-300"
                          : "text-slate-200"
                      }
                    >
                      {b.seller === "SUPPLIER" ? s.bkSellerSupplier : s.bkSellerOperator}
                    </span>
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">{s.bkCost}</dt>
                  <dd className="font-medium tabular-nums text-slate-200">
                    {fmtThousands(b.supplierCostVnd)} VND
                  </dd>
                </div>
                {saleText && (
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-500">{s.bkSale}</dt>
                    <dd className="font-bold tabular-nums text-teal-300">{saleText}</dd>
                  </div>
                )}
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">{s.bkDeposit}</dt>
                  <dd className="font-medium text-slate-200">{depositLabel}</dd>
                </div>
                {b.status === "HOLD" && (
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-500">⏳</dt>
                    <dd className="font-bold text-amber-400">
                      {remaining
                        ? s.bkHoldExpires.replace("{time}", remaining)
                        : s.bkHoldExpired}
                    </dd>
                  </div>
                )}
              </dl>
              <Link
                href={`/bookings/${b.id}`}
                className="mt-3 flex items-center justify-center gap-1.5 rounded-lg bg-teal-600 py-2.5 text-sm font-bold text-white transition hover:bg-teal-500"
              >
                {s.bkOpenDetail}
                <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
              </Link>
            </div>
          );
        })()}

      {/* ===== 범위 잠금/해제 팝오버 (드래그 선택) ===== */}
      {rangePop &&
        (() => {
          const { lockable, unlockable } = rangeCounts(rangePop);
          const dayCount = rangePop.hi - rangePop.lo + 1;
          const startLabel = fmtDateDow(columns[rangePop.lo].iso, s.weekdays);
          const endLabel = fmtDateDow(columns[rangePop.hi].iso, s.weekdays);
          return (
            <div
              ref={rangePopRef}
              className="fixed z-[60] w-72 rounded-xl border border-slate-700 bg-admin-card p-4 shadow-2xl"
              style={{ left: rangePop.x, top: rangePop.y }}
            >
              <div className="mb-1 flex items-center justify-between">
                <p className="truncate text-xs font-medium text-slate-400">{rangePop.villaName}</p>
                <button
                  type="button"
                  onClick={() => {
                    if (rangePending) return;
                    setRangePop(null);
                    setRangeError(false);
                  }}
                  className="text-slate-500 hover:text-white"
                  aria-label={s.popClose}
                >
                  <span className="material-symbols-outlined text-sm">close</span>
                </button>
              </div>
              <p className="mb-0.5 text-sm font-black tabular-nums text-white">
                {s.rangeDateRange.replace("{start}", startLabel).replace("{end}", endLabel)}
              </p>
              <p className="mb-2 text-xs font-bold text-admin-primary">
                {s.rangeDays.replace("{n}", String(dayCount))}
              </p>
              <p className="mb-3 text-xs text-slate-400">
                {s.rangeSummary
                  .replace("{lockable}", String(lockable))
                  .replace("{unlockable}", String(unlockable))}
              </p>
              {rangeError && (
                <p className="mb-3 rounded-lg bg-red-500/10 p-2.5 text-xs font-medium text-red-400">
                  {s.rangeError}
                </p>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={rangePending || lockable === 0}
                  onClick={() => submitRange("lock")}
                  className="flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-slate-600 py-2.5 text-sm font-bold text-white transition hover:bg-slate-500 disabled:opacity-40"
                >
                  <span className="material-symbols-outlined text-[16px]">lock</span>
                  {rangePending
                    ? s.rangeProcessing
                    : s.rangeLock.replace("{n}", String(lockable))}
                </button>
                <button
                  type="button"
                  disabled={rangePending || unlockable === 0}
                  onClick={() => submitRange("unlock")}
                  className="flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-700 bg-slate-800 py-2.5 text-sm font-bold text-slate-300 transition hover:bg-slate-700 disabled:opacity-40"
                >
                  <span className="material-symbols-outlined text-[16px]">lock_open</span>
                  {rangePending
                    ? s.rangeProcessing
                    : s.rangeUnlock.replace("{n}", String(unlockable))}
                </button>
              </div>
              <p className="mt-2.5 text-[10px] leading-relaxed text-slate-500">{s.rangeHint}</p>
            </div>
          );
        })()}
    </>
  );
}
