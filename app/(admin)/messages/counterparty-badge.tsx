"use client";

// 상대 타입 배지 (b14/b15) — 공급자=teal / 고객=indigo / 미분류=slate (ADR-0009 D1)
import { useTranslations } from "next-intl";
import type { CounterpartyType } from "./chat-pane";

const STYLE: Record<CounterpartyType, string> = {
  SUPPLIER: "bg-teal-500/15 text-teal-400",
  CUSTOMER: "bg-indigo-500/15 text-indigo-300",
  UNKNOWN: "bg-slate-700/80 text-slate-400",
};

const LABEL_KEY: Record<CounterpartyType, string> = {
  SUPPLIER: "counterparty.supplier",
  CUSTOMER: "counterparty.customer",
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
