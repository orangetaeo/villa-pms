"use client";

// ADMIN 날짜 빠른 필터 바 (T-admin-quick-date-filter)
// design/stitch/quick-date-filter/index.html 변환. searchParams `?range=` 동기화.
// - presets: 노출할 버튼 순서(기본 전체 8종). 과거형 목록은 nextMonth 제외, 정산은 월 단위만.
// - paramKey: URL 쿼리 키(기본 "range"). 한 화면에 두 개 쓰면 분리.
// - defaultKey: 쿼리 미지정 시 강조할 키(기본 "all").
// - clearKeys: 범위 선택 시 함께 제거할 상충 쿼리 키(기본 없음). 예) /bookings 의 from/to/dateBasis.
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { QUICK_RANGE_KEYS, type QuickRangeKey } from "@/lib/date-vn";

export default function QuickDateFilter({
  presets = QUICK_RANGE_KEYS as readonly QuickRangeKey[] as QuickRangeKey[],
  paramKey = "range",
  defaultKey = "all",
  clearKeys,
}: {
  presets?: QuickRangeKey[];
  paramKey?: string;
  defaultKey?: QuickRangeKey;
  clearKeys?: string[];
}) {
  const t = useTranslations("quickDateFilter");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const current = (searchParams.get(paramKey) as QuickRangeKey | null) ?? defaultKey;

  const select = (key: QuickRangeKey) => {
    const next = new URLSearchParams(searchParams.toString());
    if (key === "all") next.delete(paramKey);
    else next.set(paramKey, key);
    for (const k of clearKeys ?? []) next.delete(k); // 상충 키 제거(예: from/to/dateBasis)
    next.delete("page"); // 필터 변경 시 1페이지로
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  };

  return (
    <div
      role="group"
      aria-label={t("label")}
      className="flex items-center gap-2 overflow-x-auto pb-1"
    >
      {presets.map((key) => {
        const active = current === key;
        return (
          <button
            key={key}
            type="button"
            aria-pressed={active}
            onClick={() => select(key)}
            className={
              active
                ? "inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-admin-primary px-3.5 py-2 text-sm font-bold text-white shadow-sm"
                : "inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-700 bg-slate-900 px-3.5 py-2 text-sm font-medium text-slate-300 transition-colors hover:text-white"
            }
          >
            {key === "all" && active && (
              <span className="material-symbols-outlined text-[18px]">check_box</span>
            )}
            {t(key)}
          </button>
        );
      })}
    </div>
  );
}
