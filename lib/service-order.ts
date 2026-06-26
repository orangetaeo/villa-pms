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
