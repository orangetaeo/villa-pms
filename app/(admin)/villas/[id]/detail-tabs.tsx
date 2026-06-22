"use client";

// 빌라 상세 탭 전환 (b10-sales 탭 구조) — "상세"(기존 사진·기본·요율·비품) ↔ "판매정보"(신규 폼)
// RSC가 렌더한 두 자식을 받아 클라이언트에서 탭만 토글 (서버 데이터 재요청 없음).
import { useState } from "react";
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

  return (
    <>
      <div className="flex items-center gap-1 border-b border-slate-800 mb-8" role="tablist">
        <TabButton active={tab === "overview"} onClick={() => setTab("overview")}>
          {t("tabs.overview")}
        </TabButton>
        <TabButton active={tab === "sales"} onClick={() => setTab("sales")}>
          {t("tabs.sales")}
        </TabButton>
      </div>
      <div role="tabpanel">{tab === "overview" ? overview : sales}</div>
    </>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
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
