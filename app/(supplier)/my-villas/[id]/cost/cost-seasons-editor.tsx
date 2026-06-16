"use client";

// D 원가 관리 + 빌라별 시즌 (a15) — 시즌 3카드(원가 수정/삭제) + a5 키패드 + 시즌 날짜 범위 선택 바텀시트.
// 원가: PATCH /cost (수정) · DELETE /cost (행 삭제). 시즌 기간: GET/POST/PATCH/DELETE /seasons.
// 마진 비공개: "giá gốc"(원가, supplierCostVnd)만. 판매가·마진·KRW 없음.
// 게이트(a5): 빈 시즌(원가 미입력) "Lưu" 비활성.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { SEASONS, type Season } from "@/lib/villa-schema";
import { formatVnd } from "@/app/(supplier)/my-villas/new/wizard-types";

const MAX_DIGITS = 12;

const SEASON_STYLE: Record<Season, { dot: string; ring: string }> = {
  LOW: { dot: "bg-emerald-500", ring: "ring-emerald-500/20" },
  HIGH: { dot: "bg-amber-500", ring: "ring-amber-500/20" },
  PEAK: { dot: "bg-red-500", ring: "ring-red-500/20" },
};

export interface InitialSeasonPeriod {
  id: string;
  season: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD (exclusive)
  label: string | null;
}

interface Props {
  villaId: string;
  initialCosts: Record<string, string>; // season → VND digits ("" = 미입력)
  initialPeriods: InitialSeasonPeriod[];
}

/** YYYY-MM-DD → DD/MM */
function fmtShort(date: string): string {
  const [, m, d] = date.split("-");
  return `${d}/${m}`;
}

/** endDate는 exclusive 저장 → 표시용으로 하루 뺀 inclusive 날짜 */
function inclusiveEnd(endExclusive: string): string {
  const dt = new Date(`${endExclusive}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
}

export default function CostSeasonsEditor({ villaId, initialCosts, initialPeriods }: Props) {
  const t = useTranslations("costSeasons");
  const tSeason = useTranslations("villaDetail.season");
  const router = useRouter();

  const [costs, setCosts] = useState<Record<string, string>>(initialCosts);
  const [periods, setPeriods] = useState<InitialSeasonPeriod[]>(initialPeriods);
  const [activeSeason, setActiveSeason] = useState<Season>("LOW");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 날짜 범위 선택 바텀시트 대상 시즌 (null = 닫힘)
  const [datePickerSeason, setDatePickerSeason] = useState<Season | null>(null);

  const activeCost = costs[activeSeason] ?? "";
  const activeEmpty = activeCost === "";

  function periodOf(season: Season): InitialSeasonPeriod | undefined {
    return periods.find((p) => p.season === season);
  }

  // ── 키패드 → 활성 시즌 원가 입력 ──────────────────────
  function handleKey(key: string) {
    setCosts((prev) => {
      const current = prev[activeSeason] ?? "";
      let next = current;
      if (key === "del") next = current.slice(0, -1);
      else if (key === "0" && current === "") return prev; // 선행 0 방지
      else if (current.length < MAX_DIGITS) next = current + key;
      return { ...prev, [activeSeason]: next };
    });
  }

  // ── 원가 행 삭제 (DELETE) ─────────────────
  async function deleteCost(season: Season) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/villas/${villaId}/cost`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ season }),
      });
      if (!res.ok) {
        setError(t("saveError"));
        return;
      }
      setCosts((prev) => ({ ...prev, [season]: "" }));
      router.refresh();
    } catch {
      setError(t("saveError"));
    } finally {
      setSaving(false);
    }
  }

  // 변경된 시즌(초기값과 다르고 값 있는) 일괄 저장
  async function saveAll() {
    setSaving(true);
    setError(null);
    try {
      for (const season of SEASONS) {
        const value = costs[season] ?? "";
        if (value === "" || value === initialCosts[season]) continue;
        const res = await fetch(`/api/villas/${villaId}/cost`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ season, supplierCostVnd: value }),
        });
        if (!res.ok) {
          setError(t("saveError"));
          return;
        }
      }
      router.push(`/my-villas/${villaId}`);
      router.refresh();
    } catch {
      setError(t("saveError"));
    } finally {
      setSaving(false);
    }
  }

  // 빈 시즌(값 있는 시즌 중 변경분이 있어야 저장 활성). 빈 값 게이트.
  const hasChanges = SEASONS.some(
    (s) => (costs[s] ?? "") !== "" && (costs[s] ?? "") !== initialCosts[s]
  );

  // ── 시즌 날짜 범위 저장 (POST 신규 / PATCH 기존) ──────────
  async function saveDateRange(season: Season, startDate: string, endExclusive: string) {
    setSaving(true);
    setError(null);
    const existing = periodOf(season);
    try {
      const res = await fetch(`/api/villas/${villaId}/seasons`, {
        method: existing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(existing ? { id: existing.id } : {}),
          season,
          startDate,
          endDate: endExclusive,
        }),
      });
      if (res.status === 409) {
        setError(t("overlapError"));
        return;
      }
      if (!res.ok) {
        setError(t("saveError"));
        return;
      }
      const { period } = (await res.json()) as { period: InitialSeasonPeriod };
      setPeriods((prev) => {
        const rest = prev.filter((p) => p.id !== period.id && p.season !== season);
        return [...rest, period];
      });
      setDatePickerSeason(null);
      router.refresh();
    } catch {
      setError(t("saveError"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <main className="px-4 pb-[420px] pt-6">
        {error && (
          <p className="mb-4 rounded-lg bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700" role="alert">
            {error}
          </p>
        )}

        <div className="space-y-4">
          {SEASONS.map((season) => {
            const style = SEASON_STYLE[season];
            const value = costs[season] ?? "";
            const empty = value === "";
            const isActive = activeSeason === season;
            const period = periodOf(season);
            return (
              <section
                key={season}
                onClick={() => setActiveSeason(season)}
                className={`relative cursor-pointer rounded-xl p-4 transition-all ${
                  isActive ? "border-2 border-teal-600 bg-teal-50" : "border border-slate-200 bg-white"
                }`}
              >
                {/* 시즌 원가 행 삭제 (값 있을 때만) */}
                {!empty && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteCost(season);
                    }}
                    disabled={saving}
                    aria-label={t("deleteCost")}
                    className="absolute right-4 top-4 text-slate-400 active:text-red-500 disabled:opacity-50"
                  >
                    <span className="material-symbols-outlined text-[20px]">delete</span>
                  </button>
                )}

                <div className="mb-3 flex items-center gap-3">
                  <div
                    className={`h-2.5 w-2.5 rounded-full ${style.dot} ${
                      isActive ? `ring-4 ${style.ring}` : ""
                    }`}
                  />
                  <span className="font-medium text-slate-600">{tSeason(season)}</span>
                </div>

                <div className="mb-4">
                  {empty ? (
                    <span className="text-xl font-bold text-slate-300">{t("noPriceEntered")}</span>
                  ) : (
                    <span
                      className={`text-3xl font-bold tabular-nums ${
                        isActive ? "text-teal-600" : "text-slate-300"
                      }`}
                    >
                      {formatVnd(value)}₫
                    </span>
                  )}
                </div>

                {/* 적용 날짜 범위 pill + 수정 */}
                <div className="flex items-center justify-between gap-2">
                  {period ? (
                    <div
                      className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium ${
                        isActive ? "bg-white text-slate-700 shadow-sm" : "bg-slate-50 text-slate-500"
                      }`}
                    >
                      <span className="material-symbols-outlined text-[16px] text-teal-600">
                        calendar_month
                      </span>
                      {t("appliedRange", {
                        start: fmtShort(period.startDate),
                        end: fmtShort(inclusiveEnd(period.endDate)),
                      })}
                    </div>
                  ) : (
                    <span className="text-xs font-medium text-slate-400">{t("noDateRange")}</span>
                  )}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDatePickerSeason(season);
                    }}
                    className="text-xs font-bold text-teal-600 underline underline-offset-4"
                  >
                    {t("editDates")}
                  </button>
                </div>
              </section>
            );
          })}
        </div>
      </main>

      {/* 하단 고정: 저장 버튼 + 숫자 키패드 (a5) */}
      <div className="pb-safe fixed bottom-0 left-0 z-40 w-full rounded-t-3xl border-t border-neutral-100 bg-white pt-4 shadow-[0_-8px_20px_rgba(0,0,0,0.05)]">
        <div className="mx-auto w-full max-w-[420px]">
          <div className="mb-4 px-4">
            <button
              type="button"
              disabled={!hasChanges || saving}
              onClick={saveAll}
              className={`w-full rounded-xl py-4 text-lg font-bold text-white shadow-lg transition-all active:scale-[0.98] ${
                !hasChanges || saving ? "cursor-not-allowed bg-neutral-300" : "bg-teal-600 hover:bg-teal-700"
              }`}
            >
              {saving ? t("saving") : t("saveChanges")}
            </button>
            {activeEmpty && (
              <p className="mt-2 text-center text-xs font-medium text-slate-400">
                {t("enterPriceHint", { season: tSeason(activeSeason) })}
              </p>
            )}
          </div>

          <div className="grid grid-cols-3 gap-px border-t border-neutral-100 bg-neutral-100">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => (
              <KeypadButton key={digit} onClick={() => handleKey(digit)}>
                {digit}
              </KeypadButton>
            ))}
            <div className="bg-neutral-50 py-4 text-center text-2xl font-semibold text-neutral-300">.</div>
            <KeypadButton onClick={() => handleKey("0")}>0</KeypadButton>
            <button
              type="button"
              onClick={() => handleKey("del")}
              aria-label={t("backspace")}
              className="flex items-center justify-center bg-neutral-50 py-4 text-neutral-700 transition-transform active:scale-95 active:bg-neutral-200"
            >
              <span className="material-symbols-outlined">backspace</span>
            </button>
          </div>
        </div>
      </div>

      {/* 시즌 날짜 범위 선택 바텀시트 */}
      {datePickerSeason && (
        <DateRangeSheet
          seasonLabel={tSeason(datePickerSeason)}
          initial={periodOf(datePickerSeason)}
          saving={saving}
          onClose={() => setDatePickerSeason(null)}
          onConfirm={(start, endExclusive) =>
            saveDateRange(datePickerSeason, start, endExclusive)
          }
        />
      )}
    </>
  );
}

function KeypadButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="bg-white py-4 text-2xl font-semibold text-neutral-700 transition-transform active:scale-95 active:bg-neutral-200"
    >
      {children}
    </button>
  );
}

// ===================== 날짜 범위 선택 바텀시트 =====================
// 미니 달력(연도 2026 기준, 월 이동). 시작/끝 두 번 탭 → 범위. 종료는 inclusive 선택,
// 저장 시 exclusive(+1일)로 변환해 API 규약(half-open) 충족.
const PICKER_YEAR_DEFAULT = 2026;

function toIso(y: number, m0: number, d: number): string {
  return `${y}-${String(m0 + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
function addDayIso(iso: string): string {
  const dt = new Date(`${iso}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
}

function DateRangeSheet({
  seasonLabel,
  initial,
  saving,
  onClose,
  onConfirm,
}: {
  seasonLabel: string;
  initial?: InitialSeasonPeriod;
  saving: boolean;
  onClose: () => void;
  onConfirm: (start: string, endExclusive: string) => void;
}) {
  const t = useTranslations("costSeasons");

  // 초기 표시 월 — 기존 시작일 또는 2026-01
  const initStart = initial?.startDate;
  const [year, setYear] = useState(
    initStart ? Number(initStart.slice(0, 4)) : PICKER_YEAR_DEFAULT
  );
  const [month0, setMonth0] = useState(initStart ? Number(initStart.slice(5, 7)) - 1 : 0);

  // 선택 상태 — start만 있으면 시작점 선택 중, 둘 다 있으면 범위 확정
  const [start, setStart] = useState<string | null>(initStart ?? null);
  // 기존 endDate(exclusive) → inclusive 표시값
  const initEndIncl = initial
    ? (() => {
        const dt = new Date(`${initial.endDate}T00:00:00Z`);
        dt.setUTCDate(dt.getUTCDate() - 1);
        return dt.toISOString().slice(0, 10);
      })()
    : null;
  const [end, setEnd] = useState<string | null>(initEndIncl);

  const weekdays = [t("wd.mon"), t("wd.tue"), t("wd.wed"), t("wd.thu"), t("wd.fri"), t("wd.sat"), t("wd.sun")];

  const firstDow = (new Date(Date.UTC(year, month0, 1)).getUTCDay() + 6) % 7; // 월요일 시작
  const daysInMonth = new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();

  function shiftMonth(delta: number) {
    let m = month0 + delta;
    let y = year;
    if (m < 0) {
      m = 11;
      y -= 1;
    } else if (m > 11) {
      m = 0;
      y += 1;
    }
    setMonth0(m);
    setYear(y);
  }

  function onDayTap(iso: string) {
    if (!start || (start && end)) {
      // 새 범위 시작
      setStart(iso);
      setEnd(null);
    } else if (iso < start) {
      setStart(iso);
    } else {
      setEnd(iso);
    }
  }

  function inRange(iso: string): "start" | "end" | "mid" | null {
    if (start && iso === start) return "start";
    if (end && iso === end) return "end";
    if (start && end && iso > start && iso < end) return "mid";
    return null;
  }

  const canConfirm = !!start && !!end && !saving;

  return (
    <>
      <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-[2px]" onClick={onClose} aria-hidden />
      <div className="fixed inset-x-0 bottom-0 z-[60]">
        <div className="mx-auto w-full max-w-[420px] rounded-t-[2rem] bg-white p-5 pt-3 shadow-[0_-10px_40px_rgba(0,0,0,0.1)]">
          <div className="mb-4 flex justify-center">
            <div className="h-1.5 w-12 rounded-full bg-gray-200" />
          </div>

          <h3 className="mb-1 text-center text-base font-bold text-slate-800">
            {t("pickRangeTitle", { season: seasonLabel })}
          </h3>
          <p className="mb-4 text-center text-xs text-slate-400">{t("pickRangeHint")}</p>

          {/* 월 네비게이터 (연도 표시 — 2026) */}
          <div className="mb-3 flex items-center justify-between px-2">
            <button
              type="button"
              onClick={() => shiftMonth(-1)}
              aria-label={t("prevMonth")}
              className="flex h-9 w-9 items-center justify-center rounded-full text-slate-400 active:bg-slate-100"
            >
              <span className="material-symbols-outlined">chevron_left</span>
            </button>
            <h4 className="text-sm font-bold text-slate-800">
              {t("monthYear", { month: month0 + 1, year })}
            </h4>
            <button
              type="button"
              onClick={() => shiftMonth(1)}
              aria-label={t("nextMonth")}
              className="flex h-9 w-9 items-center justify-center rounded-full text-slate-400 active:bg-slate-100"
            >
              <span className="material-symbols-outlined">chevron_right</span>
            </button>
          </div>

          {/* 미니 달력 */}
          <div className="grid grid-cols-7 gap-y-1 text-center text-[11px]">
            {weekdays.map((w) => (
              <div key={w} className="mb-1 font-bold text-slate-400">
                {w}
              </div>
            ))}
            {Array.from({ length: firstDow }).map((_, i) => (
              <div key={`b-${i}`} aria-hidden />
            ))}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const d = i + 1;
              const iso = toIso(year, month0, d);
              const r = inRange(iso);
              let cls = "py-2 text-slate-700";
              if (r === "start" || r === "end")
                cls = "py-2 font-bold bg-teal-600 text-white rounded-full";
              else if (r === "mid") cls = "py-2 text-teal-800 bg-teal-50";
              return (
                <button key={iso} type="button" onClick={() => onDayTap(iso)} className={cls}>
                  {d}
                </button>
              );
            })}
          </div>

          {/* 선택 요약 */}
          <div className="mt-4 flex items-center justify-center gap-2 text-sm font-semibold text-slate-700">
            <span className="tabular-nums">{start ? fmtShort(start) : "—"}</span>
            <span className="material-symbols-outlined text-slate-300">east</span>
            <span className="tabular-nums">{end ? fmtShort(end) : "—"}</span>
          </div>

          <button
            type="button"
            disabled={!canConfirm}
            onClick={() => start && end && onConfirm(start, addDayIso(end))}
            className={`mt-4 w-full rounded-xl py-3 font-bold text-white shadow-lg transition-transform active:scale-[0.98] ${
              canConfirm ? "bg-teal-600" : "cursor-not-allowed bg-neutral-300"
            }`}
          >
            {saving ? t("saving") : t("done")}
          </button>
        </div>
      </div>
    </>
  );
}
