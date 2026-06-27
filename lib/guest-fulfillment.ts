// lib/guest-fulfillment.ts — 게스트에게 보여줄 "이행 안내" 문구 산출(배송/픽업/방문). 순수.
//   서버(신청 내역 페이지)·클라(신청 카드) 양쪽에서 동일 로직 사용 → 표기 일관성.
//   ★마진/원가와 무관(라벨만). pickupNote는 운영자 자유 텍스트(주소·조건)로 그대로 덧붙임(번역 안 함).
import { fulfillmentMode } from "./service-catalog";
import type { GuestLabels } from "./guest-i18n";

/**
 * 이행 안내 문구. type으로 배송형/예약형/기타 분기.
 *   예약형(마사지·이발)은 pickupAvailable로 세분: true=픽업 제공, false=직접 방문, null=미정(운영자 확인 폴백).
 *   pickupNote(주소·조건)가 있으면 괄호로 덧붙인다.
 */
export function fulfillmentNote(
  type: string,
  pickupAvailable: boolean | null | undefined,
  pickupNote: string | null | undefined,
  L: GuestLabels["addons"]
): string {
  const mode = fulfillmentMode(type);
  let base: string;
  if (mode === "DELIVERY") base = L.fulfillDelivery;
  else if (mode === "OTHER") base = L.fulfillOther;
  else
    base =
      pickupAvailable === true
        ? L.fulfillPickup
        : pickupAvailable === false
          ? L.fulfillVisit
          : L.fulfillAppointment;
  const note = pickupNote?.trim();
  return note ? `${base} (${note})` : base;
}
