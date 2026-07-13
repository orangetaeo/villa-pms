// 소비자(게스트/파트너) 액션 → 운영자 통지 (A1, admin-ops-gaps)
// 입금통보·부가서비스 요청은 그동안 예약 상세를 열어야만 보였다 — 48h 홀드만료 전
// 입금확인을 놓치면 예약이 자동 취소되므로 운영자 전원에게 Zalo로 배선한다.
// 판매가·원가·마진은 payload에 절대 미포함(원칙2와 동일 기준 — 금액은 관리자 화면에서).
import { NotificationType, type Prisma, type PrismaClient } from "@prisma/client";
import { enqueueOperatorNotification } from "@/lib/operator-notify";

type DbClient = PrismaClient | Prisma.TransactionClient;

/** 게스트 "입금했습니다" 통보 → 운영자 전원. best-effort(실패해도 본 요청 성공 유지). */
export async function notifyOperatorsGuestPaymentNotice(
  db: DbClient,
  params: {
    bookingId: string;
    villaName: string;
    guestName: string;
    depositorName: string | null;
    checkIn: Date;
    checkOut: Date;
    holdExpiresAt: Date | null;
  }
): Promise<void> {
  try {
    // 운영자 알림 — 그룹 설정 시 그룹방 1건, 미설정 시 개별 DM fan-out (ADR-0039)
    await enqueueOperatorNotification({
      db,
      type: NotificationType.GUEST_PAYMENT_NOTICE,
      payload: {
        bookingId: params.bookingId,
        villaName: params.villaName,
        guestName: params.guestName,
        depositorName: params.depositorName,
        checkIn: params.checkIn.toISOString().slice(0, 10),
        checkOut: params.checkOut.toISOString().slice(0, 10),
        holdExpiresAt: params.holdExpiresAt?.toISOString() ?? null,
      },
    });
  } catch (e) {
    console.error("[consumer-signal] 입금통보 운영자 알림 실패", e);
  }
}

/** 게스트/파트너 부가서비스 요청 → 운영자 전원. best-effort. */
export async function notifyOperatorsServiceOrderRequested(
  db: DbClient,
  params: {
    bookingId: string;
    orderId: string;
    villaName: string;
    serviceName: string;
    quantity: number;
    serviceDate: string | null;
    serviceTime: string | null;
  }
): Promise<void> {
  try {
    // 운영자 알림 — 그룹 설정 시 그룹방 1건, 미설정 시 개별 DM fan-out (ADR-0039)
    await enqueueOperatorNotification({
      db,
      type: NotificationType.SERVICE_ORDER_REQUESTED,
      payload: {
        bookingId: params.bookingId,
        orderId: params.orderId,
        villaName: params.villaName,
        serviceName: params.serviceName,
        quantity: params.quantity,
        serviceDate: params.serviceDate,
        serviceTime: params.serviceTime,
      },
    });
  } catch (e) {
    console.error("[consumer-signal] 부가서비스 요청 운영자 알림 실패", e);
  }
}
