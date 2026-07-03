// lib/inapp-notification.ts — VENDOR 인앱 알림센터 적재·조회 (ADR-0023 후속)
//   enqueueNotification(lib/zalo.ts, Zalo 큐) 패턴 미러링하되 채널은 Zalo가 아니라 인앱(DB only).
//   InAppNotification(id,userId,type,title,body?,href?,readAt?,createdAt) — 가격 필드 없음(누수 불가).
//   ★ 누수: title/body엔 판매가(priceKrw/priceVnd)·마진 절대 금지. 품목·수량·빌라·본인 지급액(costVnd)만.
//      수신자(VENDOR)는 베트남인·한국인 혼합 — title/body는 적재 시점에 수신자 User.locale(ko/vi)로 확정(buildVendorNotifText).
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

// ===================== 문구 빌더 (수신자 locale: vi 기본, ko 지원) =====================
//   서버 라우트에서 next-intl 로드 없이 짧은 상수로 적재. 통화 표기는 점 구분(₫).
//   원천공급자는 베트남인·한국인 혼합 — 적재 시점에 수신자 User.locale로 언어 확정(과거 적재분은 재번역 안 함).
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

/** 수신자 locale 정규화 — User.locale이 "ko"면 ko, 그 외(vi·null·기타)는 vi 기본 */
export function vendorNotifLocale(userLocale: string | null | undefined): "ko" | "vi" {
  return userLocale === "ko" ? "ko" : "vi";
}

// 이벤트별 제목 상수 — ko/vi 동등 유지(새 타입 추가 시 두 언어 모두 채울 것)
const NOTIF_TITLES: Record<string, { vi: string; ko: string }> = {
  VENDOR_PO: { vi: "Yêu cầu đặt dịch vụ mới", ko: "새 발주 요청" },
  VENDOR_PO_CANCELLED: { vi: "Đơn đặt đã bị huỷ", ko: "발주가 취소되었습니다" },
  VENDOR_SETTLED: { vi: "Đã thanh toán", ko: "정산 완료" },
  VENDOR_PROPOSAL_APPLIED: {
    vi: "Đề xuất giờ đã được chấp nhận",
    ko: "시간 제안이 수락되었습니다",
  },
  VENDOR_PROPOSAL_DISMISSED: {
    vi: "Đề xuất giờ không được áp dụng — giữ lịch ban đầu",
    ko: "시간 제안이 반영되지 않았습니다 — 기존 일정 유지",
  },
  DEFAULT: { vi: "Thông báo", ko: "알림" },
};

/**
 * 도메인 이벤트 → VENDOR 인앱 알림 title/body 빌더 (수신자 locale 기준, 기본 vi).
 *   - VENDOR_PO: 새 발주 요청
 *   - VENDOR_PO_CANCELLED: 발주 취소
 *   - VENDOR_SETTLED: 정산 완료(본인 지급액 표기)
 *   - VENDOR_PROPOSAL_APPLIED/DISMISSED: 시간 제안 결과(적용 시 확정 일정 표기)
 */
export function buildVendorNotifText(
  type: string,
  p: VendorNotifPayload,
  locale: "ko" | "vi" = "vi"
): VendorNotifText {
  const item = p.itemName?.trim() || "—";
  const qty = p.quantity != null && p.quantity > 0 ? ` ×${p.quantity}` : "";
  const villa = p.villaName?.trim() ? ` · ${p.villaName.trim()}` : "";
  const date = p.serviceDate ? ` · ${p.serviceDate}` : "";
  const detail = `${item}${qty}${villa}${date}`;
  const title = (NOTIF_TITLES[type] ?? NOTIF_TITLES.DEFAULT)[locale];

  switch (type) {
    case "VENDOR_SETTLED": {
      // 정산 완료 — 본인 지급액(costVnd) 표기.
      const pay = p.costVnd ? ` · ${formatVndDot(p.costVnd)}` : "";
      return { title, body: `${detail}${pay}` };
    }
    case "VENDOR_PROPOSAL_APPLIED": {
      // 제안 적용 — 확정된 새 일정(날짜+시각)을 함께 표기.
      const time = p.serviceTime ? ` ${p.serviceTime}` : "";
      return { title, body: `${detail}${time}` };
    }
    default:
      // VENDOR_PO·VENDOR_PO_CANCELLED·VENDOR_PROPOSAL_DISMISSED·기타 — 공통 detail.
      return { title, body: detail };
  }
}
