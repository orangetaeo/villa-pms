"use client";

// /villas 검색·필터 컨트롤 (T-admin-villa-search → T-villa-search-expansion 확장)
// 상단줄(상시): 텍스트 검색(빌라명·베트남명·단지·주소·공급자) + 공급자 + 지역 + 체크인/아웃 날짜 + 상세필터 토글.
// 접이식 상세 패널: 침실·인원 이상, 수영장·조식·판매가능만, 침대종류, 해변거리, 셀링포인트 태그(검색형 멀티셀렉트).
// 상태 탭은 page.tsx가 별도 관리하므로 status는 보존한다(apply는 지정한 키만 patch).
import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { DateField } from "@/components/date-field";
import { BED_TYPES } from "@/lib/bedding";
import { FEATURE_CATEGORIES, FEATURE_ITEMS } from "@/lib/features";

interface SupplierOption {
  id: string;
  name: string;
  count: number;
  deleted: boolean;
}

// 상세 패널 필터 키 — 초기화·활성개수 산정 대상 (날짜 ci/co·q·area·supplier·status 제외)
const DETAIL_KEYS = [
  "minBedrooms",
  "minGuests",
  "pool",
  "breakfast",
  "sellable",
  "bedType",
  "beach",
  "tags",
] as const;

const BEDROOM_OPTIONS = [1, 2, 3, 4, 5];
const GUEST_OPTIONS = [2, 4, 6, 8, 10, 12];
const BEACH_PRESETS = [100, 300, 500, 1000];

const DATE_BOX =
  "bg-admin-card border border-admin-border text-sm text-slate-300 rounded-lg px-2.5 py-1.5 [color-scheme:dark] focus:ring-1 focus:ring-admin-primary focus:border-admin-primary";
const SELECT_BOX =
  "cursor-pointer rounded-lg border border-admin-border bg-admin-card px-2.5 py-1.5 text-sm text-slate-300 focus:outline-none focus:ring-1 focus:ring-admin-primary";

export default function VillasFilters({
  areas,
  suppliers,
}: {
  areas: string[];
  suppliers: SupplierOption[];
}) {
  const t = useTranslations("adminVillas.list");
  const tFeat = useTranslations("features");
  const tBed = useTranslations("bedding");
  const router = useRouter();
  const searchParams = useSearchParams();

  const apply = (patch: Record<string, string>) => {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    next.delete("page"); // 필터 변경 시 1페이지로
    router.replace(`/villas?${next.toString()}`);
  };

  const area = searchParams.get("area") ?? "";
  const q = searchParams.get("q") ?? "";
  const supplier = searchParams.get("supplier") ?? "";
  const ci = searchParams.get("ci") ?? "";
  const co = searchParams.get("co") ?? "";
  const minBedrooms = searchParams.get("minBedrooms") ?? "";
  const minGuests = searchParams.get("minGuests") ?? "";
  const pool = searchParams.get("pool") === "1";
  const breakfast = searchParams.get("breakfast") === "1";
  const sellable = searchParams.get("sellable") === "1";
  const bedType = searchParams.get("bedType") ?? "";
  const beach = searchParams.get("beach") ?? "";
  const selectedTags = useMemo(
    () => (searchParams.get("tags")?.split(",").map((s) => s.trim()).filter(Boolean)) ?? [],
    [searchParams]
  );

  // 상세 패널 활성 개수 (pill·기본 open 판정). 태그는 개수만큼 카운트.
  const detailCount =
    (minBedrooms ? 1 : 0) +
    (minGuests ? 1 : 0) +
    (pool ? 1 : 0) +
    (breakfast ? 1 : 0) +
    (sellable ? 1 : 0) +
    (bedType ? 1 : 0) +
    (beach ? 1 : 0) +
    selectedTags.length;

  // 활성 상세 필터가 있으면 기본 열림. router.replace 재렌더에 닫히지 않도록 로컬 state(파생 아님).
  const [open, setOpen] = useState(() => detailCount > 0);
  const [tagSearch, setTagSearch] = useState("");

  const hasTopFilter = Boolean(area || q || supplier || ci || co);

  const toggleTag = (key: string) => {
    const nextTags = selectedTags.includes(key)
      ? selectedTags.filter((k) => k !== key)
      : [...selectedTags, key];
    apply({ tags: nextTags.join(",") });
  };

  const resetDetail = () => {
    const patch: Record<string, string> = {};
    for (const k of DETAIL_KEYS) patch[k] = "";
    apply(patch);
  };

  // 태그 검색 필터링 — 라벨(현재 로케일) 또는 키 부분일치
  const tagQuery = tagSearch.trim().toLowerCase();
  const filteredCategories = FEATURE_CATEGORIES.map((cat) => ({
    cat,
    items: FEATURE_ITEMS[cat].filter((it) => {
      if (!tagQuery) return true;
      const label = tFeat(`items.${it.featureKey}`).toLowerCase();
      return label.includes(tagQuery) || it.featureKey.toLowerCase().includes(tagQuery);
    }),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="flex flex-col gap-3">
      {/* 상단줄 — 상시 노출 */}
      <div className="flex flex-wrap items-center gap-3">
        {/* 검색 */}
        <div className="relative">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">
            search
          </span>
          <input
            className="w-64 bg-admin-card border border-admin-border text-sm text-slate-300 rounded-lg pl-9 pr-4 py-2 focus:ring-1 focus:ring-admin-primary focus:border-admin-primary transition-all"
            placeholder={t("searchPlaceholder")}
            type="text"
            defaultValue={q}
            onKeyDown={(e) => {
              if (e.key === "Enter") apply({ q: e.currentTarget.value.trim() });
            }}
          />
        </div>
        {/* 공급자 — 이름+빌라 수 드롭다운 (베트남 이름 타이핑 회피). 삭제된 공급자는 표시 */}
        {suppliers.length > 0 && (
          <div className="flex items-center gap-2 bg-admin-card border border-admin-border rounded-lg px-3 py-2 whitespace-nowrap">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              {t("filters.supplier")}
            </span>
            <select
              aria-label={t("filters.supplier")}
              className="cursor-pointer border-none bg-transparent p-0 pr-6 text-sm text-slate-300 focus:ring-0 max-w-[200px]"
              value={supplier}
              onChange={(e) => apply({ supplier: e.target.value })}
            >
              <option value="" className="bg-slate-900">
                {t("filters.allSuppliers")}
              </option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id} className="bg-slate-900">
                  {s.name} ({s.count}){s.deleted ? ` · ${t("supplierDeleted")}` : ""}
                </option>
              ))}
            </select>
          </div>
        )}
        {/* 지역(단지) */}
        {areas.length > 0 && (
          <div className="flex items-center gap-2 bg-admin-card border border-admin-border rounded-lg px-3 py-2 whitespace-nowrap">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              {t("filters.area")}
            </span>
            <select
              aria-label={t("filters.area")}
              className="cursor-pointer border-none bg-transparent p-0 pr-6 text-sm text-slate-300 focus:ring-0"
              value={area}
              onChange={(e) => apply({ area: e.target.value })}
            >
              <option value="" className="bg-slate-900">
                {t("filters.allAreas")}
              </option>
              {areas.map((a) => (
                <option key={a} value={a} className="bg-slate-900">
                  {a}
                </option>
              ))}
            </select>
          </div>
        )}
        {/* 날짜별 공실 — 체크인·체크아웃 (상시 노출, 패널 밖) */}
        <div className="flex items-center gap-2 whitespace-nowrap">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
            {t("filters.vacancy")}
          </span>
          <DateField
            value={ci}
            max={co || undefined}
            onChange={(e) => apply({ ci: e.target.value })}
            aria-label={t("filters.checkIn")}
            placeholder={t("filters.checkIn")}
            className={DATE_BOX}
          />
          <span className="text-admin-muted text-xs">~</span>
          <DateField
            value={co}
            min={ci || undefined}
            onChange={(e) => apply({ co: e.target.value })}
            aria-label={t("filters.checkOut")}
            placeholder={t("filters.checkOut")}
            className={DATE_BOX}
          />
        </div>
        {/* 상세 필터 토글 — 활성 개수 pill */}
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors whitespace-nowrap ${
            open || detailCount > 0
              ? "border-admin-primary text-admin-primary"
              : "border-admin-border text-slate-300 hover:text-white"
          }`}
        >
          <span className="material-symbols-outlined text-sm">tune</span>
          {t("filters.detailToggle")}
          {detailCount > 0 && (
            <span className="ml-0.5 rounded bg-admin-primary px-1.5 py-0.5 text-[10px] font-bold text-white tabular-nums">
              {detailCount}
            </span>
          )}
        </button>
        {/* 상단줄 초기화 (검색·지역·공급자·날짜) — status 탭·상세 필터는 유지 */}
        {hasTopFilter && (
          <button
            type="button"
            className="flex items-center gap-1.5 text-slate-400 hover:text-white transition-colors text-sm px-2 whitespace-nowrap"
            onClick={() => apply({ q: "", area: "", supplier: "", ci: "", co: "" })}
          >
            <span className="material-symbols-outlined text-sm">refresh</span>
            {t("filters.reset")}
          </button>
        )}
      </div>

      {/* 접이식 상세 패널 */}
      {open && (
        <div className="bg-admin-card border border-admin-border rounded-xl p-4 flex flex-col gap-4">
          {/* 셀렉트·토글 줄 */}
          <div className="flex flex-wrap items-center gap-3">
            {/* 침실 이상 */}
            <label className="flex items-center gap-2 text-sm text-slate-400">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                {t("filters.minBedrooms")}
              </span>
              <select
                aria-label={t("filters.minBedrooms")}
                className={SELECT_BOX}
                value={minBedrooms}
                onChange={(e) => apply({ minBedrooms: e.target.value })}
              >
                <option value="" className="bg-slate-900">
                  {t("filters.any")}
                </option>
                {BEDROOM_OPTIONS.map((n) => (
                  <option key={n} value={String(n)} className="bg-slate-900">
                    {t("filters.bedroomsOption", { n })}
                  </option>
                ))}
              </select>
            </label>
            {/* 인원 이상 */}
            <label className="flex items-center gap-2 text-sm text-slate-400">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                {t("filters.minGuests")}
              </span>
              <select
                aria-label={t("filters.minGuests")}
                className={SELECT_BOX}
                value={minGuests}
                onChange={(e) => apply({ minGuests: e.target.value })}
              >
                <option value="" className="bg-slate-900">
                  {t("filters.any")}
                </option>
                {GUEST_OPTIONS.map((n) => (
                  <option key={n} value={String(n)} className="bg-slate-900">
                    {t("filters.guestsOption", { n })}
                  </option>
                ))}
              </select>
            </label>
            {/* 침대 종류 */}
            <label className="flex items-center gap-2 text-sm text-slate-400">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                {t("filters.bedType")}
              </span>
              <select
                aria-label={t("filters.bedType")}
                className={SELECT_BOX}
                value={bedType}
                onChange={(e) => apply({ bedType: e.target.value })}
              >
                <option value="" className="bg-slate-900">
                  {t("filters.any")}
                </option>
                {BED_TYPES.map((b) => (
                  <option key={b} value={b} className="bg-slate-900">
                    {tBed(b)}
                  </option>
                ))}
              </select>
            </label>
            {/* 해변거리 이내 */}
            <label className="flex items-center gap-2 text-sm text-slate-400">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                {t("filters.beach")}
              </span>
              <select
                aria-label={t("filters.beach")}
                className={SELECT_BOX}
                value={beach}
                onChange={(e) => apply({ beach: e.target.value })}
              >
                <option value="" className="bg-slate-900">
                  {t("filters.any")}
                </option>
                {BEACH_PRESETS.map((m) => (
                  <option key={m} value={String(m)} className="bg-slate-900">
                    {t("filters.beachOption", { m })}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {/* 불리언 토글 (수영장·조식·판매가능만) */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              aria-pressed={pool}
              onClick={() => apply({ pool: pool ? "" : "1" })}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                pool
                  ? "border-admin-primary bg-admin-primary/10 text-admin-primary"
                  : "border-admin-border text-slate-400 hover:text-white"
              }`}
            >
              <span className="material-symbols-outlined text-[16px]">pool</span>
              {t("filters.pool")}
            </button>
            <button
              type="button"
              aria-pressed={breakfast}
              onClick={() => apply({ breakfast: breakfast ? "" : "1" })}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                breakfast
                  ? "border-admin-primary bg-admin-primary/10 text-admin-primary"
                  : "border-admin-border text-slate-400 hover:text-white"
              }`}
            >
              <span className="material-symbols-outlined text-[16px]">restaurant</span>
              {t("filters.breakfast")}
            </button>
            <button
              type="button"
              aria-pressed={sellable}
              onClick={() => apply({ sellable: sellable ? "" : "1" })}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                sellable
                  ? "border-admin-primary bg-admin-primary/10 text-admin-primary"
                  : "border-admin-border text-slate-400 hover:text-white"
              }`}
            >
              <span className="material-symbols-outlined text-[16px]">verified</span>
              {t("filters.sellableOnly")}
            </button>
          </div>

          {/* 셀링포인트 태그 — 검색형 멀티셀렉트 */}
          <div className="flex flex-col gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              {t("filters.tags")}
            </span>
            {/* 선택 칩 */}
            {selectedTags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {selectedTags.map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => toggleTag(k)}
                    className="inline-flex items-center gap-1 rounded-full bg-admin-primary/15 px-2.5 py-1 text-xs font-medium text-admin-primary"
                  >
                    {tFeat(`items.${k}`)}
                    <span className="material-symbols-outlined text-[14px]">close</span>
                  </button>
                ))}
              </div>
            )}
            {/* 태그 검색 */}
            <input
              type="text"
              value={tagSearch}
              onChange={(e) => setTagSearch(e.target.value)}
              placeholder={t("filters.tagsPlaceholder")}
              className="w-full max-w-xs bg-admin-bg border border-admin-border text-sm text-slate-300 rounded-lg px-3 py-1.5 focus:ring-1 focus:ring-admin-primary focus:border-admin-primary"
            />
            {/* 카테고리 그룹 목록 */}
            <div className="max-h-56 overflow-y-auto rounded-lg border border-admin-border p-2 flex flex-col gap-2">
              {filteredCategories.length === 0 ? (
                <p className="px-1 py-2 text-xs text-admin-muted">{t("emptyFiltered")}</p>
              ) : (
                filteredCategories.map(({ cat, items }) => (
                  <div key={cat} className="flex flex-col gap-1">
                    <span className="px-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                      {tFeat(`categories.${cat}`)}
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {items.map((it) => {
                        const on = selectedTags.includes(it.featureKey);
                        return (
                          <button
                            key={it.featureKey}
                            type="button"
                            aria-pressed={on}
                            onClick={() => toggleTag(it.featureKey)}
                            className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
                              on
                                ? "border-admin-primary bg-admin-primary/10 text-admin-primary"
                                : "border-admin-border text-slate-400 hover:text-white"
                            }`}
                          >
                            <span className="material-symbols-outlined text-[14px]">{it.icon}</span>
                            {tFeat(`items.${it.featureKey}`)}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* 상세 필터 초기화 (상태 탭·q·날짜 보존) */}
          {detailCount > 0 && (
            <div>
              <button
                type="button"
                className="flex items-center gap-1.5 text-slate-400 hover:text-white transition-colors text-sm"
                onClick={resetDetail}
              >
                <span className="material-symbols-outlined text-sm">refresh</span>
                {t("filters.resetDetail")}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
