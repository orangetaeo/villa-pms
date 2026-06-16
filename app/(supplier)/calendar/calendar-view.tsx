"use client";

// SUPPLIER 월 달력 클라이언트 뷰 (T1.4) — design/stitch/a3-calendar 변환
// 셀 4상태는 색+패턴 병행 (색약 대응): 공실=초록 외곽선 / 확정=파랑 실선 /
// 홀드=연파랑+파선 / 차단=회색+대각 빗금(인라인 repeating gradient — globals.css 비수정)
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { formatVnd } from "@/app/(supplier)/my-villas/new/wizard-types";

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
}

interface CalendarViewProps {
  villas: { id: string; name: string }[];
  selectedVillaId: string;
  month: string; // YYYY-MM
  days: DayCell[];
  leadingBlanks: number;
  bookingDetails: Record<string, BookingDetail>;
}

type SheetState =
  | { mode: "lock"; date: string }
  | { mode: "unlock"; date: string; blockId: string }
  | { mode: "ical"; date: string }
  | { mode: "booking"; bookingId: string };

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

  function closeSheet() {
    if (pending) return;
    setSheet(null);
    setErrorKey(null);
  }

  function onCellTap(cell: DayCell) {
    setErrorKey(null);
    // 예약(확정·홀드) 셀 — 상세 바텀시트 (과거여도 정보 열람 허용)
    if ((cell.status === "BOOKED" || cell.status === "HOLD") && cell.bookingId) {
      setSheet({ mode: "booking", bookingId: cell.bookingId });
      return;
    }
    // 과거 공실/차단은 읽기 전용
    if (cell.isPast) return;
    if (cell.status === "AVAILABLE") {
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
      {/* 빌라 선택 칩 행 — 자기 빌라만 */}
      {/* 스크롤바 숨김 — globals.css 수정 금지라 arbitrary value 사용 */}
      <section className="-mx-4 flex gap-2 overflow-x-auto px-4 py-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {villas.map((villa) => (
          <button
            key={villa.id}
            type="button"
            onClick={() => navigate(villa.id, month)}
            className={
              villa.id === selectedVillaId
                ? "whitespace-nowrap rounded-full bg-teal-600 px-5 py-2.5 font-medium text-white shadow-sm transition-transform active:scale-95"
                : "whitespace-nowrap rounded-full border border-gray-200 bg-white px-5 py-2.5 font-medium text-gray-600 transition-transform active:scale-95"
            }
          >
            {villa.name}
          </button>
        ))}
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
      <section className="rounded-2xl border border-gray-100 bg-white p-3 shadow-sm">
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
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: leadingBlanks }).map((_, i) => (
            <div key={`blank-${i}`} aria-hidden className="aspect-[1/1.1]" />
          ))}
          {days.map((cell) => (
            <button
              key={cell.date}
              type="button"
              onClick={() => onCellTap(cell)}
              className={cellClass(cell)}
              aria-label={`${formatDateVn(cell.date)} — ${t(`legend.${cell.status.toLowerCase()}`)}`}
            >
              {cell.day}
            </button>
          ))}
        </div>
      </section>

      {/* 범례 — 스와치 ≥16px, 텍스트 ≥14px(#1F2937), 셀과 동일 패턴 */}
      <section className="mt-6 grid grid-cols-2 gap-y-3 px-1">
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

                  {errorKey && (
                    <p className="mb-4 rounded-xl bg-red-50 p-3 text-sm font-medium text-red-600">
                      {t(`sheet.${errorKey}`)}
                    </p>
                  )}

                  <div className="flex flex-col gap-3 pb-8">
                    {sheet.mode === "lock" && (
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
