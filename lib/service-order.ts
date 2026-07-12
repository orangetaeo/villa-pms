// lib/service-order — ServiceOrder 상태 전이 상태머신 (단일 소스)
// 부가서비스 주문(ServiceOrder)의 상태 전이표. 라이브 카탈로그/원천공급자 발주 시스템
// (ADR-0019/0023, app/api/service-orders/[id])이 이 전이표를 재사용한다. 순수(DB·auth 무의존).
//
// 주의: 초기 T7.1의 단독 판매 BE(입력검증 validateServiceOrderInput·마진 computeServiceMarginKrw·
// /api/bookings/[id]/services·/api/services/[id])는 ADR-0019/0023 카탈로그 시스템(service-catalog·
// ServiceOrdersPanel)이 흡수·대체하여 제거되었다. 이 모듈에는 양 시스템이 공유하는 전이 로직만 남는다.
import type { ServiceOrderStatus } from "@prisma/client";

export const SERVICE_ORDER_STATUSES: readonly ServiceOrderStatus[] = [
  "REQUESTED",
  "CONFIRMED",
  "DELIVERED",
  "CANCELLED",
] as const;

export function isServiceOrderStatus(value: string): value is ServiceOrderStatus {
  return (SERVICE_ORDER_STATUSES as readonly string[]).includes(value);
}

// 상태 전이표 — REQUESTED→CONFIRMED→DELIVERED 진행, 종결 전 어디서든 CANCELLED 가능.
// DELIVERED·CANCELLED는 종결(전이 불가).
const TRANSITIONS: Record<ServiceOrderStatus, readonly ServiceOrderStatus[]> = {
  REQUESTED: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["DELIVERED", "CANCELLED"],
  DELIVERED: [],
  CANCELLED: [],
};

export class InvalidServiceTransitionError extends Error {
  constructor(
    public readonly from: ServiceOrderStatus,
    public readonly to: ServiceOrderStatus
  ) {
    super(`서비스 상태 전이 불가: ${from} → ${to}`);
    this.name = "InvalidServiceTransitionError";
  }
}

export function canTransitionService(
  from: ServiceOrderStatus,
  to: ServiceOrderStatus
): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertServiceTransition(
  from: ServiceOrderStatus,
  to: ServiceOrderStatus
): void {
  if (!canTransitionService(from, to)) {
    throw new InvalidServiceTransitionError(from, to);
  }
}

// ── ADMIN 주문 목록 아코디언: 접힘 행 신호·상태 필터 (순수 판정) ─────────────────────
// 예약 상세 부가옵션 목록(ServiceOrdersPanel)이 대량일 때 훑기·필터용. UI 무의존·테스트 가능.

// 접힘 행 "처리 필요" 신호 판정에 필요한 최소 필드(구조적 부분집합 — OrderRow가 만족).
export interface OrderAttentionInput {
  status: ServiceOrderStatus;
  type: string;
  quantity: number;
  ticketUrls: string[];
  vendorStatus: "PENDING_VENDOR" | "VENDOR_ACCEPTED" | "VENDOR_REJECTED" | null;
  proposedServiceDate: string | null;
  vendorProposalRespondedAt: string | null;
}

export interface OrderAttention {
  requested: boolean; // REQUESTED — 확정/발주 등 운영자 처리 대기
  unresolvedProposal: boolean; // 공급자가 대안 시간 제안 → 적용/무시 미처리
  ticketShort: boolean; // TICKET 발행 미달(N<M, 미종결)
}

// 접힘 행에서 놓치면 안 되는 처리 필요 신호. 종결(CANCELLED)은 신호 없음.
export function orderAttention(o: OrderAttentionInput): OrderAttention {
  const terminal = o.status === "CANCELLED";
  return {
    requested: o.status === "REQUESTED",
    unresolvedProposal:
      o.vendorStatus === "VENDOR_ACCEPTED" &&
      !!o.proposedServiceDate &&
      !o.vendorProposalRespondedAt,
    ticketShort: o.type === "TICKET" && !terminal && o.ticketUrls.length < o.quantity,
  };
}

export function orderHasAttention(o: OrderAttentionInput): boolean {
  const a = orderAttention(o);
  return a.requested || a.unresolvedProposal || a.ticketShort;
}

// 상태 필터 버킷 — DELIVERED는 "확정"에 포함(표시 배지는 구분 유지).
export type OrderFilterBucket = "requested" | "confirmed" | "cancelled";
export type OrderFilter = "all" | OrderFilterBucket;

export function orderBucket(status: ServiceOrderStatus): OrderFilterBucket {
  if (status === "REQUESTED") return "requested";
  if (status === "CANCELLED") return "cancelled";
  return "confirmed"; // CONFIRMED, DELIVERED
}

export interface OrderFilterCounts {
  all: number;
  requested: number;
  confirmed: number;
  cancelled: number;
}

export function orderFilterCounts(
  orders: readonly { status: ServiceOrderStatus }[]
): OrderFilterCounts {
  const c: OrderFilterCounts = { all: orders.length, requested: 0, confirmed: 0, cancelled: 0 };
  for (const o of orders) c[orderBucket(o.status)] += 1;
  return c;
}
