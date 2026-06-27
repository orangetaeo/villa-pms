// /api/revenue/export — 매출관리 거래 목록 CSV 내보내기 (운영자 ADMIN 전용, read-only)
//
// GET: /revenue 페이지와 동일한 필터 쿼리(range|from|to, types, channel, villaId, partnerId,
//      currency, all)를 수용해 통합 매출 거래를 CSV로 반환한다.
//
// ★ 누수 차단(원칙2 마진 비공개): isOperator + canViewFinance 검사. STAFF(canViewFinance=false)는
//   매출·원가·마진이 든 이 CSV 접근 자체를 403 차단. 권한 통과 후에만 loadRevenueTxns 호출.
// money: VND는 BigInt → CSV에 동 단위 정수 그대로(정밀도 손실 없음), KRW는 Int.
import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import type { ServiceType } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canViewFinance, isOperator } from "@/lib/permissions";
import { loadRevenueTxns, type RevenueTxnType } from "@/lib/revenue-ledger";
import { FX_VND_PER_KRW_KEY } from "@/lib/pricing";
import { resolveStatsPeriod, loadDataFloor } from "@/lib/statistics";

export const runtime = "nodejs";

const TXN_TYPES: RevenueTxnType[] = ["ROOM", "MINIBAR", "SERVICE"];

/** CSV 셀 이스케이프 — 쉼표·따옴표·개행 포함 시 큰따옴표 감싸고 내부 따옴표 이중화. */
function csvCell(value: string | number | null): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function GET(req: Request) {
  // 운영자 + 재무 게이트 — STAFF는 매출 CSV 차단.
  const session = await auth();
  if (!session?.user?.id || !isOperator(session.user.role)) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (!canViewFinance(session.user.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const url = new URL(req.url);
  const sp = url.searchParams;

  // 기간 — 페이지와 동일 규약.
  const range = sp.get("range") ?? undefined;
  const dataFloor = range === "all" ? await loadDataFloor() : null;
  const period = resolveStatsPeriod(
    { range, from: sp.get("from") ?? undefined, to: sp.get("to") ?? undefined },
    new Date(),
    dataFloor
  );

  // 필터 파싱 — 화이트리스트.
  const typesRaw = sp.get("types");
  const types = typesRaw
    ? typesRaw.split(",").filter((x): x is RevenueTxnType => TXN_TYPES.includes(x as RevenueTxnType))
    : undefined;
  const channelRaw = sp.get("channel") ?? "";
  const channel = ["TRAVEL_AGENCY", "LAND_AGENCY", "DIRECT"].includes(channelRaw)
    ? (channelRaw as "TRAVEL_AGENCY" | "LAND_AGENCY" | "DIRECT")
    : undefined;
  const currencyRaw = sp.get("currency") ?? "";
  const currency = ["KRW", "VND", "USD"].includes(currencyRaw) ? (currencyRaw as "KRW" | "VND" | "USD") : undefined;
  const includeAllStatuses = sp.get("all") === "1";

  const tSvc = await getTranslations("adminStatistics");
  const t = await getTranslations("revenue");
  const serviceLabeler = (type: ServiceType) => tSvc(`services.types.${type}`);

  // 현재 판매가 환율(폴백) — KRW 매출 환산용. 페이지와 동일.
  const fxRow = await prisma.appSetting.findUnique({ where: { key: FX_VND_PER_KRW_KEY } });
  const fallbackFxVndPerKrw = fxRow?.value ?? null;

  const { txns, totals } = await loadRevenueTxns(
    prisma,
    {
      from: period.from,
      to: period.to,
      types,
      channel,
      villaId: sp.get("villaId") || undefined,
      partnerId: sp.get("partnerId") || undefined,
      currency,
      includeAllStatuses,
    },
    serviceLabeler,
    fallbackFxVndPerKrw
  );

  // CSV 헤더 — 운영자 화면 라벨 재사용(컬럼명 i18n). 원본 통화(KRW·VND·USD) + 통합 환산(≈VND).
  const header = [
    t("cols.date"),
    t("cols.type"),
    t("cols.villa"),
    t("csv.channel"),
    t("csv.partner"),
    t("cols.label"),
    t("cols.saleKrw"),
    t("cols.saleVnd"),
    t("cols.saleUsd"),
    t("cols.saleVndEquivalent"),
    t("cols.costVnd"),
    t("cols.marginVnd"),
  ];

  const lines: string[] = [header.map(csvCell).join(",")];
  for (const x of txns) {
    lines.push(
      [
        csvCell(x.date),
        csvCell(t(`types.${x.type}`)),
        csvCell(x.villaName),
        csvCell(x.channel ? t(`channels.${x.channel}`) : ""),
        csvCell(x.partnerName),
        csvCell(x.label),
        csvCell(x.saleKrw), // Int — 정수 그대로
        csvCell(x.saleVnd === null ? "" : x.saleVnd.toString()), // BigInt — 동 단위 정수
        csvCell(x.saleUsd), // Int(정수 달러) — Phase 1엔 비어있음
        csvCell(x.saleVndEquivalent === null ? "" : x.saleVndEquivalent.toString()), // 환산(≈VND)
        csvCell(x.costVnd === null ? "" : x.costVnd.toString()),
        csvCell(x.marginVnd === null ? "" : x.marginVnd.toString()),
      ].join(",")
    );
  }
  // 합계 행 — 원본 통화 분리(KRW·VND·USD) + 통합 환산(≈VND), 환산 후 마진.
  lines.push(
    [
      csvCell(t("totals.csvLabel")),
      "",
      "",
      "",
      "",
      "",
      csvCell(totals.saleKrw),
      csvCell(totals.saleVnd.toString()),
      csvCell(totals.saleUsd),
      csvCell(totals.integratedRevenueVnd.toString()),
      csvCell(totals.costVnd.toString()),
      csvCell(totals.marginVnd.toString()),
    ].join(",")
  );

  // UTF-8 BOM — Excel이 한글·₫를 올바로 인식하도록.
  const body = "﻿" + lines.join("\r\n");
  const filename = `revenue_${period.fromText}_${period.toText}.csv`;

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
