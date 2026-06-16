// 부가서비스(ServiceOrder) 순수 로직 (T7.1, Phase 2)
// BBQ·입장권·가이드·차량+기사·조식 배달을 예약(Booking)에 부가 판매.
// 원가(costVnd)·판매가(priceKrw)·마진을 다루므로 ADMIN 전용 — 라우트에서 role 강제.
// 마진 비공개(절대 규칙): SUPPLIER·공개 노출 금지. 이 모듈은 순수(DB·auth 무의존).
import type { ServiceOrderStatus, ServiceType } from "@prisma/client";
import { suggestSalePriceKrw } from "./pricing";
import { parseUtcDateOnly } from "./date-vn";

export const SERVICE_TYPES: readonly ServiceType[] = [
  "BBQ",
  "TICKET",
  "GUIDE",
  "CAR_RENTAL",
  "BREAKFAST",
] as const;

export const SERVICE_ORDER_STATUSES: readonly ServiceOrderStatus[] = [
  "REQUESTED",
  "CONFIRMED",
  "DELIVERED",
  "CANCELLED",
] as const;

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

export function isServiceType(value: string): value is ServiceType {
  return (SERVICE_TYPES as readonly string[]).includes(value);
}

export function isServiceOrderStatus(value: string): value is ServiceOrderStatus {
  return (SERVICE_ORDER_STATUSES as readonly string[]).includes(value);
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

export interface ServiceOrderInput {
  type: ServiceType;
  costVnd: bigint;
  priceKrw: number;
  serviceDate?: string | null; // "YYYY-MM-DD" (UTC 자정 저장)
  vendorName?: string | null;
  note?: string | null;
}

export type ServiceOrderValidationError =
  | "INVALID_TYPE"
  | "NEGATIVE_COST"
  | "INVALID_PRICE"
  | "INVALID_SERVICE_DATE"
  | "VENDOR_TOO_LONG"
  | "NOTE_TOO_LONG";

/** 생성 입력 검증 — 위반 코드 배열(빈 배열이면 통과). 순수. */
export function validateServiceOrderInput(
  input: ServiceOrderInput
): ServiceOrderValidationError[] {
  const errors: ServiceOrderValidationError[] = [];
  if (!isServiceType(input.type)) errors.push("INVALID_TYPE");
  if (typeof input.costVnd !== "bigint" || input.costVnd < 0n) {
    errors.push("NEGATIVE_COST");
  }
  if (!Number.isInteger(input.priceKrw) || input.priceKrw < 0) {
    errors.push("INVALID_PRICE");
  }
  if (
    input.serviceDate != null &&
    input.serviceDate !== "" &&
    parseUtcDateOnly(input.serviceDate) === null
  ) {
    errors.push("INVALID_SERVICE_DATE");
  }
  if (input.vendorName != null && input.vendorName.length > 100) {
    errors.push("VENDOR_TOO_LONG");
  }
  if (input.note != null && input.note.length > 500) {
    errors.push("NOTE_TOO_LONG");
  }
  return errors;
}

/**
 * 부가서비스 마진(KRW 기준, 운영자 전용) = 판매가(KRW) − 원가(VND→KRW 환산).
 * 환산은 lib/pricing suggestSalePriceKrw 재사용(환율 형식 검증·반올림 일관).
 * 음수 가능(역마진) — 호출측이 경고 표시.
 */
export function computeServiceMarginKrw(
  costVnd: bigint,
  priceKrw: number,
  fxVndPerKrw: string
): number {
  const costKrw = suggestSalePriceKrw(costVnd, fxVndPerKrw);
  return priceKrw - costKrw;
}
