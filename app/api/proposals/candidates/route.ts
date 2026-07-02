import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { findSellableVillaIds } from "@/lib/availability";
import { quoteStayForVilla, MissingRateError } from "@/lib/pricing";
import { parseUtcDateOnly } from "@/lib/date-vn";
import { serializeBigInt } from "@/lib/serialize";
import { BookingChannel, Currency } from "@prisma/client";
import { canSetPrice } from "@/lib/permissions";

/**
 * GET /api/proposals/candidates?checkIn&checkOut&saleCurrency — 제안 생성용 후보 빌라.
 * findSellableVillaIds를 villaIds 생략(전체 재고)으로 호출 — **ADMIN 전용 강제**
 * (재고 비공개 원칙, T1.3 QA 권고·leak-checklist). 원가 포함 응답도 ADMIN이므로 허용.
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!canSetPrice(session.user.role)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const checkIn = parseUtcDateOnly(url.searchParams.get("checkIn") ?? "");
  const checkOut = parseUtcDateOnly(url.searchParams.get("checkOut") ?? "");
  const currencyParam = url.searchParams.get("saleCurrency") ?? "KRW";
  if (!checkIn || !checkOut || checkIn.getTime() >= checkOut.getTime()) {
    return Response.json({ error: "invalid_input", message: "checkIn/checkOut이 잘못되었습니다" }, { status: 400 });
  }
  if (currencyParam !== "KRW" && currencyParam !== "VND" && currencyParam !== "USD") {
    return Response.json({ error: "invalid_input", message: "saleCurrency는 KRW·VND·USD만 가능합니다" }, { status: 400 });
  }
  const saleCurrency = currencyParam as Currency;
  // ADR-0031 — 채널(선택). DIRECT면 소비자 직판가로 미리보기(실제 제안가와 일치). 미지정=Net.
  const channelParam = url.searchParams.get("channel");
  const channel =
    channelParam === "DIRECT" || channelParam === "TRAVEL_AGENCY" || channelParam === "LAND_AGENCY"
      ? (channelParam as BookingChannel)
      : undefined;
  const range = { checkIn, checkOut };

  try {
    const sellableIds = await findSellableVillaIds(prisma, range);
    if (sellableIds.length === 0) return Response.json({ candidates: [], warnings: [] });

    const villas = await prisma.villa.findMany({
      where: { id: { in: sellableIds } },
      select: {
        id: true, name: true, complex: true, bedrooms: true, bathrooms: true, maxGuests: true, hasPool: true, breakfastAvailable: true,
        extraBedAvailable: true, // 후보 필터용(엑스트라베드 가능 여부) — ADMIN 전용 응답
        qualityScore: true, // 판매 후순위 정렬·표시 (ADMIN 전용 — 본 route는 canSetPrice 게이트, ...villa로 응답 포함)
        // 대표 사진 1장 — b2 후보 카드용 additive (T2.1 FE 계약 허용 범위)
        photos: { select: { url: true }, orderBy: { sortOrder: "asc" }, take: 1 },
      },
      // 판매 후순위: 품질점수 내림차순, 동점은 이름순 (Phase 2)
      orderBy: [{ qualityScore: "desc" }, { name: "asc" }],
    });

    const warnings: { villaId: string; name: string; reason: string }[] = [];
    const candidates = [];
    for (const { photos, ...villa } of villas) {
      try {
        const quote = await quoteStayForVilla(prisma, villa.id, range, saleCurrency, channel);
        // USD(Phase 2)는 요율표 판매단가가 없어 sale 견적이 없는 게 정상(ADMIN 수동 입력).
        //   "판매가 미책정" warning으로 거르지 않고, sale=null로 후보에 포함(원가·박수만 표시).
        if (saleCurrency !== Currency.USD) {
          // 미책정 가드 (ADR-0014 디버깅) — 판매가 0(마진·환율 미책정 placeholder)인 빌라는 후보 제외.
          //   생성 시 margin0·sale=cost·krw0 placeholder가 들어가는데, 그대로 제안되면 KRW 채널 0원·
          //   VND 채널 마진0이 고객에게 나간다. MissingRate와 동일하게 ADMIN에 사유 안내(책정 유도).
          const saleTotal =
            saleCurrency === Currency.KRW ? quote.totalSaleKrw ?? 0 : quote.totalSaleVnd ?? 0n;
          if (!saleTotal) {
            warnings.push({ villaId: villa.id, name: villa.name, reason: "판매가 미책정" });
            continue;
          }
        }
        candidates.push({
          ...villa,
          photoUrl: photos[0]?.url ?? null,
          nights: quote.nights,
          totalSaleKrw: quote.totalSaleKrw ?? null,
          totalSaleVnd: quote.totalSaleVnd ?? null,
          totalSaleUsd: null, // USD는 수동입력 — 후보 단계에선 항상 null
          totalSupplierCostVnd: quote.totalSupplierCostVnd, // ADMIN 전용 응답 — 마진 판단용
        });
      } catch (e) {
        if (e instanceof MissingRateError) {
          // 요율 미설정 빌라는 후보 제외 — ADMIN에게 사유 안내 (b9 요율 편집 유도)
          warnings.push({ villaId: villa.id, name: villa.name, reason: `요율 미설정(${e.season})` });
          continue;
        }
        throw e;
      }
    }

    return Response.json({ candidates: serializeBigInt(candidates), warnings });
  } catch (e) {
    console.error("[proposals/candidates] 조회 실패", e);
    return Response.json({ error: "후보 조회에 실패했습니다" }, { status: 500 });
  }
}
