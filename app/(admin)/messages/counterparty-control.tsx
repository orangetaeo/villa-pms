"use client";

// 상대 분류 컨트롤 (b15 블록④ / ADR-0009 D1) — ADMIN 수동 선택만, 자동 매칭 아님
// - ClassifyBanner: 미분류(UNKNOWN) 대화 상단 인라인 배너 (공급자/고객 2버튼). 분류 전 공유 잠금 해소.
// - CounterpartyDropdown: 분류 완료 후 헤더 재변경 드롭다운 (공급자/고객/미분류 + 체크).
// 둘 다 PATCH SET_COUNTERPARTY_TYPE → router.refresh. 분류는 타입만 — 마진·누수 무관.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { CounterpartyType } from "./chat-pane";
// perf #2: 분류 변경 후 갱신 — MessagesClient 하위면 스레드 재fetch(서버 왕복 없음), 레거시면 router.refresh.
import { useMutationRefresh } from "./chat-pane";

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

// 분류 6종 (ADR-0009 개정2 + IGNORED) — 공급자(원가측)·고객/여행사/랜드사(판매가측)·개인기타·미분류
const OPTIONS: { type: CounterpartyType; icon: string; iconColor: string; labelKey: string }[] = [
  { type: "SUPPLIER", icon: "store", iconColor: "text-teal-400", labelKey: "classify.supplier" },
  { type: "CUSTOMER", icon: "person", iconColor: "text-indigo-300", labelKey: "classify.customer" },
  { type: "TRAVEL_AGENCY", icon: "flight", iconColor: "text-violet-300", labelKey: "classify.travelAgency" },
  { type: "LAND_AGENCY", icon: "directions_car", iconColor: "text-blue-300", labelKey: "classify.landAgency" },
  { type: "IGNORED", icon: "block", iconColor: "text-slate-400", labelKey: "classify.ignored" },
  { type: "UNKNOWN", icon: "help", iconColor: "text-slate-500", labelKey: "classify.unknown" },
];

// 분류 배너 버튼 4종(업무) + 개인기타 — 색상 토큰 포함. UNKNOWN은 배너에 없음(현재 상태이므로).
const BANNER_BTNS: { type: CounterpartyType; icon: string; cls: string; labelKey: string }[] = [
  { type: "SUPPLIER", icon: "store", labelKey: "classify.supplier", cls: "bg-teal-500/15 border-teal-500/40 text-teal-300 hover:bg-teal-500/25" },
  { type: "CUSTOMER", icon: "person", labelKey: "classify.customer", cls: "bg-indigo-500/15 border-indigo-500/40 text-indigo-300 hover:bg-indigo-500/25" },
  { type: "TRAVEL_AGENCY", icon: "flight", labelKey: "classify.travelAgency", cls: "bg-violet-500/15 border-violet-500/40 text-violet-300 hover:bg-violet-500/25" },
  { type: "LAND_AGENCY", icon: "directions_car", labelKey: "classify.landAgency", cls: "bg-blue-500/15 border-blue-500/40 text-blue-300 hover:bg-blue-500/25" },
  { type: "IGNORED", icon: "block", labelKey: "classify.ignored", cls: "bg-slate-600/20 border-slate-500/40 text-slate-300 hover:bg-slate-600/30" },
];

/**
 * 미분류(UNKNOWN) 대화 상단 배너 — 분류 6종 중 업무 4종 + 개인/기타 버튼.
 * - 데스크톱(lg:): 기존 풀 박스(제목·안내·버튼 줄). 공간 충분 → 상시 노출.
 * - 모바일(<lg): 슬림 한 줄 스트립("분류하기 ▾" + "✕"). 탭하면 버튼 펼침, ✕로 그 대화에서 접음.
 *   접기는 sessionStorage(대화별) — "지금은 말고". 헤더 '미분류 ▾' 칩이 상시 분류 경로로 남음.
 *   ※ 개인/기타(IGNORED)로 한 번 분류하면 종착 상태라 배너가 영구 미노출(되돌리기는 헤더 드롭다운).
 */
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
  const [expanded, setExpanded] = useState(false); // 모바일 버튼 줄 펼침
  const [dismissed, setDismissed] = useState(false); // 모바일 접기(세션, 대화별)
  const refresh = useMutationRefresh(router); // perf #2

  const dismissKey = `vp-classify-dismiss-${conversationId}`;

  // 대화 전환 시 펼침 초기화 + 이 대화의 접기 상태 복원(세션).
  useEffect(() => {
    setExpanded(false);
    try {
      setDismissed(sessionStorage.getItem(dismissKey) === "1");
    } catch {
      setDismissed(false);
    }
  }, [dismissKey]);

  function dismiss() {
    setDismissed(true);
    try {
      sessionStorage.setItem(dismissKey, "1");
    } catch {
      /* noop — 세션 저장 불가 시 이 렌더에서만 접힘 */
    }
  }

  async function classify(next: CounterpartyType) {
    if (saving) return;
    setSaving(true);
    const ok = await patchType(conversationId, next);
    setSaving(false);
    if (ok) refresh(); // 분류되면 UNKNOWN 아님 → 배너 자체가 사라짐
  }

  // 공통 버튼 줄 — 데스크톱·모바일 펼침에서 재사용.
  const buttonRow = (
    <div className="flex items-center gap-2 flex-wrap">
      {BANNER_BTNS.map((b) => (
        <button
          key={b.type}
          type="button"
          onClick={() => classify(b.type)}
          disabled={saving}
          title={b.type === "IGNORED" ? t("classify.ignoredHint") : undefined}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-bold disabled:opacity-50 transition-colors ${b.cls}`}
        >
          <span className="material-symbols-outlined text-[16px]">{b.icon}</span>
          {t(b.labelKey)}
        </button>
      ))}
    </div>
  );

  return (
    <>
      {/* 데스크톱: 풀 박스 (PC는 공간 충분 — 접기 없음) */}
      <div className="hidden lg:block bg-slate-900 border border-amber-500/30 rounded-xl p-4">
        <div className="flex items-start gap-3">
          <span className="material-symbols-outlined text-amber-400">help</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-white">{t("classify.bannerTitle")}</p>
            <p className="text-[11px] text-slate-400 mt-1">{t("classify.bannerHint")}</p>
            <div className="mt-3">{buttonRow}</div>
          </div>
        </div>
      </div>

      {/* 모바일: 슬림 스트립 — 접지 않았을 때만. 한 줄(제목 truncate + 분류하기 + ✕), 펼치면 버튼 줄 */}
      {!dismissed && (
        <div className="lg:hidden bg-slate-900 border border-amber-500/30 rounded-xl px-3 py-2.5">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-amber-400 text-[18px] shrink-0">help</span>
            <span className="flex-1 min-w-0 truncate text-[12px] font-medium text-slate-200">
              {t("classify.bannerTitle")}
            </span>
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="flex items-center gap-0.5 shrink-0 px-2 py-1 rounded-md bg-amber-500/15 border border-amber-500/40 text-amber-300 text-[11px] font-bold transition-colors"
            >
              {t("classify.expand")}
              <span className="material-symbols-outlined text-[15px]">
                {expanded ? "expand_less" : "expand_more"}
              </span>
            </button>
            <button
              type="button"
              onClick={dismiss}
              title={t("classify.dismiss")}
              aria-label={t("classify.dismiss")}
              className="shrink-0 w-7 h-7 rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-800 flex items-center justify-center transition-colors"
            >
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          </div>
          {expanded && <div className="mt-2.5">{buttonRow}</div>}
        </div>
      )}
    </>
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
  const refresh = useMutationRefresh(router); // perf #2

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
      refresh();
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
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full mt-1.5 w-44 bg-slate-800 border border-slate-700 rounded-lg shadow-2xl py-1.5 z-50">
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
