import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { findSellableVillaIds } from "@/lib/availability";
import { quoteStayForVilla, MissingRateError, suggestSalePriceUsd } from "@/lib/pricing";
import { getEffectiveFxVndPerUsd } from "@/lib/fx-effective";
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

    // USD 자동환산 — USD 채널이면 유효 USD 환율(제안 생성 시점과 동일 해석)을 1회 조회.
    //   환율이 있으면 VND 요율표 총액 ÷ 환율로 자동 견적(usdAuto), 없으면 기존 수동 입력 폴백.
    const fxVndPerUsd =
      saleCurrency === Currency.USD ? await getEffectiveFxVndPerUsd(prisma, new Date()) : null;
    const usdAuto = saleCurrency === Currency.USD && fxVndPerUsd != null;
    // USD 자동환산은 VND 요율표 총액을 환산 기준으로 쓰므로 quote는 VND로 부른다(채널 tier 반영).
    const quoteCurrency = saleCurrency === Currency.USD ? Currency.VND : saleCurrency;

    const warnings: { villaId: string; name: string; reason: string }[] = [];
    const candidates = [];
    for (const { photos, ...villa } of villas) {
      try {
        const quote = await quoteStayForVilla(prisma, villa.id, range, quoteCurrency, channel);
        // KRW·VND, 그리고 USD 자동환산(환산 기준 VND)일 때 판매가 미책정 가드 적용.
        //   환율 미설정 USD(usdAuto=false)만 수동 입력을 유도하므로 0원 빌라도 후보에 포함.
        if (saleCurrency !== Currency.USD || usdAuto) {
          // 미책정 가드 (ADR-0014 디버깅) — 판매가 0(마진·환율 미책정 placeholder)인 빌라는 후보 제외.
          //   생성 시 margin0·sale=cost·krw0 placeholder가 들어가는데, 그대로 제안되면 KRW 채널 0원·
          //   VND 채널 마진0이 고객에게 나간다. MissingRate와 동일하게 ADMIN에 사유 안내(책정 유도).
          const saleTotal =
            quoteCurrency === Currency.KRW ? quote.totalSaleKrw ?? 0 : quote.totalSaleVnd ?? 0n;
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
          // USD 자동환산: VND 요율표 총액을 생성 시점과 동일 환율로 환산(half-up, float 금지).
          //   환율 미설정(usdAuto=false)이면 null → FE가 수동 입력 유도.
          totalSaleUsd: usdAuto ? suggestSalePriceUsd(quote.totalSaleVnd!, fxVndPerUsd) : null,
          totalSupplierCostVnd: quote.totalSupplierCostVnd, // ADMIN 전용 응답 — 마진 판단용
          // ADR-0031 안전장치 — DIRECT(소비자가) 견적에서 소비자 원화/동가 미설정으로 도매가가
          //   그대로 나가는 빌라. 운영자가 "일반고객에게 도매가가 제안된다"를 인지하도록 경고 배지/배너용.
          //   NET(여행사·랜드사)이나 폴백 0이면 false.
          consumerPriceMissing:
            channel === BookingChannel.DIRECT && (quote.consumerFallbackNights ?? 0) > 0,
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

    return Response.json({
      candidates: serializeBigInt(candidates),
      warnings,
      // USD 채널일 때만 자동/수동 모드를 FE에 알린다(비-USD면 undefined).
      usdAuto: saleCurrency === Currency.USD ? usdAuto : undefined,
    });
  } catch (e) {
    console.error("[proposals/candidates] 조회 실패", e);
    return Response.json({ error: "후보 조회에 실패했습니다" }, { status: 500 });
  }
}
