// GET /api/settings/fx-rates — 현재 일일 시세 조회 (후속확장 3, ADMIN 전용)
//
// 환율 설정 화면의 "현재 시세 불러오기"용. 외부 API를 직접 부르지 않고 getDailyRates(open.er-api
// 일일 캐시·장애 폴백 내장)를 경유한다 — 하루 1회만 실제 fetch, 그 외엔 캐시. 시세 없으면 null.
// 반환은 기존 fx 문자열 관례(Decimal 문자열)로 정규화 → 그대로 FX_VND_PER_KRW·FX_VND_PER_USD 입력칸에 채움.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isSystemAdmin } from "@/lib/permissions";
import { requireCapability } from "@/lib/api-guard";
import { getDailyRates } from "@/lib/fx-rates";
import { formatVndPerUnit } from "@/lib/fx-format";

export async function GET(req: Request) {
  // 첫 줄 게이트 — 설정 조회와 동일 레벨(ADMIN 전용)
  const g = await requireCapability(isSystemAdmin, "isSystemAdmin", req);
  if (!g.ok) return g.response;

  const rates = await getDailyRates(prisma);
  if (!rates) {
    // 시세·캐시 모두 없음(외부 장애 + 초기 상태) — 화면은 "불러오기 실패" 처리
    return NextResponse.json({ vndPerKrw: null, vndPerUsd: null, fetchedAt: null });
  }
  return NextResponse.json({
    vndPerKrw: formatVndPerUnit(rates.vndPerUnit.KRW), // Decimal 문자열 또는 null(이상치)
    vndPerUsd: formatVndPerUnit(rates.vndPerUnit.USD),
    fetchedAt: rates.date, // 시세 기준일(Asia/Ho_Chi_Minh, YYYY-MM-DD)
  });
}
