// 부가서비스 원천 공급자 발주 게이트 — 순수 로직 (ADR-0023 §4.3·§4.4 S2)
// 흐름: 운영자 요청(REQUESTED) → 발주(PENDING_VENDOR) → 공급자 가부(VENDOR_ACCEPTED|VENDOR_REJECTED)
//        → (수락 시) 운영자 고객확정(CONFIRMED). 거절 시 운영자 대체 지정·재발주 또는 취소.
// 이 모듈은 순수(DB·auth 무의존). 라우트에서 누수(판매가·마진·타 공급자)·role 강제.
import type { ServiceVendorStatus } from "@prisma/client";

export const VENDOR_GATE_STATUSES: readonly ServiceVendorStatus[] = [
  "PENDING_VENDOR",
  "VENDOR_ACCEPTED",
  "VENDOR_REJECTED",
] as const;

// 공급자측 발주 게이트 전이표 — PENDING_VENDOR에서만 가부 가능.
// VENDOR_ACCEPTED·VENDOR_REJECTED는 공급자측 종결(재전이 불가). 운영자 재발주는 별도(canDispatch).
export const VENDOR_GATE_TRANSITIONS: Record<
  ServiceVendorStatus,
  readonly ServiceVendorStatus[]
> = {
  PENDING_VENDOR: ["VENDOR_ACCEPTED", "VENDOR_REJECTED"],
  VENDOR_ACCEPTED: [],
  VENDOR_REJECTED: [],
};

export class InvalidVendorResponseError extends Error {
  constructor(public readonly from: ServiceVendorStatus | null) {
    super(`발주 가부 응답 불가: 현재 상태 ${from ?? "(없음)"} (PENDING_VENDOR 아님)`);
    this.name = "InvalidVendorResponseError";
  }
}

export function isVendorGateStatus(value: string): value is ServiceVendorStatus {
  return (VENDOR_GATE_STATUSES as readonly string[]).includes(value);
}

export function canTransitionVendorGate(
  from: ServiceVendorStatus,
  to: ServiceVendorStatus
): boolean {
  return VENDOR_GATE_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * 운영자가 이 주문을 (재)발주할 수 있는가.
 * - status가 REQUESTED(고객 미확정)이고
 * - vendorId가 지정되어 있고
 * - 아직 발주 전(vendorStatus==null)이거나 직전 발주가 거절됨(VENDOR_REJECTED → 대체/재발주 허용).
 * VENDOR_ACCEPTED·PENDING_VENDOR 상태에서는 재발주 불가(중복 발송 방지).
 */
export function canDispatch(order: {
  status: string;
  vendorId: string | null;
  vendorStatus: ServiceVendorStatus | null;
}): boolean {
  return (
    order.status === "REQUESTED" &&
    order.vendorId != null &&
    (order.vendorStatus == null || order.vendorStatus === "VENDOR_REJECTED")
  );
}

/**
 * 공급자가 수락하되 "대안 시간"을 제안했고 운영자가 아직 처리(적용/무시)하지 않았는가.
 * (확장 필드 패턴 — 새 vendorStatus enum값을 추가하지 않고 VENDOR_ACCEPTED 위에 협의 상태를 표현.)
 * - proposedServiceDate가 있으면(제안 존재) + vendorProposalRespondedAt이 null이면(미해결) true.
 * - 운영자가 적용 또는 무시하면 vendorProposalRespondedAt이 채워져 false(해결됨).
 * 인자는 모두 선택적 — 제안 필드를 select하지 않은 호출부(레거시)에서는 undefined → 항상 false.
 */
export function hasUnresolvedProposal(order: {
  proposedServiceDate?: Date | null;
  vendorProposalRespondedAt?: Date | null;
}): boolean {
  return order.proposedServiceDate != null && order.vendorProposalRespondedAt == null;
}

/**
 * 운영자가 고객에게 확정(CONFIRMED)할 수 있는가 — 2단계 게이트.
 * - vendorId 없음(직접 제공) ⇒ 게이트 없음, 항상 확정 가능.
 * - vendorId 있음 ⇒ 공급자가 수락(VENDOR_ACCEPTED)한 경우에만 확정 가능.
 * - 단, 수락했더라도 공급자가 제안한 대안 시간이 미해결(hasUnresolvedProposal)이면 확정 차단
 *   — 운영자가 제안을 적용/무시해 일정을 확정한 뒤에야 고객확정 가능(확장 필드 패턴).
 *   proposedServiceDate·vendorProposalRespondedAt를 select하지 않은 레거시 호출부에서는
 *   해당 인자가 undefined라 제안 게이트가 비활성(기존 동작 보존).
 */
export function canConfirmCustomer(order: {
  vendorId: string | null;
  vendorStatus: ServiceVendorStatus | null;
  proposedServiceDate?: Date | null;
  vendorProposalRespondedAt?: Date | null;
}): boolean {
  if (order.vendorId == null) return true;
  if (order.vendorStatus !== "VENDOR_ACCEPTED") return false;
  // 미해결 제안이 걸려 있으면 운영자 처리 전까지 확정 불가.
  return !hasUnresolvedProposal(order);
}

/**
 * 발주된(살아있는) PO가 공급자에게 걸려 있는가 — 취소 시 공급자 Zalo 통보 필요 판정.
 * - vendorId 있고 vendorStatus가 PENDING_VENDOR(응답 대기) 또는 VENDOR_ACCEPTED(수락·준비중)이면 true.
 * - 미발주(null)·거절(VENDOR_REJECTED)은 공급자에게 살아있는 발주가 없으므로 통보 불필요.
 */
export function vendorHasLivePo(order: {
  vendorId: string | null;
  vendorStatus: ServiceVendorStatus | null;
}): boolean {
  return (
    order.vendorId != null &&
    (order.vendorStatus === "PENDING_VENDOR" || order.vendorStatus === "VENDOR_ACCEPTED")
  );
}

/**
 * 공급자 가부 응답 가드 — 현재 vendorStatus가 PENDING_VENDOR가 아니면 throw.
 * (이미 응답했거나 발주 전 상태에서의 응답을 차단.)
 */
export function assertVendorResponse(from: ServiceVendorStatus | null): void {
  if (from !== "PENDING_VENDOR") {
    throw new InvalidVendorResponseError(from);
  }
}
