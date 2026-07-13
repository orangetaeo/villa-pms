// lib/checkin-roster.ts — 티켓 이용자 명단 해석 공유 원천 (ADR-0043)
//   게스트 여권 업로드 즉시 자동 OCR로 GuestCheckinToken.passportOcrJson에 잠정본을 누적한다.
//   운영자 체크인 확정본(CheckInRecord.passportOcrJson)이 존재하면 그것이 항상 정본이고 잠정본은 무시된다.
//   ★ UI(옵션 화면·운영자 주문 폼)와 서버 검증(TICKET_GUEST_MISMATCH)이 반드시 같은 명단을 봐야 하므로,
//     명단 해석은 이 파일 한 곳에서만 정의한다. 소비처는 loadCheckinRoster(또는 순수 resolveRosterGuests)만 통과시킨다.
//   ★ 누수 경계: 명단 통로는 guestsFromPassportOcr(name·birthDate 화이트리스트)만 — 여권번호 등 유입 없음.

import type { PrismaClient } from "@prisma/client";
import { guestsFromPassportOcr, ticketGuestKey, type TicketGuest } from "@/lib/ticket-guests";

/**
 * 토큰 잠정 OCR(GuestCheckinToken.passportOcrJson) → 티켓 이용자 후보 명단.
 *   guestsFromPassportOcr 통과 후:
 *   ① name·birthDate 둘 다 null인 항목 제거(비여권 사진·OCR 쓰레기 — 명단에 유입되면 안 됨).
 *   ② ticketGuestKey(name+birthDate) 중복 제거(같은 여권 재촬영 — 첫 등장만 유지).
 */
export function provisionalGuestsFromTokenOcr(json: unknown): TicketGuest[] {
  const seen = new Set<string>();
  const out: TicketGuest[] = [];
  for (const g of guestsFromPassportOcr(json)) {
    if (g.name == null && g.birthDate == null) continue; // ① 전부 null 제거
    const key = ticketGuestKey(g);
    if (seen.has(key)) continue; // ② 중복 제거(첫 등장 유지)
    seen.add(key);
    out.push(g);
  }
  return out;
}

/**
 * 명단 정본 해석 — 운영자 확정본 우선, 없으면 게스트 잠정본.
 *   confirmedJson(CheckInRecord.passportOcrJson)에서 1명 이상 나오면 그 확정본만 사용(기존 동작 불변),
 *   비어 있으면(체크인 확정 전) 토큰 잠정본(provisional)을 사용한다.
 */
export function resolveRosterGuests(confirmedJson: unknown, tokenJson: unknown): TicketGuest[] {
  const confirmed = guestsFromPassportOcr(confirmedJson);
  if (confirmed.length > 0) return confirmed;
  return provisionalGuestsFromTokenOcr(tokenJson);
}

/**
 * 예약의 티켓 이용자 명단을 DB에서 로드(확정본 우선, 없으면 토큰 잠정본).
 *   CheckInRecord와 GuestCheckinToken의 passportOcrJson을 병렬 조회 후 resolveRosterGuests.
 *   토큰 없는 예약(운영자 수동 예약 등)은 잠정본이 빈 배열로 처리된다.
 */
export async function loadCheckinRoster(
  db: Pick<PrismaClient, "checkInRecord" | "guestCheckinToken">,
  bookingId: string
): Promise<TicketGuest[]> {
  const [ci, tok] = await Promise.all([
    db.checkInRecord.findUnique({ where: { bookingId }, select: { passportOcrJson: true } }),
    db.guestCheckinToken.findUnique({ where: { bookingId }, select: { passportOcrJson: true } }),
  ]);
  return resolveRosterGuests(ci?.passportOcrJson, tok?.passportOcrJson);
}
