// lib/guest-vendor-contact.ts — 게스트 신청 내역의 담당자(벤더) 연락처 노출 게이트
//
// ★티켓 문의 본사 일원화(테오): TICKET 주문은 확정 후에도 업체 이름·전화를 게스트에게 노출하지 않는다.
//   (업체=베트남인·소비자 Zalo 미설치 가능성 → 직접 소통 비현실적. 티켓 관련 연락은 본사 Villa Go.)
//   비TICKET(마사지 등)은 현행 유지 — 픽업/방문 현장 조율이 필요하므로 확정 후 담당자 직접 연락 노출.
//
//   확정 게이트: 상태 CONFIRMED 또는 벤더 수락(vendorAccepted) 후에만 연락처 노출(그 전엔 payload에도 미포함).

/** 게스트에게 담당 벤더 이름·전화를 노출해도 되는지. TICKET이면 확정 여부와 무관하게 항상 false. */
export function guestVendorContactVisible(
  status: string,
  vendorAccepted: boolean,
  type: string
): boolean {
  if (type === "TICKET") return false;
  return status === "CONFIRMED" || vendorAccepted;
}
