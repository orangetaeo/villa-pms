"use client";

// 상대 분류 컨트롤 (b15 블록④ / ADR-0009 D1) — ADMIN 수동 선택만, 자동 매칭 아님
// - ClassifyBanner: 미분류(UNKNOWN) 대화 상단 인라인 배너 (공급자/고객 2버튼). 분류 전 공유 잠금 해소.
// - CounterpartyDropdown: 분류 완료 후 헤더 재변경 드롭다운 (공급자/고객/미분류 + 체크).
// 둘 다 PATCH SET_COUNTERPARTY_TYPE → router.refresh. 분류는 타입만 — 마진·누수 무관.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { CounterpartyType } from "./chat-pane";

type T = ReturnType<typeof useTranslations>;
type Router = ReturnType<typeof useRouter>;

async function patchType(
  conversationId: string,
  next: CounterpartyType,
): Promise<boolean> {
  try {
    const res = await fetch(`/api/zalo/conversations/${conversationId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "SET_COUNTERPARTY_TYPE", counterpartyType: next }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// 분류 5종 (ADR-0009 개정2) — 공급자(원가측)·고객/여행사/랜드사(판매가측)·미분류
const OPTIONS: { type: CounterpartyType; icon: string; iconColor: string; labelKey: string }[] = [
  { type: "SUPPLIER", icon: "store", iconColor: "text-teal-400", labelKey: "classify.supplier" },
  { type: "CUSTOMER", icon: "person", iconColor: "text-indigo-300", labelKey: "classify.customer" },
  { type: "TRAVEL_AGENCY", icon: "flight", iconColor: "text-violet-300", labelKey: "classify.travelAgency" },
  { type: "LAND_AGENCY", icon: "directions_car", iconColor: "text-blue-300", labelKey: "classify.landAgency" },
  { type: "UNKNOWN", icon: "help", iconColor: "text-slate-500", labelKey: "classify.unknown" },
];

/** 미분류 대화 상단 배너 (b15 블록④ 상단) — 공급자/고객 2버튼. */
export function ClassifyBanner({
  conversationId,
  t,
  router,
}: {
  conversationId: string;
  t: T;
  router: Router;
}) {
  const [saving, setSaving] = useState(false);

  async function classify(next: CounterpartyType) {
    if (saving) return;
    setSaving(true);
    const ok = await patchType(conversationId, next);
    setSaving(false);
    if (ok) router.refresh();
  }

  return (
    <div className="bg-slate-900 border border-amber-500/30 rounded-xl p-4">
      <div className="flex items-start gap-3">
        <span className="material-symbols-outlined text-amber-400">help</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-white">{t("classify.bannerTitle")}</p>
          <p className="text-[11px] text-slate-400 mt-1">{t("classify.bannerHint")}</p>
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            <button
              type="button"
              onClick={() => classify("SUPPLIER")}
              disabled={saving}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-teal-500/15 border border-teal-500/40 text-teal-300 text-xs font-bold hover:bg-teal-500/25 disabled:opacity-50 transition-colors"
            >
              <span className="material-symbols-outlined text-[16px]">store</span>
              {t("classify.supplier")}
            </button>
            <button
              type="button"
              onClick={() => classify("CUSTOMER")}
              disabled={saving}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-500/15 border border-indigo-500/40 text-indigo-300 text-xs font-bold hover:bg-indigo-500/25 disabled:opacity-50 transition-colors"
            >
              <span className="material-symbols-outlined text-[16px]">person</span>
              {t("classify.customer")}
            </button>
            <button
              type="button"
              onClick={() => classify("TRAVEL_AGENCY")}
              disabled={saving}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-violet-500/15 border border-violet-500/40 text-violet-300 text-xs font-bold hover:bg-violet-500/25 disabled:opacity-50 transition-colors"
            >
              <span className="material-symbols-outlined text-[16px]">flight</span>
              {t("classify.travelAgency")}
            </button>
            <button
              type="button"
              onClick={() => classify("LAND_AGENCY")}
              disabled={saving}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-500/15 border border-blue-500/40 text-blue-300 text-xs font-bold hover:bg-blue-500/25 disabled:opacity-50 transition-colors"
            >
              <span className="material-symbols-outlined text-[16px]">directions_car</span>
              {t("classify.landAgency")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** 헤더 분류 재변경 드롭다운 (b15 블록④ 하단) — 현재 타입 표시 + 공급자/고객/미분류 선택. */
export function CounterpartyDropdown({
  conversationId,
  type,
  t,
  router,
}: {
  conversationId: string;
  type: CounterpartyType;
  t: T;
  router: Router;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const current =
    OPTIONS.find((o) => o.type === type) ??
    OPTIONS.find((o) => o.type === "UNKNOWN")!;

  async function select(next: CounterpartyType) {
    if (next === type) {
      setOpen(false);
      return;
    }
    setSaving(true);
    const ok = await patchType(conversationId, next);
    setSaving(false);
    if (ok) {
      setOpen(false);
      router.refresh();
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={saving}
        title={t("classify.change")}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800 border border-slate-700 hover:border-slate-600 text-slate-200 text-[11px] font-medium transition-colors disabled:opacity-50"
      >
        <span className={`material-symbols-outlined text-[15px] ${current.iconColor}`}>
          {current.icon}
        </span>
        <span>{t(current.labelKey)}</span>
        <span className="material-symbols-outlined text-[15px] text-slate-500">expand_more</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full mt-1.5 w-44 bg-slate-800 border border-slate-700 rounded-lg shadow-2xl py-1.5 z-20">
            <p className="px-3 py-1 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
              {t("classify.heading")}
            </p>
            {OPTIONS.map((o) => {
              const active = o.type === type;
              return (
                <button
                  key={o.type}
                  type="button"
                  onClick={() => select(o.type)}
                  className={
                    active
                      ? "w-full flex items-center gap-2 px-3 py-2 text-sm text-white bg-slate-700/40 hover:bg-slate-700/60"
                      : "w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-300 hover:bg-slate-700/60"
                  }
                >
                  <span className={`material-symbols-outlined text-[16px] ${o.iconColor}`}>
                    {o.icon}
                  </span>
                  {t(o.labelKey)}
                  {active && (
                    <span className="material-symbols-outlined text-[16px] text-teal-400 ml-auto">
                      check
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
