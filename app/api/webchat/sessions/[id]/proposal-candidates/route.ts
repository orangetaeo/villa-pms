// GET /api/webchat/sessions/[id]/proposal-candidates — 최근 유효 제안 후보 목록 (T-webchat-proposal-link-send)
//
// 운영자 전체 개방(웹챗 무금액 게이트 — STAFF도 사용). 채팅에서 "기존 제안 보내기" 시 선택할 후보를 제공한다.
//   제안은 세션 예약과 무관한 전역 목록 — 세션 id는 권한 확인용 존재 검사에만 쓴다.
//   유효 필터: status=ACTIVE AND expiresAt > now (effectiveProposalStatus ACTIVE와 동치). 최신 생성순 10.
//   ★금액 필드(price*·total*·fx*·margin*) select 원천 배제(누수 게이트) — clientName·빌라명·날짜만.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isOperator } from "@/lib/permissions";
import { requireCapability, notFoundIfMissing } from "@/lib/api-guard";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  // 첫 줄 role 검사 — 운영자 전체.
  const g = await requireCapability(isOperator, "isOperator", req);
  if (!g.ok) return g.response;

  const { id } = await ctx.params;

  // 세션 존재 확인만(권한 게이트용) — 제안 목록은 세션과 무관한 전역 목록.
  const session = await prisma.webChatSession.findFirst({
    where: { id },
    select: { id: true },
  });
  const foundSession = notFoundIfMissing(session);
  if (!foundSession.ok) return foundSession.response;

  const now = new Date();

  // ACTIVE(유효)만 — status=ACTIVE AND expiresAt > now. 최신순 10. 금액 컬럼은 select 자체에서 배제.
  const proposals = await prisma.proposal.findMany({
    where: { status: "ACTIVE", expiresAt: { gt: now } },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      id: true,
      clientName: true,
      channel: true,
      expiresAt: true,
      items: {
        orderBy: { id: "asc" },
        select: {
          checkIn: true,
          checkOut: true,
          villa: { select: { name: true } },
        },
      },
    },
  });

  const candidates = proposals.map((p) => {
    const villaNames = p.items
      .map((it) => it.villa?.name ?? "")
      .filter((n) => n.length > 0);
    // 날짜는 첫 item 기준(item마다 날짜가 다를 수 있음 — 대표 표시용). 빌라 수는 villaNames 길이로 전달.
    const first = p.items[0];
    return {
      proposalId: p.id,
      clientName: p.clientName,
      channel: p.channel,
      villaNames,
      checkIn: first ? first.checkIn.toISOString() : null,
      checkOut: first ? first.checkOut.toISOString() : null,
      expiresAt: p.expiresAt.toISOString(),
    };
  });

  return NextResponse.json({ candidates });
}
