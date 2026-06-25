"use client";

// /villas 검색·필터 컨트롤 (T-admin-villa-search)
// 지역(단지명 complex) 드롭다운 + 텍스트 검색(빌라명·단지·주소·공급자) — 변경 즉시 searchParams 반영.
// 공실 보드(availability)의 지역 필터 패턴 준용. 상태 탭은 page.tsx가 별도 관리하므로 status는 보존.
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

interface SupplierOption {
  id: string;
  name: string;
  count: number;
  deleted: boolean;
}

export default function VillasFilters({
  areas,
  suppliers,
}: {
  areas: string[];
  suppliers: SupplierOption[];
}) {
  const t = useTranslations("adminVillas.list");
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
  const hasFilter = Boolean(area || q || supplier);

  return (
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
      {/* 초기화 — 검색·지역이 있을 때만 노출 (status 탭은 유지) */}
      {hasFilter && (
        <button
          type="button"
          className="flex items-center gap-1.5 text-slate-400 hover:text-white transition-colors text-sm px-2 whitespace-nowrap"
          onClick={() => apply({ q: "", area: "", supplier: "" })}
        >
          <span className="material-symbols-outlined text-sm">refresh</span>
          {t("filters.reset")}
        </button>
      )}
    </div>
  );
}
