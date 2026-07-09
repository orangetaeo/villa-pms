"use client";

// SUPPLIER 월 달력 클라이언트 뷰 (T1.4) — design/stitch/a3-calendar 변환
// 셀 4상태는 색+패턴 병행 (색약 대응): 공실=초록 외곽선 / 확정=파랑 실선 /
// 홀드=연파랑+파선 / 차단=회색+대각 빗금(인라인 repeating gradient — globals.css 비수정)
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { formatVnd } from "@/app/(supplier)/my-villas/new/wizard-types";
import { formatVillaName } from "@/lib/villa-name";
import { checkOutFromNights } from "@/lib/date-vn";

export interface DayCell {
  date: string; // YYYY-MM-DD (UTC 자정 기준)
  day: number;
  status: "AVAILABLE" | "BOOKED" | "HOLD" | "BLOCKED";
  blockId?: string;
  blockSource?: "MANUAL" | "ICAL";
  bookingId?: string; // BOOKED·HOLD 셀 — 바텀시트 조회 키
  isPast: boolean;
}

/** 예약 상세(바텀시트) — 누수 안전 필드만. 고객명·판매가·KRW·마진 없음. */
export interface BookingDetail {
  id: string;
  status: "BOOKED" | "HOLD";
  checkIn: string; // YYYY-MM-DD
  checkOut: string; // YYYY-MM-DD
  nights: number;
  guestCount: number;
  supplierPayoutVnd: string; // 공급자 정산 예정액 (VND 동 단위 문자열)
  holdExpiresAt: string | null; // ISO — HOLD만
  // 직접예약(seller=SUPPLIER) 검수 진입 — CONFIRMED=checkin / CHECKED_IN=checkout. 운영자 예약은 null(버튼 미노출)
  inspectAction: "checkin" | "checkout" | null;
}

interface CalendarViewProps {
  villas: { id: string; name: string; nameVi?: string | null }[];
  selectedVillaId: string;
  month: string; // YYYY-MM
  days: DayCell[];
  leadingBlanks: number;
  bookingDetails: Record<string, BookingDetail>;
}

type SheetState =
  // 빈 날짜 탭 → 2-옵션(차단 vs 직접예약 기록) + 직접예약 폼 (F10 a-direct-booking)
  | { mode: "lock"; date: string }
  | { mode: "unlock"; date: string; blockId: string }
  | { mode: "ical"; date: string }
  | { mode: "booking"; bookingId: string };

/** 가로 드래그 진행 상태 — 마우스/펜=즉시, 터치=길게눌러(0.4초) 후 드래그 (ADMIN 공실보드 동일 UX) */
interface DragState {
  anchorIdx: number; // 드래그 시작 days[] 인덱스
  overIdx: number; // 현재 손가락/포인터가 있는 days[] 인덱스
  touch?: boolean; // true=터치 길게눌러 → touchend가 종료 담당
}

/** 드래그로 확정된 범위 일괄 잠금/해제 팝오버 */
interface RangePop {
  lo: number; // 시작 days[] 인덱스(포함)
  hi: number; // 끝 days[] 인덱스(포함)
  x: number;
  y: number;
}

/** YYYY-MM-DD → VN 요일 라벨 키 (T2=월 … CN=일). 디자인 a-direct-booking "(T2)" 힌트 */
function vnWeekdayKey(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  // UTC 자정 기준 요일 (0=일 … 6=토). VN 표기: T2~T7(월~토), CN(일)
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][dow];
}

/** VND 천단위 dot 포맷 (vi 규칙). 숫자 외 입력 제거 후 4500000 → "4.500.000" */
function formatVndInput(raw: string): string {
  const digits = raw.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  if (!digits) return "";
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** 대각 빗금 패턴 (a3 차단 셀) — globals.css 수정 금지라 Tailwind arbitrary value 사용 */
const HATCH_CLASS =
  "bg-[#e5e7eb] bg-[linear-gradient(45deg,#d1d5db_25%,transparent_25%,transparent_50%,#d1d5db_50%,#d1d5db_75%,transparent_75%,transparent)] [background-size:8px_8px] text-[#6b7280]";

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** YYYY-MM-DD → DD/MM/YYYY (베트남 표기) */
function formatDateVn(date: string): string {
  const [y, m, d] = date.split("-");
  return `${d}/${m}/${y}`;
}

export function CalendarView({
  villas,
  selectedVillaId,
  month,
  days,
  leadingBlanks,
  bookingDetails,
}: CalendarViewProps) {
  const t = useTranslations("calendar");
  const router = useRouter();
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [pending, setPending] = useState(false);
  const [errorKey, setErrorKey] = useState<"conflict" | "error" | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // 빈 날짜 시트의 선택 액션: 차단(lock) vs 직접예약 기록(direct) — a-direct-booking 2-옵션 칩
  const [emptyAction, setEmptyAction] = useState<"lock" | "direct">("lock");
  // 직접예약 폼 입력 (직접예약 active일 때만 사용)
  const [guestName, setGuestName] = useState("");
  const [guestCount, setGuestCount] = useState(2);
  const [nights, setNights] = useState(1); // 박수 스테퍼 (1~30). 체크아웃 = 체크인 + nights
  const [amountVnd, setAmountVnd] = useState(""); // dot 포맷 문자열
  const [contact, setContact] = useState("");

  // ── 날짜 드래그 범위 선택 (ADMIN 공실보드 동일 패턴) — 여러 날 일괄 잠금/해제 ──
  const [drag, setDrag] = useState<DragState | null>(null);
  const [rangePop, setRangePop] = useState<RangePop | null>(null);
  const [rangePending, setRangePending] = useState(false);
  const [rangeError, setRangeError] = useState<"conflict" | "error" | null>(null);
  // 최신 drag 값을 window pointerup/touchend 네이티브 리스너에서 읽기 위한 ref
  const dragRef = useRef<DragState | null>(null);
  dragRef.current = drag;
  // 드래그로 2칸 이상 이동 여부 — 뒤따르는 onClick(onCellTap) 중복 시트 차단
  const movedRef = useRef(false);
  // 마지막 포인터 좌표 (범위 팝오버 위치 산출)
  const lastPointerRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  // 달력 그리드 컨테이너 (터치 네이티브 리스너 부착)
  const gridRef = useRef<HTMLDivElement | null>(null);
  const rangePopRef = useRef<HTMLDivElement | null>(null);

  // 드래그 가능한 셀인가 — 과거·예약(확정/홀드)은 제외. 공실·MANUAL/iCal 차단만 범위 시작 허용.
  function isDraggable(cell: DayCell): boolean {
    if (cell.isPast) return false;
    return cell.status === "AVAILABLE" || cell.status === "BLOCKED";
  }

  // days[] 인덱스로 셀 찾기 (터치 elementFromPoint용 data-day-idx 매핑)
  function cellAt(x: number, y: number): number | null {
    const el = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest(
      "[data-day-idx]"
    ) as HTMLElement | null;
    if (!el) return null;
    const idx = Number(el.getAttribute("data-day-idx"));
    return Number.isNaN(idx) ? null : idx;
  }

  // 범위 내 잠금가능(공실)·해제가능(MANUAL 단일차단) 개수 — 과거·예약·iCal 제외
  function rangeCounts(rp: RangePop): { lockable: number; unlockable: number } {
    let lockable = 0;
    let unlockable = 0;
    for (let i = rp.lo; i <= rp.hi; i++) {
      const c = days[i];
      if (!c || c.isPast) continue;
      if (c.status === "AVAILABLE") lockable += 1;
      else if (c.status === "BLOCKED" && c.blockSource === "MANUAL") unlockable += 1;
    }
    return { lockable, unlockable };
  }

  function openRangePop(lo: number, hi: number, x: number, y: number) {
    setRangeError(null);
    // 팝오버는 뷰포트 내로 클램프 (모바일 가장자리 잘림 방지)
    const vw = typeof window !== "undefined" ? window.innerWidth : 360;
    const vh = typeof window !== "undefined" ? window.innerHeight : 640;
    setRangePop({
      lo,
      hi,
      x: Math.min(Math.max(x, 12), vw - 252),
      y: Math.min(Math.max(y, 12), vh - 220),
    });
  }

  function finalizeDrag(d: DragState) {
    const lo = Math.min(d.anchorIdx, d.overIdx);
    const hi = Math.max(d.anchorIdx, d.overIdx);
    setDrag(null);
    dragRef.current = null;
    if (lo === hi) {
      // 한 칸 = 드래그 아님 → onClick(onCellTap)이 단일 시트 처리
      movedRef.current = false;
      return;
    }
    movedRef.current = true; // 뒤따르는 onClick 차단
    openRangePop(lo, hi, lastPointerRef.current.x, lastPointerRef.current.y);
  }
  const finalizeRef = useRef(finalizeDrag);
  finalizeRef.current = finalizeDrag;

  // 마우스/펜 — pointerdown 즉시 드래그 시작
  function onCellPointerDown(e: React.PointerEvent, idx: number, cell: DayCell) {
    if (e.pointerType !== "mouse" && e.pointerType !== "pen") return; // 터치는 길게눌러 핸들러가 담당
    if (e.button !== 0) return;
    if (!isDraggable(cell)) return;
    lastPointerRef.current = { x: e.clientX, y: e.clientY };
    movedRef.current = false;
    setDrag({ anchorIdx: idx, overIdx: idx });
  }

  // 마우스/펜 — 드래그 중 범위 확장
  function onCellPointerEnter(e: React.PointerEvent, idx: number) {
    const d = dragRef.current;
    if (!d) return;
    lastPointerRef.current = { x: e.clientX, y: e.clientY };
    if (d.overIdx !== idx) setDrag({ ...d, overIdx: idx });
  }

  // 전역 pointerup — 마우스 드래그 종료 시 범위 확정
  useEffect(() => {
    function onUp() {
      const d = dragRef.current;
      if (!d || d.touch) return; // 터치는 touchend가 확정
      finalizeRef.current(d);
    }
    window.addEventListener("pointerup", onUp);
    return () => window.removeEventListener("pointerup", onUp);
  }, []);

  // 터치 길게눌러(0.4초) 드래그 — 그리드 컨테이너 네이티브 리스너 (스크롤과 공존)
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const LONG_PRESS_MS = 400;
    const MOVE_CANCEL_PX = 8;
    let timer: number | null = null;
    let anchorIdx: number | null = null;
    let startX = 0;
    let startY = 0;
    let dragging = false;
    const clearTimer = () => {
      if (timer != null) {
        window.clearTimeout(timer);
        timer = null;
      }
    };
    function onTouchStart(e: TouchEvent) {
      if (e.touches.length !== 1) return;
      const tt = e.touches[0];
      const idx = cellAt(tt.clientX, tt.clientY);
      if (idx == null || !days[idx] || !isDraggable(days[idx])) return;
      startX = tt.clientX;
      startY = tt.clientY;
      anchorIdx = idx;
      dragging = false;
      timer = window.setTimeout(() => {
        timer = null;
        dragging = true;
        navigator.vibrate?.(30);
        lastPointerRef.current = { x: startX, y: startY };
        setDrag({ anchorIdx: idx, overIdx: idx, touch: true });
      }, LONG_PRESS_MS);
    }
    function onTouchMove(e: TouchEvent) {
      const tt = e.touches[0];
      if (!tt) return;
      if (!dragging) {
        if (timer != null) {
          const dx = Math.abs(tt.clientX - startX);
          const dy = Math.abs(tt.clientY - startY);
          if (dx > MOVE_CANCEL_PX || dy > MOVE_CANCEL_PX) {
            clearTimer();
            anchorIdx = null;
          }
        }
        return;
      }
      e.preventDefault(); // 선택 모드 — 스크롤 잠금
      lastPointerRef.current = { x: tt.clientX, y: tt.clientY };
      const idx = cellAt(tt.clientX, tt.clientY);
      if (idx != null) {
        const d = dragRef.current;
        if (d && d.overIdx !== idx) setDrag({ ...d, overIdx: idx });
      }
    }
    function onTouchEnd() {
      clearTimer();
      if (dragging) {
        dragging = false;
        const d = dragRef.current;
        if (d) finalizeRef.current(d);
      }
      anchorIdx = null;
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
    // days 가 바뀌면(월·빌라 전환) 리스너 재바인딩 — 최신 days 클로저 사용
  }, [days]);

  // 범위 팝오버 바깥 탭/스크롤 시 닫기
  useEffect(() => {
    if (!rangePop) return;
    function onDown(e: PointerEvent) {
      if (rangePending) return;
      if (rangePopRef.current?.contains(e.target as Node)) return;
      setRangePop(null);
      setRangeError(null);
    }
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [rangePop, rangePending]);

  // 범위 일괄 잠금/해제 — ADMIN 과 동일 /api/calendar-blocks/bulk (SUPPLIER 자기 빌라 스코프 허용)
  async function submitRange(action: "lock" | "unlock") {
    if (!rangePop || rangePending) return;
    setRangePending(true);
    setRangeError(null);
    try {
      const res = await fetch("/api/calendar-blocks/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          villaId: selectedVillaId,
          startDate: days[rangePop.lo].date,
          endDate: days[rangePop.hi].date,
          action,
        }),
      });
      if (res.ok) {
        setRangePop(null);
        router.refresh();
      } else {
        setRangeError(res.status === 409 ? "conflict" : "error");
      }
    } catch {
      setRangeError("error");
    } finally {
      setRangePending(false);
    }
  }

  // 홀드 만료 카운트다운 — 예약 바텀시트가 열려 있을 때만 1초 틱
  const booking =
    sheet?.mode === "booking" ? bookingDetails[sheet.bookingId] : undefined;
  useEffect(() => {
    if (booking?.status !== "HOLD" || !booking.holdExpiresAt) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [booking?.status, booking?.holdExpiresAt]);

  const [yearNum, monthNum] = month.split("-").map(Number);
  const weekdays = [
    t("weekdays.mon"),
    t("weekdays.tue"),
    t("weekdays.wed"),
    t("weekdays.thu"),
    t("weekdays.fri"),
    t("weekdays.sat"),
    t("weekdays.sun"),
  ];

  function navigate(villaId: string, m: string) {
    router.replace(`/calendar?villaId=${villaId}&month=${m}`);
  }

  function resetDirectForm() {
    setEmptyAction("lock");
    setGuestName("");
    setGuestCount(2);
    setNights(1);
    setAmountVnd("");
    setContact("");
  }

  function closeSheet() {
    if (pending) return;
    setSheet(null);
    setErrorKey(null);
    resetDirectForm();
  }

  function onCellTap(cell: DayCell) {
    // 직전이 다중 셀 드래그였으면 onClick 무시 (드래그 종료가 범위 팝오버를 이미 띄움)
    if (movedRef.current) {
      movedRef.current = false;
      return;
    }
    setErrorKey(null);
    // 예약(확정·홀드) 셀 — 상세 바텀시트 (과거여도 정보 열람 허용)
    if ((cell.status === "BOOKED" || cell.status === "HOLD") && cell.bookingId) {
      setSheet({ mode: "booking", bookingId: cell.bookingId });
      return;
    }
    // 과거 공실/차단은 읽기 전용
    if (cell.isPast) return;
    if (cell.status === "AVAILABLE") {
      resetDirectForm(); // 빈 날짜 시트는 항상 "차단" 기본 + 직접예약 폼 초기화
      setSheet({ mode: "lock", date: cell.date });
    } else if (cell.blockSource === "MANUAL" && cell.blockId) {
      setSheet({ mode: "unlock", date: cell.date, blockId: cell.blockId });
    } else {
      setSheet({ mode: "ical", date: cell.date }); // iCal 블록은 안내만 (T1.6 동기화 소유)
    }
  }

  async function submit() {
    if (!sheet || sheet.mode === "ical" || sheet.mode === "booking" || pending) return;
    setPending(true);
    setErrorKey(null);
    try {
      const res =
        sheet.mode === "lock"
          ? await fetch("/api/calendar-blocks", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ villaId: selectedVillaId, date: sheet.date }),
            })
          : await fetch(`/api/calendar-blocks/${sheet.blockId}`, { method: "DELETE" });
      if (res.ok) {
        setSheet(null);
        router.refresh();
      } else {
        setErrorKey(res.status === 409 ? "conflict" : "error");
      }
    } catch {
      setErrorKey("error");
    } finally {
      setPending(false);
    }
  }

  // 직접예약 기록 제출 — POST /api/supplier/bookings. 다박: [date, date+nights) half-open.
  async function submitDirectBooking() {
    if (!sheet || sheet.mode !== "lock" || pending) return;
    if (!guestName.trim()) {
      setErrorKey("error");
      return;
    }
    setPending(true);
    setErrorKey(null);
    try {
      const digits = amountVnd.replace(/\D/g, "");
      const res = await fetch("/api/supplier/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          villaId: selectedVillaId,
          checkIn: sheet.date,
          checkOut: checkOutFromNights(sheet.date, nights),
          guestName: guestName.trim(),
          guestCount,
          ...(contact.trim() ? { guestPhone: contact.trim() } : {}),
          ...(digits ? { supplierSalePriceVnd: Number(digits) } : {}),
        }),
      });
      if (res.ok) {
        setSheet(null);
        resetDirectForm();
        router.refresh();
      } else {
        setErrorKey(res.status === 409 ? "conflict" : "error");
      }
    } catch {
      setErrorKey("error");
    } finally {
      setPending(false);
    }
  }

  function cellClass(cell: DayCell): string {
    const base =
      "flex aspect-[1/1.1] flex-col items-center justify-center rounded-lg text-sm font-medium transition-transform active:scale-95";
    if (cell.status === "BOOKED") return `${base} bg-[#2563EB] text-white shadow-sm`;
    if (cell.status === "HOLD")
      return `${base} border-2 border-dashed border-[#2563EB]/40 bg-[#DBEAFE] text-[#2563EB]`;
    if (cell.status === "BLOCKED") return `${base} ${HATCH_CLASS}`;
    // 공실 — 과거는 읽기 전용 음영 처리
    if (cell.isPast) return `${base} border border-gray-100 bg-white text-gray-300`;
    return `${base} border-2 border-[#16A34A] bg-white text-[#16A34A]`;
  }

  return (
    <div className="px-4 pt-2 pb-8">
      {/* 빌라 선택 — 셀렉터 박스 (자기 빌라만). 빌라가 많아도 한눈에·터치 1회로 선택 */}
      <section className="py-4" data-tour="calendar-villa">
        <label className="relative block">
          <span className="sr-only">{t("villaSelectLabel")}</span>
          <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-teal-600">
            <span className="material-symbols-outlined">villa</span>
          </span>
          <select
            value={selectedVillaId}
            onChange={(e) => navigate(e.target.value, month)}
            aria-label={t("villaSelectLabel")}
            className="h-14 w-full appearance-none rounded-2xl border border-gray-200 bg-white pl-12 pr-12 text-base font-bold text-gray-800 shadow-sm focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/30"
          >
            {villas.map((villa) => (
              <option key={villa.id} value={villa.id}>
                {formatVillaName({ name: villa.name, nameVi: villa.nameVi })}
              </option>
            ))}
          </select>
          <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-gray-400">
            <span className="material-symbols-outlined">expand_more</span>
          </span>
        </label>
      </section>

      {/* 월 이동 */}
      <section className="mb-4 mt-2 flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-800">
          {t("monthTitle", { month: monthNum, year: yearNum })}
        </h2>
        <div className="flex gap-1">
          <button
            type="button"
            aria-label={t("prevMonth")}
            onClick={() => navigate(selectedVillaId, shiftMonth(month, -1))}
            className="rounded-lg border border-gray-100 bg-white p-2 text-gray-600 shadow-sm transition-all active:scale-90"
          >
            <span className="material-symbols-outlined">chevron_left</span>
          </button>
          <button
            type="button"
            aria-label={t("nextMonth")}
            onClick={() => navigate(selectedVillaId, shiftMonth(month, 1))}
            className="rounded-lg border border-gray-100 bg-white p-2 text-gray-600 shadow-sm transition-all active:scale-90"
          >
            <span className="material-symbols-outlined">chevron_right</span>
          </button>
        </div>
      </section>

      {/* 달력 */}
      <section
        data-tour="calendar-grid"
        className="rounded-2xl border border-gray-100 bg-white p-3 shadow-sm"
      >
        <div className="mb-4 grid grid-cols-7">
          {weekdays.map((label) => (
            <div
              key={label}
              className="text-center text-xs font-bold uppercase tracking-wider text-gray-400"
            >
              {label}
            </div>
          ))}
        </div>
        <div ref={gridRef} className="grid select-none grid-cols-7 gap-1">
          {Array.from({ length: leadingBlanks }).map((_, i) => (
            <div key={`blank-${i}`} aria-hidden className="aspect-[1/1.1]" />
          ))}
          {days.map((cell, idx) => {
            // 드래그 선택 구간 하이라이트 (현재 빌라·날짜 범위)
            const inDragRange =
              drag !== null &&
              idx >= Math.min(drag.anchorIdx, drag.overIdx) &&
              idx <= Math.max(drag.anchorIdx, drag.overIdx);
            return (
              <button
                key={cell.date}
                type="button"
                data-day-idx={idx}
                onClick={() => onCellTap(cell)}
                onPointerDown={(e) => onCellPointerDown(e, idx, cell)}
                onPointerEnter={(e) => onCellPointerEnter(e, idx)}
                className={`${cellClass(cell)}${inDragRange ? " ring-2 ring-inset ring-teal-500 !bg-teal-100 !text-teal-700" : ""}`}
                aria-label={`${formatDateVn(cell.date)} — ${t(`legend.${cell.status.toLowerCase()}`)}`}
              >
                {cell.day}
              </button>
            );
          })}
        </div>
      </section>

      {/* 범례 — 스와치 ≥16px, 텍스트 ≥14px(#1F2937), 셀과 동일 패턴 */}
      <section data-tour="calendar-legend" className="mt-6 grid grid-cols-2 gap-y-3 px-1">
        <div className="flex items-center gap-2">
          <div className="h-4 w-4 rounded border-2 border-[#16A34A] bg-white" />
          <span className="text-sm font-semibold text-[#1F2937]">{t("legend.available")}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-4 w-4 rounded bg-[#2563EB]" />
          <span className="text-sm font-semibold text-[#1F2937]">{t("legend.booked")}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-4 w-4 rounded border-2 border-dashed border-[#2563EB]/40 bg-[#DBEAFE]" />
          <span className="text-sm font-semibold text-[#1F2937]">{t("legend.hold")}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className={`h-4 w-4 rounded ${HATCH_CLASS}`} />
          <span className="text-sm font-semibold text-[#1F2937]">{t("legend.blocked")}</span>
        </div>
      </section>

      {/* 드래그 범위 선택 안내 — 비기술 vi 사용자에게 길게눌러/끌기 힌트 */}
      <p className="mt-4 flex items-center gap-2 rounded-xl bg-teal-50 px-3 py-2.5 text-xs font-medium text-teal-700">
        <span className="material-symbols-outlined text-base">swipe</span>
        {t("range.hint")}
      </p>

      {/* 범위 일괄 잠금/해제 팝오버 — 드래그로 2칸 이상 선택 시 (a3 라이트 톤) */}
      {rangePop &&
        (() => {
          const { lockable, unlockable } = rangeCounts(rangePop);
          const dayCount = rangePop.hi - rangePop.lo + 1;
          return (
            <div
              ref={rangePopRef}
              className="fixed z-[70] w-60 rounded-2xl border border-gray-100 bg-white p-4 shadow-[0_10px_40px_rgba(0,0,0,0.18)]"
              style={{ left: rangePop.x, top: rangePop.y }}
            >
              <div className="mb-2 flex items-start justify-between">
                <div>
                  <p className="text-sm font-extrabold tabular-nums text-gray-800">
                    {formatDateVn(days[rangePop.lo].date)} – {formatDateVn(days[rangePop.hi].date)}
                  </p>
                  <p className="text-xs font-bold text-teal-600">
                    {t("range.days", { count: dayCount })}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (rangePending) return;
                    setRangePop(null);
                    setRangeError(null);
                  }}
                  className="text-gray-400 active:scale-90"
                  aria-label={t("sheet.close")}
                >
                  <span className="material-symbols-outlined text-lg">close</span>
                </button>
              </div>
              {rangeError && (
                <p className="mb-3 rounded-lg bg-red-50 p-2.5 text-xs font-medium text-red-600">
                  {t(`sheet.${rangeError}`)}
                </p>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={rangePending || lockable === 0}
                  onClick={() => submitRange("lock")}
                  className="flex flex-1 items-center justify-center gap-1 rounded-xl bg-teal-600 py-3 text-sm font-bold text-white transition active:scale-[0.98] disabled:opacity-40"
                >
                  <span className="material-symbols-outlined text-[16px]">lock</span>
                  {rangePending ? t("sheet.processing") : t("range.lock", { count: lockable })}
                </button>
                <button
                  type="button"
                  disabled={rangePending || unlockable === 0}
                  onClick={() => submitRange("unlock")}
                  className="flex flex-1 items-center justify-center gap-1 rounded-xl border-2 border-teal-600 bg-white py-3 text-sm font-bold text-teal-600 transition active:scale-[0.98] disabled:opacity-40"
                >
                  <span className="material-symbols-outlined text-[16px]">lock_open</span>
                  {rangePending ? t("sheet.processing") : t("range.unlock", { count: unlockable })}
                </button>
              </div>
            </div>
          );
        })()}

      {/* 바텀시트 + 백드롭 (a3) */}
      {sheet && (
        <>
          <div
            className="fixed inset-0 z-50 bg-slate-900/20 backdrop-blur-[2px]"
            onClick={closeSheet}
            aria-hidden
          />
          <div className="fixed inset-x-0 bottom-0 z-[60]">
            <div className="mx-auto w-full max-w-lg rounded-t-[2rem] bg-white p-6 pt-2 shadow-[0_-10px_40px_rgba(0,0,0,0.1)]">
              <div className="mb-6 flex justify-center">
                <div className="mt-2 h-1.5 w-12 rounded-full bg-gray-200" />
              </div>

              {/* 날짜 기반 시트 (차단/해제/iCal) */}
              {sheet.mode !== "booking" && (
                <>
                  <div className="mb-6 flex items-center gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-teal-50 text-teal-600">
                      <span className="material-symbols-outlined">date_range</span>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-500">{t("sheet.dateLabel")}</p>
                      <h3 className="text-xl font-bold text-gray-800">{formatDateVn(sheet.date)}</h3>
                    </div>
                  </div>

                  {/* 빈 날짜(lock) — 2-옵션 칩: 차단 vs 직접예약 기록 (a-direct-booking) */}
                  {sheet.mode === "lock" && (
                    <div className="mb-4 grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          setEmptyAction("lock");
                          setErrorKey(null);
                        }}
                        className={
                          emptyAction === "lock"
                            ? "flex h-20 flex-col items-center justify-center gap-1 rounded-xl border-2 border-teal-600 bg-teal-50 text-teal-700 shadow-sm transition-transform active:scale-[0.98]"
                            : "flex h-20 flex-col items-center justify-center gap-1 rounded-xl border-2 border-gray-200 bg-white text-gray-600 transition-transform active:scale-[0.98]"
                        }
                      >
                        <span className="material-symbols-outlined">lock</span>
                        <span className="text-sm font-semibold">{t("sheet.lock")}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEmptyAction("direct");
                          setErrorKey(null);
                        }}
                        className={
                          emptyAction === "direct"
                            ? "flex h-20 flex-col items-center justify-center gap-1 rounded-xl border-2 border-teal-600 bg-teal-50 text-teal-700 shadow-sm transition-transform active:scale-[0.98]"
                            : "flex h-20 flex-col items-center justify-center gap-1 rounded-xl border-2 border-gray-200 bg-white text-gray-600 transition-transform active:scale-[0.98]"
                        }
                      >
                        <span className="material-symbols-outlined">book_online</span>
                        <span className="text-center text-sm font-bold leading-tight">
                          {t("direct.recordOption")}
                        </span>
                      </button>
                    </div>
                  )}

                  {errorKey && (
                    <p className="mb-4 rounded-xl bg-red-50 p-3 text-sm font-medium text-red-600">
                      {t(`sheet.${errorKey}`)}
                    </p>
                  )}

                  {/* 직접예약 폼 (직접예약 옵션 active) */}
                  {sheet.mode === "lock" && emptyAction === "direct" && (
                    <DirectBookingForm
                      date={sheet.date}
                      nights={nights}
                      setNights={setNights}
                      guestName={guestName}
                      setGuestName={setGuestName}
                      guestCount={guestCount}
                      setGuestCount={setGuestCount}
                      amountVnd={amountVnd}
                      setAmountVnd={setAmountVnd}
                      contact={contact}
                      setContact={setContact}
                      pending={pending}
                      onSubmit={submitDirectBooking}
                    />
                  )}

                  <div className="flex flex-col gap-3 pb-8">
                    {sheet.mode === "lock" && emptyAction === "lock" && (
                      <button
                        type="button"
                        onClick={submit}
                        disabled={pending}
                        className="flex h-16 w-full items-center justify-center gap-2 rounded-2xl bg-teal-600 text-lg font-bold text-white transition-all active:scale-[0.98] disabled:opacity-60"
                      >
                        <span className="material-symbols-outlined">lock</span>
                        {pending ? t("sheet.processing") : t("sheet.lock")}
                      </button>
                    )}
                    {sheet.mode === "unlock" && (
                      <button
                        type="button"
                        onClick={submit}
                        disabled={pending}
                        className="flex h-16 w-full items-center justify-center gap-2 rounded-2xl border-2 border-teal-600 bg-white text-lg font-bold text-teal-600 transition-all active:scale-[0.98] disabled:opacity-60"
                      >
                        <span className="material-symbols-outlined">lock_open</span>
                        {pending ? t("sheet.processing") : t("sheet.unlock")}
                      </button>
                    )}
                    {sheet.mode === "ical" && (
                      <p className="flex items-start gap-2 rounded-xl bg-gray-50 p-4 text-sm font-medium text-gray-600">
                        <span className="material-symbols-outlined shrink-0 text-gray-400">sync</span>
                        {t("sheet.icalInfo")}
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={closeSheet}
                      className="h-12 w-full rounded-2xl text-sm font-semibold text-gray-500 active:scale-[0.98]"
                    >
                      {t("sheet.close")}
                    </button>
                  </div>
                </>
              )}

              {/* E 예약 상세 시트 (a14) — 확정/가예약 분기. 고객명·판매가 없음 */}
              {sheet.mode === "booking" && booking && (
                <BookingSheet
                  booking={booking}
                  now={now}
                  onClose={closeSheet}
                />
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** YYYY-MM-DD → DD/MM (바텀시트 컴팩트 표기) */
function formatDateShort(date: string): string {
  const [, m, d] = date.split("-");
  return `${d}/${m}`;
}

/** ms 잔여 → MM:SS (음수면 00:00). 시간 단위 초과 시 HH:MM:SS */
function formatCountdown(ms: number): string {
  if (ms <= 0) return "00:00";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** E 예약 상세 바텀시트 (a14) — 확정(Đã xác nhận)·가예약(Giữ chỗ) 분기.
 *  표시: 체크인/아웃·박수·인원·상태·자기 정산 예정액·홀드 카운트다운. 고객명·판매가·KRW 없음. */
function BookingSheet({
  booking,
  now,
  onClose,
}: {
  booking: BookingDetail;
  now: number;
  onClose: () => void;
}) {
  const t = useTranslations("calendar.bookingSheet");
  const isHold = booking.status === "HOLD";
  const remainMs =
    isHold && booking.holdExpiresAt
      ? new Date(booking.holdExpiresAt).getTime() - now
      : 0;
  const expired = isHold && remainMs <= 0;

  return (
    <div className="pb-8">
      {/* 상태 배지 + (홀드면) 만료 카운트다운 */}
      <div className="mb-6 flex items-center justify-between">
        {isHold ? (
          <div className="rounded-lg border-2 border-dashed border-[#2563EB] bg-[#DBEAFE] px-3 py-1 text-sm font-bold text-[#2563EB]">
            {t("statusHold")}
          </div>
        ) : (
          <div className="rounded-lg bg-[#2563EB] px-3 py-1 text-sm font-bold text-white">
            {t("statusConfirmed")}
          </div>
        )}
        {isHold && booking.holdExpiresAt && (
          <div
            className={`flex items-center gap-1.5 rounded-md border px-2 py-1 ${
              expired
                ? "border-rose-100 bg-rose-50 text-rose-600"
                : "border-amber-100 bg-amber-50 text-amber-600"
            }`}
          >
            <span className="material-symbols-outlined text-sm">timer</span>
            <span className="font-mono text-xs font-bold uppercase tracking-tight tabular-nums">
              {expired ? t("expired") : t("expiresIn", { time: formatCountdown(remainMs) })}
            </span>
          </div>
        )}
      </div>

      {/* 체크인 → 박수 → 체크아웃 */}
      <div className="mb-4 flex items-center justify-between rounded-xl border border-neutral-100 bg-neutral-50 p-4">
        <div className="flex flex-col">
          <span className="mb-1 text-[10px] font-bold uppercase tracking-wider text-neutral-400">
            {t("checkIn")}
          </span>
          <span className="text-lg font-bold text-neutral-800">{formatDateShort(booking.checkIn)}</span>
        </div>
        <div className="flex flex-col items-center">
          <div className="mb-1 rounded-full border border-neutral-200 bg-white px-3 py-0.5 text-[10px] font-bold text-neutral-500 shadow-sm">
            {t("nights", { count: booking.nights })}
          </div>
          <span className="material-symbols-outlined text-neutral-300">east</span>
        </div>
        <div className="flex flex-col items-end">
          <span className="mb-1 text-[10px] font-bold uppercase tracking-wider text-neutral-400">
            {t("checkOut")}
          </span>
          <span className="text-lg font-bold text-neutral-800">{formatDateShort(booking.checkOut)}</span>
        </div>
      </div>

      {/* 인원 */}
      <div className="mb-6 flex items-center gap-3 px-1">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-teal-50 text-teal-600">
          <span className="material-symbols-outlined">groups</span>
        </div>
        <div className="flex flex-col">
          <span className="text-xs font-medium text-neutral-400">{t("guests")}</span>
          <span className="text-base font-bold text-neutral-800">
            {t("guestCount", { count: booking.guestCount })}
          </span>
        </div>
      </div>

      {/* 정산 예정액 (공급자 본인 받을 금액 — 판매가·마진 아님) */}
      <div className="mb-6 rounded-2xl bg-teal-600 p-5 text-white shadow-lg shadow-teal-900/10">
        <div className="mb-3 flex items-start justify-between">
          <span className="text-sm font-medium opacity-90">{t("payoutLabel")}</span>
          <span className="material-symbols-outlined opacity-80">account_balance_wallet</span>
        </div>
        <div className="flex flex-col">
          <div className="mb-1 text-3xl font-extrabold tracking-tight tabular-nums">
            {formatVnd(booking.supplierPayoutVnd)}₫
          </div>
          <span className="text-[11px] font-medium uppercase tracking-widest opacity-70">
            {t("payoutHint")}
          </span>
        </div>
      </div>

      {/* 검수 진입 — 직접예약만 (운영자 예약은 inspectAction=null → 미노출) */}
      {booking.inspectAction && (
        <Link
          href={`/my-bookings/${booking.id}/${booking.inspectAction}`}
          className="mb-2 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-teal-600 text-base font-bold text-white shadow-lg shadow-teal-900/10 active:scale-[0.98]"
        >
          <span className="material-symbols-outlined">
            {booking.inspectAction === "checkin" ? "login" : "logout"}
          </span>
          {t(booking.inspectAction === "checkin" ? "goCheckin" : "goCheckout")}
        </Link>
      )}

      <button
        type="button"
        onClick={onClose}
        className="h-12 w-full rounded-2xl text-sm font-semibold text-gray-500 active:scale-[0.98]"
      >
        {t("close")}
      </button>
    </div>
  );
}

/** 직접예약 기록 폼 (F10 a-direct-booking) — 박수 스테퍼·고객명(필수)·인원·받은 금액(선택)·연락처(선택).
 *  다박: 체크인=선택일, 박수 스테퍼(1~30)로 체크아웃 자동계산(read-only 표시). 비기술 vi 단순성 우선.
 *  마진·재고 비공개: KRW·판매가·우리 마진 없음. 금액은 공급자가 받은 VND뿐. */
function DirectBookingForm({
  date,
  nights,
  setNights,
  guestName,
  setGuestName,
  guestCount,
  setGuestCount,
  amountVnd,
  setAmountVnd,
  contact,
  setContact,
  pending,
  onSubmit,
}: {
  date: string;
  nights: number;
  setNights: (v: number) => void;
  guestName: string;
  setGuestName: (v: string) => void;
  guestCount: number;
  setGuestCount: (v: number) => void;
  amountVnd: string;
  setAmountVnd: (v: string) => void;
  contact: string;
  setContact: (v: string) => void;
  pending: boolean;
  onSubmit: () => void;
}) {
  const t = useTranslations("calendar.direct");
  const checkOut = checkOutFromNights(date, nights);

  return (
    <form
      className="space-y-5 pb-8"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      {/* 날짜 (체크인=선택값, 체크아웃=박수 자동계산. 요일 힌트 — a-direct-booking) */}
      <div>
        <label className="text-xs font-bold uppercase tracking-wide text-neutral-400">
          {t("dateLabel")}
        </label>
        <div className="mt-2 flex items-center justify-between rounded-xl border border-neutral-100 bg-neutral-50 p-4">
          <div className="flex flex-col">
            <span className="mb-0.5 text-[10px] font-bold uppercase tracking-wider text-neutral-400">
              {t("checkIn")}
            </span>
            <span className="text-lg font-bold">
              {formatDateVn(date)}{" "}
              <span className="text-sm font-medium text-neutral-400">
                ({t(`weekdayShort.${vnWeekdayKey(date)}`)})
              </span>
            </span>
          </div>
          <span className="material-symbols-outlined text-neutral-300">east</span>
          <div className="flex flex-col items-end">
            <span className="mb-0.5 text-[10px] font-bold uppercase tracking-wider text-neutral-400">
              {t("checkOut")}
            </span>
            <span className="text-lg font-bold">
              {formatDateVn(checkOut)}{" "}
              <span className="text-sm font-medium text-neutral-400">
                ({t(`weekdayShort.${vnWeekdayKey(checkOut)}`)})
              </span>
            </span>
          </div>
        </div>
      </div>

      {/* 박수 스테퍼 (1~30박) — 체크아웃 자동계산. 비기술 vi 사용자 단순성 우선 */}
      <div>
        <label className="text-xs font-bold uppercase tracking-wide text-neutral-400">
          {t("nightsLabel")}
        </label>
        <div className="mt-2 flex h-16 items-center justify-between rounded-xl border border-neutral-100 bg-neutral-50 px-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-teal-50 text-teal-600">
              <span className="material-symbols-outlined">dark_mode</span>
            </div>
            <span className="text-base font-semibold">
              {t("nights", { count: nights })}
            </span>
          </div>
          <div className="flex items-center gap-4">
            <button
              type="button"
              aria-label={t("decreaseNights")}
              onClick={() => setNights(Math.max(1, nights - 1))}
              className="flex h-11 w-11 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-600 transition-transform active:scale-90 disabled:opacity-40"
              disabled={nights <= 1}
            >
              <span className="material-symbols-outlined">remove</span>
            </button>
            <span className="w-7 text-center text-2xl font-extrabold tabular-nums">
              {nights}
            </span>
            <button
              type="button"
              aria-label={t("increaseNights")}
              onClick={() => setNights(Math.min(30, nights + 1))}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-teal-600 text-white shadow-sm transition-transform active:scale-90 disabled:opacity-40"
              disabled={nights >= 30}
            >
              <span className="material-symbols-outlined">add</span>
            </button>
          </div>
        </div>
      </div>

      {/* 고객명 (유일 필수 텍스트) */}
      <div>
        <label className="text-xs font-bold uppercase tracking-wide text-neutral-400">
          {t("guestName")} <span className="text-[#DC2626]">*</span>
        </label>
        <div className="mt-2 flex h-14 items-center gap-2 rounded-xl border border-neutral-200 bg-white px-4 focus-within:ring-2 focus-within:ring-teal-500">
          <span className="material-symbols-outlined text-neutral-400">person</span>
          <input
            className="min-w-0 flex-1 border-none bg-transparent p-0 text-base font-medium placeholder-neutral-300 focus:ring-0"
            placeholder={t("guestNamePlaceholder")}
            type="text"
            value={guestName}
            maxLength={100}
            onChange={(e) => setGuestName(e.target.value)}
          />
        </div>
      </div>

      {/* 인원 스테퍼 */}
      <div>
        <label className="text-xs font-bold uppercase tracking-wide text-neutral-400">
          {t("guestCount")}
        </label>
        <div className="mt-2 flex h-16 items-center justify-between rounded-xl border border-neutral-100 bg-neutral-50 px-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-teal-50 text-teal-600">
              <span className="material-symbols-outlined">groups</span>
            </div>
            <span className="text-base font-semibold">{t("guestsWord")}</span>
          </div>
          <div className="flex items-center gap-4">
            <button
              type="button"
              aria-label={t("decrease")}
              onClick={() => setGuestCount(Math.max(1, guestCount - 1))}
              className="flex h-11 w-11 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-600 transition-transform active:scale-90"
            >
              <span className="material-symbols-outlined">remove</span>
            </button>
            <span className="w-7 text-center text-2xl font-extrabold tabular-nums">
              {guestCount}
            </span>
            <button
              type="button"
              aria-label={t("increase")}
              onClick={() => setGuestCount(Math.min(50, guestCount + 1))}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-teal-600 text-white shadow-sm transition-transform active:scale-90"
            >
              <span className="material-symbols-outlined">add</span>
            </button>
          </div>
        </div>
      </div>

      {/* 받은 금액 VND (선택) — 천단위 dot 자동 포맷 */}
      <div>
        <div className="flex items-center justify-between">
          <label className="text-xs font-bold uppercase tracking-wide text-neutral-400">
            {t("amountLabel")}
          </label>
          <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-bold text-neutral-400">
            {t("optional")}
          </span>
        </div>
        <div className="mt-2 flex h-14 items-center gap-2 rounded-xl border border-neutral-200 bg-white px-4 focus-within:ring-2 focus-within:ring-teal-500">
          <span className="material-symbols-outlined text-neutral-400">payments</span>
          <input
            className="min-w-0 flex-1 border-none bg-transparent p-0 text-lg font-bold tabular-nums placeholder-neutral-300 focus:ring-0"
            inputMode="numeric"
            placeholder="0"
            type="text"
            value={amountVnd}
            onChange={(e) => setAmountVnd(formatVndInput(e.target.value))}
          />
          <span className="font-bold text-neutral-400">₫</span>
        </div>
      </div>

      {/* 연락처 (선택) */}
      <div>
        <div className="flex items-center justify-between">
          <label className="text-xs font-bold uppercase tracking-wide text-neutral-400">
            {t("contactLabel")}
          </label>
          <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-bold text-neutral-400">
            {t("optional")}
          </span>
        </div>
        <div className="mt-2 flex h-14 items-center gap-2 rounded-xl border border-neutral-200 bg-white px-4 focus-within:ring-2 focus-within:ring-teal-500">
          <span className="material-symbols-outlined text-neutral-400">call</span>
          <input
            className="min-w-0 flex-1 border-none bg-transparent p-0 text-base font-medium tabular-nums placeholder-neutral-300 focus:ring-0"
            inputMode="tel"
            placeholder={t("contactPlaceholder")}
            type="tel"
            maxLength={30}
            value={contact}
            onChange={(e) => setContact(e.target.value)}
          />
        </div>
      </div>

      {/* 저장 */}
      <button
        type="submit"
        disabled={pending || !guestName.trim()}
        className="mt-2 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-teal-600 text-lg font-bold text-white shadow-lg shadow-teal-900/10 transition-all active:scale-[0.98] disabled:opacity-60"
      >
        <span className="material-symbols-outlined">check_circle</span>
        {pending ? t("saving") : t("save")}
      </button>
    </form>
  );
}
