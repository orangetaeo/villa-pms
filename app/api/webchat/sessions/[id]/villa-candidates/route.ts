// GET /api/webchat/sessions/[id]/villa-candidates — 웹챗 빌라 공유 후보 목록 (T-webchat-villa-share)
//
// 운영자 전체 개방(웹챗 무금액 게이트 — STAFF도 사용). 채팅에서 "빌라 공유" 시 선택할 후보를 제공한다.
//   빌라 목록은 세션과 무관한 전역 목록 — 세션 id는 권한 확인용 존재 검사에만 쓴다.
//   대상: status=ACTIVE AND isSellable(미검수·미운영 재고 노출 차단). 최신 생성순 50.
//
// ★누수 불변식(ADR-0031·마진 비공개): ratePeriods select는 salePrice*/consumerSalePrice*/season/isBase만.
//   supplierCostVnd·marginType·marginValue는 select 자체에서 배제. 대표가는 **소비자 VND**(웹챗 방문자=일반소비자).
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isOperator } from "@/lib/permissions";
import { requireCapability, notFoundIfMissing } from "@/lib/api-guard";
import { serializeBigInt } from "@/lib/serialize";
import { pickLowestSalePrice } from "@/lib/pricing";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  // 첫 줄 role 검사 — 운영자 전체.
  const g = await requireCapability(isOperator, "isOperator", req);
  if (!g.ok) return g.response;

  const { id } = await ctx.params;

  // 세션 존재 확인만(권한 게이트용) — 빌라 목록은 세션과 무관한 전역 목록.
  const session = await prisma.webChatSession.findFirst({
    where: { id },
    select: { id: true },
  });
  const foundSession = notFoundIfMissing(session);
  if (!foundSession.ok) return foundSession.response;

  // ACTIVE + isSellable만(검수 게이트 통과 재고). 최신순 50.
  const villas = await prisma.villa.findMany({
    where: { status: "ACTIVE", isSellable: true },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      name: true,
      complex: true,
      bedrooms: true,
      bathrooms: true,
      maxGuests: true,
      hasPool: true,
      breakfastAvailable: true,
      photos: { orderBy: { sortOrder: "asc" }, take: 1, select: { url: true } },
      // 판매가 계열 전용 select(누수 불변식) — 원가·마진 미조회. consumerSalePrice*는 소비자 계층용.
      ratePeriods: {
        select: {
          season: true,
          isBase: true,
          salePriceVnd: true,
          salePriceKrw: true,
          consumerSalePriceVnd: true,
          consumerSalePriceKrw: true,
        },
      },
    },
  });

  const candidates = serializeBigInt(
    villas.map((v) => {
      // ★웹챗 방문자=일반소비자 → 소비자 VND 대표가(CONSUMER 계층, 미설정 시 Net 폴백).
      const low = pickLowestSalePrice(v.ratePeriods, false, "CONSUMER");
      return {
        villaId: v.id,
        name: v.name,
        complex: v.complex,
        bedrooms: v.bedrooms,
        bathrooms: v.bathrooms,
        maxGuests: v.maxGuests,
        hasPool: v.hasPool,
        breakfastAvailable: v.breakfastAvailable,
        photoUrl: v.photos[0]?.url ?? null,
        priceVnd: low?.vnd ?? null,
        priceIsFrom: low !== null, // 최저 시즌가(없으면 base) 기준 → "부터" 표기
      };
    })
  );

  return NextResponse.json({ candidates });
}
