// GET /api/webchat/inbox — 운영자 웹 채팅 세션 목록 (T-webchat-mvp)
//
// ADMIN 전용(첫 줄 role 검사). ownerAdminId 스코프 강제. 비정규화 lastMessage* 필드 사용(N+1 금지).
// filter=open|blocked|all, take 30+1 자체 커서(Zalo 목록과 병합 금지 — 웹챗 탭 단독).
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isOperator } from "@/lib/permissions";
import { requireCapability } from "@/lib/api-guard";
import { normalizePhone } from "@/lib/password-reset";

const PAGE_SIZE = 30;

/** 세션↔예약 배지 파생 값 — linked(연결됨)·candidate(후보 있음)·none. 금액 무관. */
export type BookingLink = "linked" | "candidate" | "none";

/**
 * 전화 꼬리 매칭 — booking-candidates 라우트의 phoneTailMatch와 동일 로직(그 파일은 수정 금지라 인라인 복제).
 * 정규화 숫자의 마지막 8자리 비교(국가코드/선행0 차이 흡수). 8자리 미만이면 완전 일치만 인정.
 */
function phoneTailMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  const tail = (s: string) => (s.length >= 8 ? s.slice(-8) : s);
  const ta = tail(a);
  const tb = tail(b);
  if (ta.length < 8 || tb.length < 8) return a === b;
  return ta === tb;
}

/** sourcePage `g:<prefix>`에서 토큰 prefix 추출(booking-candidates와 동일: 6자 이상만 식별에 사용). */
function tokenPrefixOf(sourcePage: string | null): string | null {
  const m = /^g:(.+)$/.exec(sourcePage ?? "");
  const prefix = m?.[1]?.trim() ?? "";
  return prefix.length >= 6 ? prefix : null;
}

export async function GET(req: Request) {
  // 첫 줄 role 검사 — 운영자 전체(OWNER/MANAGER/STAFF/ADMIN). 웹챗은 구조적 무금액이라 STAFF 개방 안전.
  const g = await requireCapability(isOperator, "isOperator", req);
  if (!g.ok) return g.response;

  const sp = new URL(req.url).searchParams;
  const filter = sp.get("filter") ?? "open";
  const cursor = sp.get("cursor");

  // 웹챗 세션은 조직 공유 자산 — Zalo 대화(개인 스코프)와 다름 (T-webchat-expand)
  const where: Prisma.WebChatSessionWhereInput = {};
  if (filter === "open") where.status = "OPEN";
  else if (filter === "blocked") where.status = "BLOCKED";
  // filter=all → status 무필터

  const rows = await prisma.webChatSession.findMany({
    where,
    orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
    take: PAGE_SIZE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      visitorLocale: true,
      status: true,
      sourcePage: true,
      contactEmail: true,
      contactZalo: true,
      contactKakao: true,
      bookingId: true,
      unreadForAdmin: true,
      lastMessageText: true,
      lastMessageDirection: true,
      lastMessageAt: true,
      createdAt: true,
    },
  });

  const hasMore = rows.length > PAGE_SIZE;
  const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
  const nextCursor = hasMore ? page[page.length - 1]?.id ?? null : null;

  // ── 예약 후보 배지 배치 계산(N+1 금지 — 추가 쿼리 최대 2개: 토큰 OR 1 + 연락처 윈도우 1) ──
  //   후보는 "존재 여부(boolean)"만 판정. 정확한 예약 1건 매칭·표시는 booking-candidates(연결 팝오버) 담당.
  //   ★금액 필드 select 없음(누수 게이트).
  const unlinked = page.filter((s) => !s.bookingId);

  // ⑴ 토큰 유입 후보 — 미연결 세션 sourcePage의 g:prefix들을 모아 GuestCheckinToken을 한 번에 조회.
  const prefixMatched = new Set<string>(); // 매칭 성공한 prefix 집합
  const prefixes = [
    ...new Set(unlinked.map((s) => tokenPrefixOf(s.sourcePage)).filter((p): p is string => p !== null)),
  ];
  if (prefixes.length > 0) {
    const tokens = await prisma.guestCheckinToken.findMany({
      where: { OR: prefixes.map((p) => ({ token: { startsWith: p } })) },
      select: { token: true },
    });
    // 반환 토큰을 각 prefix에 역매핑(존재 여부만 필요). 세션 수가 적어 이중 루프 허용.
    for (const { token } of tokens) {
      for (const p of prefixes) if (token.startsWith(p)) prefixMatched.add(p);
    }
  }

  // ⑵ 연락처 후보 — 미연결 세션들의 contactZalo/Kakao digit 수집 → 예약 기간 윈도우 한 번 조회 후 앱에서 꼬리 매칭.
  //   윈도우·threshold는 booking-candidates와 동일(checkOut ≥ 오늘−30d & checkIn ≤ 오늘+180d, guestPhone 존재).
  const anyContactDigits = unlinked.some(
    (s) => normalizePhone(s.contactZalo ?? "").length >= 8 || normalizePhone(s.contactKakao ?? "").length >= 8
  );
  let bookingPhones: string[] = [];
  if (anyContactDigits) {
    const now = new Date();
    const pastWindow = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const futureWindow = new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000);
    const brows = await prisma.booking.findMany({
      where: { guestPhone: { not: null }, checkOut: { gte: pastWindow }, checkIn: { lte: futureWindow } },
      select: { guestPhone: true },
      take: 200, // 상한 가드(booking-candidates와 동일) — 운영 규모상 여유
    });
    bookingPhones = brows.map((b) => normalizePhone(b.guestPhone ?? "")).filter((d) => d.length >= 8);
  }

  /** 미연결 세션의 후보 존재 여부 — 토큰 유입 or 연락처 꼬리 매칭. */
  function hasCandidate(s: (typeof page)[number]): boolean {
    const prefix = tokenPrefixOf(s.sourcePage);
    if (prefix && prefixMatched.has(prefix)) return true;
    const contactDigits = [s.contactZalo, s.contactKakao]
      .map((c) => normalizePhone(c ?? ""))
      .filter((d) => d.length >= 8);
    return contactDigits.some((cd) => bookingPhones.some((bp) => phoneTailMatch(cd, bp)));
  }

  function bookingLinkOf(s: (typeof page)[number]): BookingLink {
    if (s.bookingId) return "linked";
    return hasCandidate(s) ? "candidate" : "none";
  }

  const sessions = page.map((s) => ({
    id: s.id,
    visitorLocale: s.visitorLocale,
    status: s.status,
    sourcePage: s.sourcePage,
    contactEmail: s.contactEmail,
    contactZalo: s.contactZalo,
    contactKakao: s.contactKakao,
    bookingLink: bookingLinkOf(s),
    unreadForAdmin: s.unreadForAdmin,
    lastMessageText: s.lastMessageText,
    lastMessageDirection: s.lastMessageDirection,
    lastMessageAt: s.lastMessageAt ? s.lastMessageAt.toISOString() : null,
    createdAt: s.createdAt.toISOString(),
  }));

  return NextResponse.json({ sessions, nextCursor });
}
