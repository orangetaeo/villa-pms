// lib/inapp-notification.ts — VENDOR 인앱 알림센터 적재·조회 (ADR-0023 후속)
//   enqueueNotification(lib/zalo.ts, Zalo 큐) 패턴 미러링하되 채널은 Zalo가 아니라 인앱(DB only).
//   InAppNotification(id,userId,type,title,body?,href?,readAt?,createdAt) — 가격 필드 없음(누수 불가).
//   ★ 누수: title/body엔 판매가(priceKrw/priceVnd)·마진 절대 금지. 품목·수량·빌라·본인 지급액(costVnd)만.
//      수신자(VENDOR)는 베트남인·한국인 혼합 — title/body는 적재 시점에 수신자 User.locale(ko/vi)로 확정(buildVendorNotifText).
import { prisma } from "@/lib/prisma";
import { OPERATOR_ROLES } from "@/lib/permissions";
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

// ===================== 운영자(ADMIN) 인앱 알림 (admin-vendor-ops C) =====================
//   수신자=운영자(ko 고정 — 운영 화면 기준 언어). 벤더 이벤트(수락/거절/제안/완료)·자가가입 대기.
//   ★ 누수: 금액 절대 미포함 — 판매가·마진은 물론 costVnd(지급액)도 넣지 않는다.
//      품목·빌라·업체명·일정(제안)·거절 사유만.

export type AdminNotifKind =
  | "VENDOR_ACCEPTED"
  | "VENDOR_REJECTED"
  | "VENDOR_PROPOSED"
  | "VENDOR_COMPLETED"
  | "VENDOR_SIGNUP";

export type AdminNotifPayload = {
  vendorName?: string | null;
  itemName?: string | null;
  villaName?: string | null;
  /** 제안 일정 — "yyyy-MM-dd"·"HH:MM" (VENDOR_PROPOSED만) */
  proposedServiceDate?: string | null;
  proposedServiceTime?: string | null;
  /** 거절 사유 한 줄 (VENDOR_REJECTED만) */
  rejectReason?: string | null;
};

const ADMIN_NOTIF_TITLES: Record<AdminNotifKind, string> = {
  VENDOR_ACCEPTED: "공급자 수락",
  VENDOR_REJECTED: "공급자 거절",
  VENDOR_PROPOSED: "공급자 시간 제안",
  VENDOR_COMPLETED: "공급자 서비스 완료",
  VENDOR_SIGNUP: "공급자 가입 승인 대기",
};

/**
 * 벤더 이벤트 → 운영자 인앱 알림 title/body 빌더 (ko 고정).
 *   body = "업체 — 품목 (빌라)" + 제안이면 제안 일정 줄, 거절이면 사유 줄.
 *   ★ 금액(판매가·마진·costVnd) 절대 미포함.
 */
export function buildAdminNotifText(kind: AdminNotifKind, p: AdminNotifPayload): VendorNotifText {
  const vendor = p.vendorName?.trim() || "—";
  const item = p.itemName?.trim() || null;
  const villa = p.villaName?.trim() ? ` (${p.villaName.trim()})` : "";
  // 가입 대기는 발주 컨텍스트(품목·빌라)가 없음 — 업체명만.
  const head = item ? `${vendor} — ${item}${villa}` : `${vendor}${villa}`;
  const lines: string[] = [head];
  if (kind === "VENDOR_PROPOSED" && p.proposedServiceDate) {
    const time = p.proposedServiceTime ? ` ${p.proposedServiceTime}` : "";
    lines.push(`제안 일정: ${p.proposedServiceDate}${time}`);
  }
  if (kind === "VENDOR_REJECTED" && p.rejectReason?.trim()) {
    lines.push(`사유: ${p.rejectReason.trim()}`);
  }
  return { title: ADMIN_NOTIF_TITLES[kind], body: lines.join("\n") };
}

/**
 * 활성 운영자 전원에게 인앱 알림 적재 — Zalo 연결(zaloUserId) 유무와 무관(Zalo 미연결 운영자도
 * 벨에서 인지). 발송이 아니라 적재이므로 순차 create.
 * ★ 호출부에서 try/catch 격리할 것 — 적재 실패가 본 비즈니스 로직을 깨지 않게.
 */
export async function enqueueInAppForOperators(params: {
  type: string;
  title: string;
  body?: string | null;
  href?: string | null;
  db?: DbClient;
}) {
  const db = params.db ?? prisma;
  const operators = await db.user.findMany({
    where: { role: { in: [...OPERATOR_ROLES] }, isActive: true },
    select: { id: true },
  });
  for (const op of operators) {
    await enqueueInAppNotification({
      userId: op.id,
      type: params.type,
      title: params.title,
      body: params.body ?? null,
      href: params.href ?? null,
      db,
    });
  }
}
