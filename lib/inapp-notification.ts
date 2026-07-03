// lib/inapp-notification.ts — VENDOR 인앱 알림센터 적재·조회 (ADR-0023 후속)
//   enqueueNotification(lib/zalo.ts, Zalo 큐) 패턴 미러링하되 채널은 Zalo가 아니라 인앱(DB only).
//   InAppNotification(id,userId,type,title,body?,href?,readAt?,createdAt) — 가격 필드 없음(누수 불가).
//   ★ 누수: title/body엔 판매가(priceKrw/priceVnd)·마진 절대 금지. 품목·수량·빌라·본인 지급액(costVnd)만.
//      수신자(VENDOR)는 vi 사용자 — title/body는 vi로 적재(buildVendorNotifText).
import { prisma } from "@/lib/prisma";
import type { DbClient } from "@/lib/availability";

export interface EnqueueInAppNotificationParams {
  userId: string;
  /** 도메인 이벤트 타입 — VENDOR_PO·VENDOR_PO_CANCELLED·VENDOR_SETTLED 등(NotificationType 문자열 재사용) */
  type: string;
  title: string;
  body?: string | null;
  href?: string | null;
  /** 비즈니스 트랜잭션 안에서 원자적으로 적재할 때 tx 주입(zalo.enqueueNotification 패턴) */
  db?: DbClient;
}

/**
 * InAppNotification 1건 생성(읽음 전). 발송이 아니라 적재이므로 동기.
 * ★ 호출부에서 try/catch로 격리할 것 — 알림 적재 실패가 본 비즈니스 트랜잭션을 깨지 않도록.
 */
export async function enqueueInAppNotification(params: EnqueueInAppNotificationParams) {
  const db = params.db ?? prisma;
  return db.inAppNotification.create({
    data: {
      userId: params.userId,
      type: params.type,
      title: params.title,
      body: params.body ?? null,
      href: params.href ?? null,
    },
  });
}

/** 본인 미읽음(readAt=null) 알림 수 — 벨 뱃지·목록 API에서 재사용 */
export async function unreadCount(userId: string): Promise<number> {
  return prisma.inAppNotification.count({ where: { userId, readAt: null } });
}

/** 본인 최근 알림 목록(createdAt desc, limit) — 가격 필드는 모델에 없으나 명시적 화이트리스트 select */
export async function listForUser(userId: string, limit = 30) {
  return prisma.inAppNotification.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      type: true,
      title: true,
      body: true,
      href: true,
      readAt: true,
      createdAt: true,
    },
  });
}

// ===================== vi 문구 빌더 (수신자 VENDOR = 베트남어) =====================
//   서버 라우트에서 next-intl 로드 없이 짧은 vi 상수로 적재. KR↔VN 통화 표기는 점 구분(₫).
//   ★ 가격·마진 없음: 품목·수량·빌라·serviceDate 또는 본인 지급액(costVnd)만 노출.

/** VND 점 구분 표기 (1.500.000₫). BigInt 문자열 — Number() 금지(정밀도 손실 방지) */
export function formatVndDot(raw: string): string {
  const negative = raw.startsWith("-");
  const digits = negative ? raw.slice(1) : raw;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${negative ? "-" : ""}${grouped}₫`;
}

export type VendorNotifPayload = {
  itemName?: string | null;
  quantity?: number | null;
  villaName?: string | null;
  serviceDate?: string | null; // "yyyy-MM-dd" (toDateOnlyString)
  /** 일정 확정 시각 "HH:MM" — 제안 결과 통보용(적용된 실제 시각) */
  serviceTime?: string | null;
  /** 정산 완료 통보용 — 본인 지급액(BigInt 문자열). 우리 판매가·마진 아님. */
  costVnd?: string | null;
};

export type VendorNotifText = { title: string; body: string };

/**
 * 도메인 이벤트 → VENDOR 인앱 알림 vi title/body 빌더.
 *   - VENDOR_PO: 새 발주 요청
 *   - VENDOR_PO_CANCELLED: 발주 취소
 *   - VENDOR_SETTLED: 정산 완료(본인 지급액 표기)
 */
export function buildVendorNotifText(type: string, p: VendorNotifPayload): VendorNotifText {
  const item = p.itemName?.trim() || "—";
  const qty = p.quantity != null && p.quantity > 0 ? ` ×${p.quantity}` : "";
  const villa = p.villaName?.trim() ? ` · ${p.villaName.trim()}` : "";
  const date = p.serviceDate ? ` · ${p.serviceDate}` : "";
  const detail = `${item}${qty}${villa}${date}`;

  switch (type) {
    case "VENDOR_PO":
      // "Yêu cầu đặt dịch vụ mới" = 새 발주 요청
      return { title: "Yêu cầu đặt dịch vụ mới", body: detail };
    case "VENDOR_PO_CANCELLED":
      // "Đơn đặt đã bị huỷ" = 발주 취소됨
      return { title: "Đơn đặt đã bị huỷ", body: detail };
    case "VENDOR_SETTLED": {
      // "Đã thanh toán" = 정산 완료. 본인 지급액(costVnd) 표기.
      const pay = p.costVnd ? ` · ${formatVndDot(p.costVnd)}` : "";
      return { title: "Đã thanh toán", body: `${detail}${pay}` };
    }
    case "VENDOR_PROPOSAL_APPLIED": {
      // 공급자의 대안 시간 제안이 운영자에 의해 적용됨 — 확정된 새 일정을 함께 표기.
      const time = p.serviceTime ? ` ${p.serviceTime}` : "";
      return {
        title: "Đề xuất giờ đã được chấp nhận",
        body: `${item}${qty}${villa}${date}${time}`,
      };
    }
    case "VENDOR_PROPOSAL_DISMISSED":
      // 제안이 반영되지 않음 — 기존 일정 유지. 일정은 body의 날짜(원래 serviceDate)로 안내.
      return {
        title: "Đề xuất giờ không được áp dụng — giữ lịch ban đầu",
        body: detail,
      };
    default:
      return { title: "Thông báo", body: detail };
  }
}
