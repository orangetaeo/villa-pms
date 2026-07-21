// GET /api/zalo/conversations/[id]/guest-link-bookings?q= — 게스트 링크 공유용 예약 검색 (T-webchat-cards C)
//
// Zalo CUSTOMER(투숙객) 1:1 대화에서 게스트 링크(체크인·부가서비스·영수증)를 보낼 예약을 고르기 위한 검색.
//   q 없음: 최근/임박 예약(체크인 근접 순) 상위 10.
//   q 있음: 게스트명·전화·빌라명 검색(체크인 근접 순) 상위 10.
//   ★금액(판매가·원가·마진·정산) select 자체 배제(누수 게이트). guestPhone은 뒷 4자리만 노출.
//   운영자 전체 개방(게스트 링크=무금액 게이트, 웹챗 send-link와 동일). STAFF 포함.
//
// 게이트: 본인(ownerAdminId) 대화만 + counterpartyType=CUSTOMER + 1:1(GROUP 아님).
//   → share 라우트 GUEST_LINK 게이트와 대칭(모달이 애초에 잘못된 대화에서 열리지 않도록 방어).
import { NextResponse } from "next/server";
import { ZaloCounterpartyType, ZaloThreadType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isOperator } from "@/lib/permissions";
import { requireCapability } from "@/lib/api-guard";
import { normalizePhone } from "@/lib/password-reset";

// ★후보 공통 select — 금액 필드 없음. checkOutRecord는 영수증 발송 가능 여부(checkedOut) 판정용.
const CANDIDATE_SELECT = {
  id: true,
  guestName: true,
  guestPhone: true,
  checkIn: true,
  checkOut: true,
  status: true,
  villa: { select: { name: true } },
  checkOutRecord: { select: { id: true } },
} as const;

type CandidateRow = {
  id: string;
  guestName: string;
  guestPhone: string | null;
  checkIn: Date;
  checkOut: Date;
  status: string;
  villa: { name: string } | null;
  checkOutRecord: { id: string } | null;
};

/** 전화 뒷 4자리(정규화 후) — 원본 번호는 응답에 절대 넣지 않는다(오연결 확인 보조용). */
function phoneLast4(raw: string | null): string | null {
  const digits = normalizePhone(raw ?? "");
  return digits.length >= 4 ? digits.slice(-4) : digits.length > 0 ? digits : null;
}

/** 체크인이 오늘에 가까운 순(절대 거리 asc) — 임박/최근 예약 우선. */
function byCheckInProximity(now: Date) {
  const t = now.getTime();
  return (x: CandidateRow, y: CandidateRow) =>
    Math.abs(x.checkIn.getTime() - t) - Math.abs(y.checkIn.getTime() - t);
}

/** 후보 직렬화 — 금액 무관 표시 전용 + 영수증 발송 가능 여부(checkedOut). */
function serialize(b: CandidateRow) {
  return {
    bookingId: b.id,
    guestName: b.guestName,
    guestPhoneLast4: phoneLast4(b.guestPhone),
    villaName: b.villa?.name ?? null,
    checkIn: b.checkIn.toISOString(),
    checkOut: b.checkOut.toISOString(),
    status: b.status,
    // 영수증 링크는 체크아웃 완료(CHECKED_OUT && CheckOutRecord)만 — FE가 receipt 옵션 활성/비활성 결정.
    checkedOut: b.status === "CHECKED_OUT" && b.checkOutRecord != null,
  };
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  // 첫 줄 role 검사 — 운영자 전체(무금액 게이트).
  const g = await requireCapability(isOperator, "isOperator", req);
  if (!g.ok) return g.response;

  const { id } = await ctx.params;
  const ownerAdminId = g.session.user.id;

  // 본인 대화만 + CUSTOMER 1:1 게이트 — 미존재/타 관리자는 404, 그 외 분류·그룹은 403.
  const conv = await prisma.zaloConversation.findFirst({
    where: { id, ownerAdminId },
    select: { counterpartyType: true, threadType: true },
  });
  if (!conv) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  if (
    conv.counterpartyType !== ZaloCounterpartyType.CUSTOMER ||
    conv.threadType === ZaloThreadType.GROUP
  ) {
    return NextResponse.json({ error: "COUNTERPARTY_NOT_ALLOWED" }, { status: 403 });
  }

  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  const now = new Date();

  // ── 검색 모드(q 있음) ──
  if (q.length > 0) {
    const qDigits = normalizePhone(q);
    const or: object[] = [
      { guestName: { contains: q, mode: "insensitive" as const } },
      { villa: { name: { contains: q, mode: "insensitive" as const } } },
    ];
    if (qDigits.length >= 3) or.push({ guestPhone: { contains: qDigits } });
    if (q !== qDigits && qDigits.length >= 3) or.push({ guestPhone: { contains: q } });

    const rows = (await prisma.booking.findMany({
      where: { OR: or },
      take: 30,
      orderBy: { checkIn: "desc" },
      select: CANDIDATE_SELECT,
    })) as CandidateRow[];

    const bookings = rows.sort(byCheckInProximity(now)).slice(0, 10).map(serialize);
    return NextResponse.json({ bookings, source: "search" as const });
  }

  // ── 자동 모드(q 없음) — 최근/임박 예약 상위 10 ──
  const rows = (await prisma.booking.findMany({
    take: 40,
    orderBy: { checkIn: "desc" },
    select: CANDIDATE_SELECT,
  })) as CandidateRow[];
  const bookings = rows.sort(byCheckInProximity(now)).slice(0, 10).map(serialize);
  return NextResponse.json({ bookings, source: "recent" as const });
}
