"use client";

// 상대 타입 배지 (b14/b15) — ADR-0009 개정2 분류 5종
//  · 공급자(원가측)=teal
//  · 판매가측(고객·여행사·랜드사)=유사 색 계열(indigo/violet/blue)
//  · 미분류=slate
import { useTranslations } from "next-intl";
import type { CounterpartyType } from "./chat-pane";

const STYLE: Record<CounterpartyType, string> = {
  SUPPLIER: "bg-teal-500/15 text-teal-400",
  CUSTOMER: "bg-indigo-500/15 text-indigo-300",
  TRAVEL_AGENCY: "bg-violet-500/15 text-violet-300",
  LAND_AGENCY: "bg-blue-500/15 text-blue-300",
  UNKNOWN: "bg-slate-700/80 text-slate-400",
};

const LABEL_KEY: Record<CounterpartyType, string> = {
  SUPPLIER: "counterparty.supplier",
  CUSTOMER: "counterparty.customer",
  TRAVEL_AGENCY: "counterparty.travelAgency",
  LAND_AGENCY: "counterparty.landAgency",
  UNKNOWN: "counterparty.unknown",
};

export function CounterpartyBadge({
  type,
  t,
  size = "sm",
}: {
  type: CounterpartyType;
  t: ReturnType<typeof useTranslations>;
  size?: "xs" | "sm";
}) {
  const pad = size === "xs" ? "px-1.5 py-0.5 text-[9px]" : "px-2 py-0.5 text-[10px]";
  return (
    <span className={`rounded font-bold shrink-0 ${pad} ${STYLE[type]}`}>{t(LABEL_KEY[type])}</span>
  );
}
