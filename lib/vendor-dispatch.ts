// lib/vendor-dispatch.ts — 원천 공급자(벤더) 발주·발주취소 통보 공용 헬퍼 (ADR-0023 S2 §4.3·§4.4)
//   발주(VENDOR_PO) Zalo + 인앱, 발주취소(VENDOR_PO_CANCELLED) Zalo + 인앱을 한 곳에.
//   호출부: 운영자 수동 발주(dispatch route)·게스트 자동 발주(g/service-orders POST)·취소(service-orders PATCH·게스트 취소).
//   ★ 누수: Zalo/인앱 본문에 판매가·마진 절대 없음(품목·수량·빌라·옵션 라벨·본인 정산액 costVnd만).
//   ★ 인앱 적재 실패는 try/catch로 격리 — 알림 실패가 발주/취소 본 로직을 깨지 않게(호출부와 동일 정책).
import { enqueueNotification } from "@/lib/zalo";
import { enqueueInAppNotification, buildVendorNotifText, vendorNotifLocale } from "@/lib/inapp-notification";
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
