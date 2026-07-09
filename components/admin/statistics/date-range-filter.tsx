"use client";

// 통계 전용 기간 필터 — 프리셋 칩 + 커스텀 달력(언제부터~언제까지) (T-admin-statistics 통계 v2 FE)
// ★ 소비 계약(BE): URL `?range=<key>`(프리셋) 또는 `?from=YYYY-MM-DD&to=YYYY-MM-DD`(커스텀, 우선).
//   - 프리셋 클릭 → range set, from/to 삭제, router.replace
//   - 커스텀 입력 → from/to set, range 삭제. to<from 막기.
//   - presetKey 있으면 해당 칩 활성, 커스텀이면 칩 비활성 + 달력 강조.
// 프리셋 라벨은 공용 quickDateFilter 네임스페이스 재사용(중복 키 회피). 다크 admin 토큰.

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { DateField } from "@/components/date-field";

/** 통계 프리셋 키(STATS_PRESET_KEYS와 동일 순서·범위) — nextMonth(미래) 제외 */
const RANGE_PRESETS = [
  "all",
  "today",
  "yesterday",
  "thisWeek",
  "lastWeek",
  "thisMonth",
  "lastMonth",
] as const;

export default function DateRangeFilter({
  presetKey,
  fromText,
  toText,
}: {
  /** 현재 적용된 프리셋 키. 커스텀이면 null */
  presetKey: string | null;
  /** 현재 적용 기간(포함 표시) — 커스텀 달력 초기값·표시 */
  fromText: string;
  toText: string;
}) {
  const t = useTranslations("adminStatistics");
  // 프리셋 칩 라벨은 공용 quickDateFilter 네임스페이스 재사용
  const tq = useTranslations("quickDateFilter");
  const router = useRouter();
  const searchParams = useSearchParams();

  const isCustom = presetKey === null;

  // 커스텀 달력 로컬 상태 — 현재 적용 기간으로 초기화
  const [from, setFrom] = useState(fromText);
  const [to, setTo] = useState(toText);

  // 소프트 내비게이션(프리셋 클릭·커스텀 적용) 후 적용 기간(props)이 바뀌면 입력을 재동기화한다.
  // (App Router는 이 client 컴포넌트를 remount하지 않아 useState 초기값이 stale로 고정되는 문제 해결 —
  //  프리셋 적용 후에도 옛 커스텀 값이 남아 '적용' 버튼이 활성→프리셋을 덮어쓰던 BUG-1)
  useEffect(() => {
    setFrom(fromText);
    setTo(toText);
  }, [fromText, toText]);

  const onPreset = (key: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("range", key);
    params.delete("from");
    params.delete("to");
    router.replace(`?${params.toString()}`, { scroll: false });
  };

  // 커스텀 적용 — to<from이면 무시(가드). from/to set, range 삭제.
  const applyCustom = () => {
    if (!from || !to) return;
    if (to < from) return; // 잘못된 범위 막기
    const params = new URLSearchParams(searchParams.toString());
    params.set("from", from);
    params.set("to", to);
    params.delete("range");
    router.replace(`?${params.toString()}`, { scroll: false });
  };

  const invalidRange = !!from && !!to && to < from;
  // 입력이 현재 적용 기간과 같으면 적용 버튼 비활성(불필요 재요청 회피).
  // 프리셋 적용 직후엔 입력이 그 기간으로 동기화되므로(useEffect) 여기서도 비활성 →
  // 활성 버튼으로 프리셋을 동일범위 커스텀으로 덮어쓰는 군더더기 동작 차단(isCustom 조건 제거).
  const unchanged = from === fromText && to === toText;

  const inputClass =
    "bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-200 px-2.5 py-1.5 " +
    "focus:ring-1 focus:ring-admin-primary focus:border-admin-primary [color-scheme:dark] tabular-nums";

  return (
    <div className="flex flex-col gap-2">
      {/* 프리셋 칩 — <768 가로 스크롤 */}
      <div className="flex items-center gap-1 bg-slate-900 rounded-lg p-1 border border-slate-800 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {RANGE_PRESETS.map((r) => {
          const active = presetKey === r;
          return (
            <button
              key={r}
              type="button"
              aria-pressed={active}
              onClick={() => onPreset(r)}
              className={
                active
                  ? "px-3 py-1 text-xs font-bold rounded bg-admin-primary text-white whitespace-nowrap"
                  : "px-3 py-1 text-xs font-medium rounded text-slate-400 hover:text-white whitespace-nowrap"
              }
            >
              {tq(r)}
            </button>
          );
        })}
      </div>

      {/* 커스텀 달력 — 시작일·종료일 + 적용. 커스텀 적용 중이면 강조 보더 */}
      <div
        className={`flex items-center gap-2 flex-wrap rounded-lg p-1.5 border ${
          isCustom
            ? "border-admin-primary/60 bg-admin-primary/5"
            : "border-slate-800 bg-slate-900/40"
        }`}
      >
        <label className="flex items-center gap-1.5 text-[11px] text-slate-400">
          <span>{t("dateFilter.from")}</span>
          <DateField
            aria-label={t("dateFilter.from")}
            value={from}
            max={to || undefined}
            onChange={(e) => setFrom(e.target.value)}
            placeholder={t("dateFilter.datePlaceholder")}
            wrapperClassName=""
            className={inputClass}
          />
        </label>
        <span className="text-slate-600">~</span>
        <label className="flex items-center gap-1.5 text-[11px] text-slate-400">
          <span>{t("dateFilter.to")}</span>
          <DateField
            aria-label={t("dateFilter.to")}
            value={to}
            min={from || undefined}
            onChange={(e) => setTo(e.target.value)}
            placeholder={t("dateFilter.datePlaceholder")}
            wrapperClassName=""
            className={inputClass}
          />
        </label>
        <button
          type="button"
          onClick={applyCustom}
          disabled={invalidRange || unchanged || !from || !to}
          className="px-3 py-1.5 text-xs font-bold rounded-lg bg-admin-primary text-white whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
        >
          {t("dateFilter.apply")}
        </button>
        {invalidRange && (
          <span className="text-[11px] text-red-400">{t("dateFilter.invalidRange")}</span>
        )}
      </div>
    </div>
  );
}
