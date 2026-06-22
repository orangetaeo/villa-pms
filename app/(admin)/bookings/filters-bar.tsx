"use client";

// /bookings 필터 컨트롤 (b5 Filters Controls 변환) — 변경 즉시 searchParams 반영
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

interface VillaOption {
  id: string;
  name: string;
}

export default function FiltersBar({
  villas,
  areas,
}: {
  villas: VillaOption[];
  areas: string[];
}) {
  const t = useTranslations("adminBookings");
  const router = useRouter();
  const searchParams = useSearchParams();

  const apply = (patch: Record<string, string>) => {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    next.delete("page"); // 필터 변경 시 1페이지로
    next.delete("filter"); // 프리셋 해제
    router.replace(`/bookings?${next.toString()}`);
  };

  const month = searchParams.get("month") ?? "";
  const area = searchParams.get("area") ?? "";
  const villa = searchParams.get("villa") ?? "";
  const channel = searchParams.get("channel") ?? "";
  const q = searchParams.get("q") ?? "";

  return (
    <div className="p-4 flex flex-wrap items-center gap-4">
      <div className="flex items-center gap-2 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 whitespace-nowrap">
        <span className="material-symbols-outlined text-slate-500 text-sm">
          calendar_today
        </span>
        <input
          aria-label={t("list.filters.month")}
          className="bg-transparent border-none text-sm text-slate-300 p-0 focus:ring-0 cursor-pointer [color-scheme:dark]"
          type="month"
          value={month}
          onChange={(e) => apply({ month: e.target.value })}
        />
      </div>
      {areas.length > 0 && (
        <div className="flex items-center gap-2 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 whitespace-nowrap">
          <span className="text-xs text-slate-500 font-bold uppercase tracking-wider mr-1">
            {t("list.filters.area")}
          </span>
          <select
            aria-label={t("list.filters.area")}
            className="bg-transparent border-none text-sm text-slate-300 p-0 focus:ring-0 cursor-pointer"
            value={area}
            onChange={(e) => apply({ area: e.target.value })}
          >
            <option value="" className="bg-slate-900">
              {t("list.filters.allAreas")}
            </option>
            {areas.map((a) => (
              <option key={a} value={a} className="bg-slate-900">
                {a}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="flex items-center gap-2 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 whitespace-nowrap">
        <span className="text-xs text-slate-500 font-bold uppercase tracking-wider mr-1">
          {t("list.filters.villa")}
        </span>
        <select
          aria-label={t("list.filters.villa")}
          className="bg-transparent border-none text-sm text-slate-300 p-0 focus:ring-0 cursor-pointer"
          value={villa}
          onChange={(e) => apply({ villa: e.target.value })}
        >
          <option value="" className="bg-slate-900">
            {t("list.filters.allVillas")}
          </option>
          {villas.map((v) => (
            <option key={v.id} value={v.id} className="bg-slate-900">
              {v.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-2 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 whitespace-nowrap">
        <span className="text-xs text-slate-500 font-bold uppercase tracking-wider mr-1">
          {t("list.filters.channel")}
        </span>
        <select
          className="bg-transparent border-none text-sm text-slate-300 p-0 focus:ring-0 cursor-pointer"
          value={channel}
          onChange={(e) => apply({ channel: e.target.value })}
        >
          <option value="" className="bg-slate-900">
            {t("list.filters.allChannels")}
          </option>
          <option value="DIRECT" className="bg-slate-900">
            {t("channels.DIRECT")}
          </option>
          <option value="TRAVEL_AGENCY" className="bg-slate-900">
            {t("channels.TRAVEL_AGENCY")}
          </option>
          <option value="LAND_AGENCY" className="bg-slate-900">
            {t("channels.LAND_AGENCY")}
          </option>
        </select>
      </div>
      <div className="relative">
        <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">
          search
        </span>
        <input
          className="bg-slate-900 border border-slate-700 text-sm text-slate-300 rounded-lg pl-9 pr-4 py-2 w-56 focus:ring-1 focus:ring-admin-primary focus:border-admin-primary transition-all"
          placeholder={t("list.searchPlaceholder")}
          type="text"
          defaultValue={q}
          onKeyDown={(e) => {
            if (e.key === "Enter") apply({ q: e.currentTarget.value.trim() });
          }}
        />
      </div>
      <button
        type="button"
        className="ml-auto flex items-center gap-2 text-slate-400 hover:text-white transition-colors text-sm px-2 whitespace-nowrap"
        onClick={() => router.replace("/bookings")}
      >
        <span className="material-symbols-outlined text-sm">refresh</span>
        {t("list.filters.reset")}
      </button>
    </div>
  );
}
