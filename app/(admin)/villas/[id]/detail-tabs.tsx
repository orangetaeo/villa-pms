"use client";

// 빌라 상세 탭 전환 (b10-sales 탭 구조) — "상세"(기존 사진·기본·요율·비품) ↔ "판매정보"(신규 폼)
// RSC가 렌더한 두 자식을 받아 클라이언트에서 탭만 토글 (서버 데이터 재요청 없음).
// "모두 펼치기/접기" — 현재 탭 패널의 모든 <details> 섹션을 일괄 토글(네이티브 open 속성 직접 제어).
import { useRef, useState } from "react";
import { useTranslations } from "next-intl";

export default function DetailTabs({
  overview,
  sales,
}: {
  overview: React.ReactNode;
  sales: React.ReactNode;
}) {
  const t = useTranslations("adminVillas.sales");
  const [tab, setTab] = useState<"overview" | "sales">("overview");
  const [allOpen, setAllOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const toggleAll = () => {
    const next = !allOpen;
    panelRef.current
      ?.querySelectorAll<HTMLDetailsElement>("details")
      .forEach((d) => {
        d.open = next;
      });
    setAllOpen(next);
  };

  // 탭 전환 시 새 패널은 기본 접힘 상태로 마운트되므로 버튼 라벨도 초기화
  const switchTab = (next: "overview" | "sales") => {
    setTab(next);
    setAllOpen(false);
  };

  return (
    <>
      <div className="flex items-center justify-between gap-3 border-b border-slate-800 mb-8">
        <div className="flex items-center gap-1" role="tablist">
          {/* 코치마크 앵커 — 탭 콘텐츠는 전환 시 언마운트라 항상 보이는 탭 버튼만 앵커(T-7) */}
          <TabButton
            active={tab === "overview"}
            onClick={() => switchTab("overview")}
            dataTour="vdetail-tab-overview"
          >
            {t("tabs.overview")}
          </TabButton>
          <TabButton
            active={tab === "sales"}
            onClick={() => switchTab("sales")}
            dataTour="vdetail-tab-sales"
          >
            {t("tabs.sales")}
          </TabButton>
        </div>
        <button
          type="button"
          data-tour="vdetail-expand"
          onClick={toggleAll}
          className="flex items-center gap-1.5 px-3 py-2 mb-1 rounded-lg text-xs font-bold text-slate-400 hover:text-white hover:bg-slate-800/60 transition-colors whitespace-nowrap"
        >
          <span className="material-symbols-outlined text-base">
            {allOpen ? "unfold_less" : "unfold_more"}
          </span>
          {allOpen ? t("collapseAll") : t("expandAll")}
        </button>
      </div>
      <div role="tabpanel" ref={panelRef}>
        {tab === "overview" ? overview : sales}
      </div>
    </>
  );
}

function TabButton({
  active,
  onClick,
  children,
  dataTour,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  /** 코치마크 앵커 id — 투어 스텝 대상 탭에만 전달. */
  dataTour?: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      data-tour={dataTour}
      onClick={onClick}
      className={`px-4 py-3 text-sm whitespace-nowrap border-b-2 transition-colors ${
        active
          ? "font-bold text-admin-primary border-admin-primary"
          : "font-medium text-slate-400 hover:text-slate-200 border-transparent"
      }`}
    >
      {children}
    </button>
  );
}
