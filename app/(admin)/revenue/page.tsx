// /revenue — 매출관리(건별 매출 거래 목록) 운영자 화면 (read-only)
//
// 객실료(Booking)·미니바(CheckoutMinibarLine)·부가서비스(ServiceOrder)를 건별 거래 행으로
// 통합해 필터·검색·정렬·CSV 내보내기를 제공한다.
//
// ★ 누수 차단(원칙2 마진 비공개): 페이지·API 첫 부분에서 isOperator + canViewFinance 검사.
//   - canViewFinance=false(STAFF)면 매출·원가·마진이 핵심인 페이지이므로 통째 차단(redirect).
//   - 운영자(OWNER/MANAGER)만 데이터 로드. 권한 검사가 끝난 뒤에만 loadRevenueTxns 호출.
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import type { ServiceType } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canViewFinance, isOperator } from "@/lib/permissions";
import { serializeBigInt } from "@/lib/serialize";
import { loadRevenueTxns, type RevenueTxnType } from "@/lib/revenue-ledger";
import { FX_VND_PER_KRW_KEY } from "@/lib/pricing";
import {
  resolveStatsPeriod,
  loadDataFloor,
} from "@/lib/statistics";
import RevenueClient from "./revenue-client";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("revenue");
  return { title: `${t("title")} — Villa Go` };
}

const TXN_TYPES: RevenueTxnType[] = ["ROOM", "MINIBAR", "SERVICE"];

export default async function RevenuePage({
  searchParams,
}: {
  searchParams: Promise<{
    range?: string;
    from?: string;
    to?: string;
    types?: string;
    channel?: string;
    villaId?: string;
    partnerId?: string;
    currency?: string;
    all?: string;
  }>;
}) {
  // 운영자 + 재무 게이트 — STAFF는 매출 화면 통째 차단(마진·판매가·원가가 핵심).
  const session = await auth();
  if (!session?.user?.id || !isOperator(session.user.role)) redirect("/login");
  if (!canViewFinance(session.user.role)) redirect("/dashboard");

  const params = await searchParams;

  // 기간 해석 — 통계와 동일 규약(?range= 프리셋 또는 ?from=&to= 커스텀). 'all'은 데이터 최소일 필요.
  const dataFloor = params.range === "all" ? await loadDataFloor() : null;
  const period = resolveStatsPeriod(
    { range: params.range, from: params.from, to: params.to },
    new Date(),
    dataFloor
  );

  // 필터 파싱 — URL 쿼리에서 안전 화이트리스트.
  const typesParam = params.types
    ? params.types.split(",").filter((x): x is RevenueTxnType => TXN_TYPES.includes(x as RevenueTxnType))
    : undefined;
  const channel = ["TRAVEL_AGENCY", "LAND_AGENCY", "DIRECT"].includes(params.channel ?? "")
    ? (params.channel as "TRAVEL_AGENCY" | "LAND_AGENCY" | "DIRECT")
    : undefined;
  const currency = ["KRW", "VND"].includes(params.currency ?? "")
    ? (params.currency as "KRW" | "VND")
    : undefined;
  const includeAllStatuses = params.all === "1";

  // 서비스 라벨 번역(서버) — 통계와 동일 네임스페이스 재사용(신규 키 불필요).
  const tSvc = await getTranslations("adminStatistics");
  const serviceLabeler = (type: ServiceType) => tSvc(`services.types.${type}`);

  // 현재 판매가 환율(1 KRW = x VND) — KRW 매출인데 예약 스냅샷이 없을 때 환산 폴백.
  const fxRow = await prisma.appSetting.findUnique({ where: { key: FX_VND_PER_KRW_KEY } });
  const fallbackFxVndPerKrw = fxRow?.value ?? null;

  // 데이터 로드 — 권한 통과 후에만. (read-only)
  const { txns, totals } = await loadRevenueTxns(
    prisma,
    {
      from: period.from,
      to: period.to,
      types: typesParam,
      channel,
      villaId: params.villaId || undefined,
      partnerId: params.partnerId || undefined,
      currency,
      includeAllStatuses,
    },
    serviceLabeler,
    fallbackFxVndPerKrw
  );

  // 필터 드롭다운용 옵션 — 빌라·파트너 목록(이름만). 운영자 전용이라 누수 없음.
  const [villas, partners] = await Promise.all([
    prisma.villa.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.partner.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  // client로 내려보낼 직렬화 가능 period 메타(Date 제외).
  const periodMeta = {
    fromText: period.fromText,
    toText: period.toText,
    presetKey: period.presetKey,
  };

  return (
    <RevenueClient
      txns={serializeBigInt(txns) as never}
      totals={serializeBigInt(totals) as never}
      period={periodMeta}
      villas={villas}
      partners={partners}
      activeFilters={{
        types: typesParam ?? [],
        channel: channel ?? null,
        villaId: params.villaId || null,
        partnerId: params.partnerId || null,
        currency: currency ?? null,
        includeAllStatuses,
      }}
    />
  );
}
