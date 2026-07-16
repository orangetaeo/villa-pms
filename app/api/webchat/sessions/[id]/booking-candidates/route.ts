// GET /api/webchat/sessions/[id]/booking-candidates?q= — 예약 후보 추천/검색 (T-webchat-guest-link-share)
//
// 운영자 전체 개방(웹챗 무금액 게이트). 연결 팝오버가 후보를 신뢰도 순으로 먼저 제안한다.
//   q 없음(자동): ⑴ sourcePage `g:<8자>` 토큰 prefix 매칭(신뢰도 최상 — 이미 그 링크 유입) ⑵ 세션
//     연락처(contactZalo/Kakao) 전화 정규화 → Booking.guestPhone 매칭(체크인 임박 우선).
//   q 있음(수동 검색): 게스트명/전화/빌라명, 체크인 임박 순, limit 10.
//   ★후보 필드에 판매가·원가·마진·정산 select 자체 배제(누수 게이트). guestPhone은 뒷 4자리만 노출.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isOperator } from "@/lib/permissions";
import { requireCapability, notFoundIfMissing } from "@/lib/api-guard";
import { normalizePhone } from "@/lib/password-reset";

// ★후보 공통 select — 금액 필드 없음. guestPhone은 뒷4자리 계산·매칭용(원본은 응답에 미노출).
const CANDIDATE_SELECT = {
  id: true,
  guestName: true,
  guestPhone: true,
  checkIn: true,
  checkOut: true,
  status: true,
  villa: { select: { name: true } },
} as const;

type CandidateRow = {
  id: string;
  guestName: string;
  guestPhone: string | null;
  checkIn: Date;
  checkOut: Date;
  status: string;
  villa: { name: string } | null;
};

type MatchType = "token" | "contact" | "search";

/** 전화 뒷 4자리(정규화 후) — 원본 번호는 응답에 절대 넣지 않는다(오연결 확인 보조용). */
function phoneLast4(raw: string | null): string | null {
  const digits = normalizePhone(raw ?? "");
  return digits.length >= 4 ? digits.slice(-4) : digits.length > 0 ? digits : null;
}

/** 후보 직렬화 — 금액 무관 표시 전용 + matchType. */
function serializeCandidate(b: CandidateRow, matchType: MatchType) {
  return {
    bookingId: b.id,
    guestName: b.guestName,
    guestPhoneLast4: phoneLast4(b.guestPhone),
    villaName: b.villa?.name ?? null,
    checkIn: b.checkIn.toISOString(),
    checkOut: b.checkOut.toISOString(),
    status: b.status,
    matchType,
  };
}

/**
 * 전화 꼬리 매칭 — 정규화 숫자의 마지막 8자리 비교(국가코드/선행0 차이 흡수, 예: 84901234567 ↔ 0901234567).
 * 8자리 미만이면 완전 일치만 인정(오매칭 방지). 운영자가 다이얼로그로 최종 확인하므로 보수적 근사 허용.
 */
function phoneTailMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  const tail = (s: string) => (s.length >= 8 ? s.slice(-8) : s);
  const ta = tail(a);
  const tb = tail(b);
  if (ta.length < 8 || tb.length < 8) return a === b;
  return ta === tb;
}

/** 체크인이 오늘에 가까운 순(절대 거리 asc)으로 정렬 — 임박 예약 우선. */
function byCheckInProximity(now: Date) {
  const t = now.getTime();
  return (x: CandidateRow, y: CandidateRow) =>
    Math.abs(x.checkIn.getTime() - t) - Math.abs(y.checkIn.getTime() - t);
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  // 첫 줄 role 검사 — 운영자 전체.
  const g = await requireCapability(isOperator, "isOperator", req);
  if (!g.ok) return g.response;

  const { id } = await ctx.params;
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();

  // 세션 로드(조직 공유) — 자동 후보에 sourcePage·연락처 필요.
  const session = await prisma.webChatSession.findFirst({
    where: { id },
    select: { id: true, sourcePage: true, contactZalo: true, contactKakao: true },
  });
  const foundSession = notFoundIfMissing(session);
  if (!foundSession.ok) return foundSession.response;
  const s = foundSession.resource;

  const now = new Date();

  // ── 수동 검색 모드(q 있음) ──────────────────────────────────────────────
  if (q.length > 0) {
    const qDigits = normalizePhone(q);
    // ★formatted phone 검색은 best-effort: guestPhone에 구분자(하이픈·공백·+)가 있으면 contains가
    //   원문 숫자열과 어긋날 수 있다. 이름·빌라명은 정확, 전화는 저장 포맷에 의존(운영자 확인으로 보완).
    const or: object[] = [
      { guestName: { contains: q, mode: "insensitive" as const } },
      { villa: { name: { contains: q, mode: "insensitive" as const } } },
    ];
    if (qDigits.length >= 3) or.push({ guestPhone: { contains: qDigits } });
    if (q !== qDigits && qDigits.length >= 3) or.push({ guestPhone: { contains: q } });

    // 넉넉히 가져와 앱에서 임박순 정렬 후 상위 10(DB만으로는 "오늘 기준 근접"을 표현하기 어려움).
    const rows = (await prisma.booking.findMany({
      where: { OR: or },
      take: 30,
      orderBy: { checkIn: "desc" },
      select: CANDIDATE_SELECT,
    })) as CandidateRow[];

    const candidates = rows
      .sort(byCheckInProximity(now))
      .slice(0, 10)
      .map((b) => serializeCandidate(b, "search"));

    return NextResponse.json({ candidates, source: "search" as const });
  }

  // ── 자동 후보 모드(q 없음) ──────────────────────────────────────────────
  const candidates: ReturnType<typeof serializeCandidate>[] = [];
  const seen = new Set<string>();
  const push = (b: CandidateRow, m: MatchType) => {
    if (seen.has(b.id)) return;
    seen.add(b.id);
    candidates.push(serializeCandidate(b, m));
  };

  // ⑴ 토큰 유입 매칭(신뢰도 최상) — sourcePage `g:<8자>` prefix로 GuestCheckinToken.token startsWith.
  //    revoke 무관(식별 목적). cuid/base64url 특성상 8자 prefix 충돌은 실질 0.
  const m = /^g:(.+)$/.exec(s.sourcePage ?? "");
  const prefix = m?.[1]?.trim() ?? "";
  if (prefix.length >= 6) {
    const tokens = await prisma.guestCheckinToken.findMany({
      where: { token: { startsWith: prefix } },
      select: { bookingId: true },
    });
    const bookingIds = [...new Set(tokens.map((t) => t.bookingId))];
    if (bookingIds.length > 0) {
      const rows = (await prisma.booking.findMany({
        where: { id: { in: bookingIds } },
        select: CANDIDATE_SELECT,
      })) as CandidateRow[];
      for (const b of rows.sort(byCheckInProximity(now))) push(b, "token");
    }
  }

  // ⑵ 연락처 매칭(신뢰도 중) — 세션 contactZalo/Kakao 정규화 후 Booking.guestPhone 정규화 비교.
  //    ★성능: guestPhone 저장 포맷이 제각각(구분자·국가코드)이라 DB 정규화 매칭이 어렵다. 후보군을
  //      기간 윈도우(체크아웃 ≥ 오늘−30d & 체크인 ≤ 오늘+180d, guestPhone 존재)로 좁혀 앱에서 꼬리 비교.
  //      운영 데이터의 근접 예약은 소량이라 이 바운드가 안전하다.
  const contactDigits = [s.contactZalo, s.contactKakao]
    .map((c) => normalizePhone(c ?? ""))
    .filter((d) => d.length >= 8);
  if (contactDigits.length > 0) {
    const past = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const future = new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000);
    const rows = (await prisma.booking.findMany({
      where: {
        guestPhone: { not: null },
        checkOut: { gte: past },
        checkIn: { lte: future },
      },
      select: CANDIDATE_SELECT,
    })) as CandidateRow[];
    const matched = rows.filter((b) => {
      const bp = normalizePhone(b.guestPhone ?? "");
      return contactDigits.some((cd) => phoneTailMatch(cd, bp));
    });
    for (const b of matched.sort(byCheckInProximity(now))) push(b, "contact");
  }

  // 상위 source 구분(FE 힌트 — 각 후보는 개별 matchType 보유). 토큰 후보가 있으면 token, 아니면 contact.
  const source: MatchType = candidates.some((c) => c.matchType === "token") ? "token" : "contact";
  return NextResponse.json({ candidates, source });
}
