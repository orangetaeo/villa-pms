// lib/vendor-dispatch.ts — 원천 공급자(벤더) 발주·발주취소 통보 공용 헬퍼 (ADR-0023 S2 §4.3·§4.4)
//   발주(VENDOR_PO) Zalo + 인앱, 발주취소(VENDOR_PO_CANCELLED) Zalo + 인앱을 한 곳에.
//   호출부: 운영자 수동 발주(dispatch route)·게스트 자동 발주(g/service-orders POST)·취소(service-orders PATCH·게스트 취소).
//   ★ 누수: Zalo/인앱 본문에 판매가·마진 절대 없음(품목·수량·빌라·옵션 라벨·본인 정산액 costVnd만).
//   ★ 인앱 적재 실패는 try/catch로 격리 — 알림 실패가 발주/취소 본 로직을 깨지 않게(호출부와 동일 정책).
import { enqueueNotification } from "@/lib/zalo";
import { enqueueOperatorNotification } from "@/lib/operator-notify";
import {
  enqueueInAppNotification,
  buildVendorNotifText,
  vendorNotifLocale,
  buildAdminNotifText,
  enqueueInAppForOperators,
  type AdminNotifKind,
} from "@/lib/inapp-notification";
import { selectedOptionLabels } from "@/lib/service-display";
import { toDateOnlyString } from "@/lib/date-vn";
import { NotificationType } from "@prisma/client";

/** 벤더 관계(발주 통보 대상) — userId 없으면 통보 불가, zaloUserId 없으면 Zalo만 생략(인앱은 적재). */
export interface VendorNotifyTarget {
  userId: string | null;
  user: { zaloUserId: string | null; locale: string | null } | null;
}

export interface VendorPoNotifyInput {
  vendor: VendorNotifyTarget | null;
  villaName: string | null; // 이행 장소(발주 빌라 1채)
  villaAddress: string | null; // 이행 주소
  serviceDate: Date | null; // @db.Date — toDateOnlyString으로 문자열화
  serviceTime: string | null; // 이행 시각 "HH:MM"
  itemName: string;
  quantity: number;
  selectedOptions: unknown; // 옵션 스냅샷 — selectedOptionLabels가 라벨만 추출(가격 제거)
  costVnd: bigint; // 벤더 자기 정산액(라인 총액). >0일 때만 표기, 0이면 null(게스트 발주는 미확정→null)
  guestNote: string | null; // 게스트 요청사항(판매가·마진과 무관, 노출 OK)
  customerName?: string | null; // ★이용자 이름(입력 또는 예약 대표자 폴백) — 벤더 응대 대상 식별용. 이름만(전화 금지)
}

/**
 * 벤더에게 발주(VENDOR_PO) 통보 — Zalo(zaloUserId 연결 시) + 인앱(userId 있으면 항상).
 * 반환 { zaloSent } — Zalo 큐 적재 여부(미연결이면 false, 호출부가 경보 표시에 사용).
 */
export async function sendVendorPoNotifications(
  input: VendorPoNotifyInput
): Promise<{ zaloSent: boolean }> {
  const vendorUserId = input.vendor?.userId;
  const vendorZalo = input.vendor?.user?.zaloUserId;
  const serviceDate = input.serviceDate ? toDateOnlyString(input.serviceDate) : null;
  let zaloSent = false;

  // Zalo 발주 — 벤더 User에 zaloUserId 연결돼 있을 때만 큐 적재(발송은 cron/worker).
  if (vendorUserId && vendorZalo) {
    await enqueueNotification({
      userId: vendorUserId,
      type: NotificationType.VENDOR_PO,
      payload: {
        villaName: input.villaName ?? "—",
        villaAddress: input.villaAddress ?? null,
        serviceDate,
        serviceTime: input.serviceTime ?? null,
        itemName: input.itemName,
        quantity: input.quantity,
        // 옵션 라벨만(가격 제거) + 벤더 자기 정산액(0이면 null)
        optionLabels: selectedOptionLabels(input.selectedOptions, "vi"),
        costVnd: input.costVnd > 0n ? input.costVnd.toString() : null,
        guestNote: input.guestNote ?? null,
        // ★이용자 이름 — 없으면 null(빌더가 줄 생략, 구 payload 하위호환). 이름만(전화 금지).
        customerName: input.customerName?.trim() || null,
      },
    });
    zaloSent = true;
  }

  // 인앱 알림센터 적재(Zalo와 별개 — 미연결 벤더도 앱에서 발주 인지). ★ 가격·마진 없음. try/catch 격리.
  if (vendorUserId) {
    try {
      const { title, body } = buildVendorNotifText(
        NotificationType.VENDOR_PO,
        {
          itemName: input.itemName,
          quantity: input.quantity,
          villaName: input.villaName ?? null,
          serviceDate,
        },
        vendorNotifLocale(input.vendor?.user?.locale)
      );
      await enqueueInAppNotification({
        userId: vendorUserId,
        type: NotificationType.VENDOR_PO,
        title,
        body,
        href: "/vendor",
      });
    } catch {
      // 인앱 알림 적재 실패는 발주 성공을 막지 않는다(폴링 다음 주기엔 미반영일 뿐).
    }
  }

  return { zaloSent };
}

/**
 * 벤더 가부 응답(accept|reject|propose) → 운영자(테오) 통보 입력.
 *   respond route(가부 응답)와 티켓 발행=수락 겸행(ADR-0034)이 공유 — 한 소스로 일원화.
 *   ★ 누수: 판매가·마진 없음. costVnd(벤더 정산액)는 운영자만 정당 열람(>0일 때만 표기).
 */
export interface VendorResponseNotifyInput {
  action: "accept" | "reject" | "propose";
  vendorNameKo: string | null; // 운영자 통지 ko 우선
  vendorName: string | null; // 폴백(원어명)
  itemName: string;
  villaName: string | null;
  bookingId: string | null; // 인앱 알림 딥링크(/bookings/{id})
  serviceDate: Date | null; // @db.Date — YYYY-MM-DD로 직렬화
  serviceTime: string | null;
  quantity: number;
  costVnd: bigint; // 벤더 정산액(라인 총액). >0일 때만 표기, 0이면 null.
  rejectReason?: string | null; // reject 전용
  proposedServiceDate?: string | null; // propose 전용(YYYY-MM-DD)
  proposedServiceTime?: string | null; // propose 전용(HH:MM)
  proposalNote?: string | null; // propose 전용 메모
}

/**
 * 벤더 가부 응답 → 운영자 전원에게 Zalo(VENDOR_PO_RESPONSE) + 인앱(벨) 통보.
 *   - Zalo: zaloUserId 연결된 활성 운영자에게 큐 적재(발송은 cron/worker).
 *   - 인앱: 활성 운영자 전원(미연결 운영자도 벨에서 인지). try/catch 격리 — 적재 실패가 본 로직 무영향.
 *   ★ 금액(판매가·마진) 미포함 — 품목·빌라·업체·제안 일정·거절 사유·정산액(costVnd)만.
 */
export async function sendVendorResponseOperatorNotifications(
  input: VendorResponseNotifyInput
): Promise<void> {
  const payload = {
    vendorName: input.vendorNameKo || input.vendorName || "—",
    // accepted: accept/propose 모두 수락 계열(true), reject만 false.
    accepted: input.action !== "reject",
    action: input.action, // zalo 빌더 분기용
    itemName: input.itemName,
    villaName: input.villaName ?? "—",
    serviceDate: input.serviceDate ? input.serviceDate.toISOString().slice(0, 10) : null,
    serviceTime: input.serviceTime ?? null,
    quantity: input.quantity,
    costVnd: input.costVnd > 0n ? input.costVnd.toString() : null,
    rejectReason: input.action === "reject" ? input.rejectReason?.trim() || undefined : undefined,
    proposedServiceDate:
      input.action === "propose" ? input.proposedServiceDate ?? undefined : undefined,
    proposedServiceTime:
      input.action === "propose" ? input.proposedServiceTime || undefined : undefined,
    proposalNote: input.action === "propose" ? input.proposalNote?.trim() || undefined : undefined,
  };
  // 운영자 Zalo 알림 — 그룹 설정 시 그룹방 1건, 미설정 시 개별 DM fan-out (ADR-0040)
  await enqueueOperatorNotification({
    type: NotificationType.VENDOR_PO_RESPONSE,
    payload,
  });

  // 운영자 인앱 알림(벨) — Zalo 미연결 운영자도 인지. 적재 실패는 본 로직에 영향 0.
  try {
    const kindByAction: Record<VendorResponseNotifyInput["action"], AdminNotifKind> = {
      accept: "VENDOR_ACCEPTED",
      reject: "VENDOR_REJECTED",
      propose: "VENDOR_PROPOSED",
    };
    const kind = kindByAction[input.action];
    const { title, body } = buildAdminNotifText(kind, {
      vendorName: input.vendorNameKo || input.vendorName,
      itemName: input.itemName,
      villaName: input.villaName,
      proposedServiceDate: input.action === "propose" ? input.proposedServiceDate : null,
      proposedServiceTime: input.action === "propose" ? input.proposedServiceTime : null,
      rejectReason: input.action === "reject" ? input.rejectReason : null,
    });
    await enqueueInAppForOperators({
      type: kind,
      title,
      body,
      href: `/bookings/${input.bookingId}`,
    });
  } catch {
    // 무시 — 알림 적재 실패가 본 응답을 깨지 않게
  }
}

export interface VendorPoCancelNotifyInput {
  vendor: VendorNotifyTarget | null;
  itemName: string;
  quantity: number;
  villaName: string | null;
  serviceDate: Date | null;
}

/**
 * 벤더에게 발주취소(VENDOR_PO_CANCELLED) 통보 — 살아있던 발주(PENDING_VENDOR·VENDOR_ACCEPTED)를
 * 취소했을 때 stale PO 방지용. Zalo(연결 시) + 인앱. 반환 { zaloSent }.
 */
export async function sendVendorPoCancelledNotifications(
  input: VendorPoCancelNotifyInput
): Promise<{ zaloSent: boolean }> {
  const vendorUserId = input.vendor?.userId;
  const vendorZalo = input.vendor?.user?.zaloUserId;
  const notifLocale = vendorNotifLocale(input.vendor?.user?.locale);
  const serviceDate = input.serviceDate ? toDateOnlyString(input.serviceDate) : null;
  const villaName = input.villaName ?? "—";
  let zaloSent = false;

  if (vendorUserId && vendorZalo) {
    await enqueueNotification({
      userId: vendorUserId,
      type: NotificationType.VENDOR_PO_CANCELLED,
      payload: { itemName: input.itemName, quantity: input.quantity, villaName, serviceDate },
    });
    zaloSent = true;
  }

  if (vendorUserId) {
    try {
      const { title, body } = buildVendorNotifText(
        NotificationType.VENDOR_PO_CANCELLED,
        { itemName: input.itemName, quantity: input.quantity, villaName, serviceDate },
        notifLocale
      );
      await enqueueInAppNotification({
        userId: vendorUserId,
        type: NotificationType.VENDOR_PO_CANCELLED,
        title,
        body,
        href: "/vendor",
      });
    } catch {
      // 무시 — 본 로직 영향 0
    }
  }

  return { zaloSent };
}
