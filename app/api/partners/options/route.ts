// GET /api/partners/options — 경량 파트너 목록 (드롭다운용, canViewFinance 전용)
//
// 예약 파트너 지정 드롭다운이 미수·Aging 집계 전체를 끌어오던 과조회를 분리(QA Minor).
// id·표시명·유형·등급·상태만 반환 — 채권·미수 미포함(재무 데이터 최소 노출). ?type 필터.
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canViewFinance } from "@/lib/permissions";
import { getPartnerOptions } from "@/lib/partner-server";

const PARTNER_TYPES = ["TRAVEL_AGENCY", "LAND_AGENCY"] as const;
type PartnerTypeLiteral = (typeof PARTNER_TYPES)[number];

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (!canViewFinance(session.user.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const typeParam = new URL(req.url).searchParams.get("type");
  const type = PARTNER_TYPES.includes(typeParam as PartnerTypeLiteral)
    ? (typeParam as PartnerTypeLiteral)
    : undefined;

  const partners = await getPartnerOptions(prisma, type);
  return NextResponse.json({ partners });
}
