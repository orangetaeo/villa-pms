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

// ── ADMIN 주문 목록: 품목 단위 그룹핑 (구분 분리 주문을 한 구매로 표시) ────────────────
// 배경(테오): 한 구매(무료 1 + 일반 2)가 구분별로 분리 저장되어 목록에서 여러 행으로 보임.
//   데이터 분리는 유지하되 "표시"만 품목+이용일 단위로 묶는다(소비자 측 group-orders.ts와 동일 원칙).
//   순수·UI 무의존·부작용 없음. 제네릭 T로 원 라인(OrderRow)을 그대로 실어 나른다(렌더는 라인 기능 유지).

// 그룹핑 입력 최소 필드(구조적 부분집합 — OrderRow가 만족). orderAttention 입력을 포함한다.
export interface OrderGroupInput extends OrderAttentionInput {
  /** 카탈로그 품목 식별자 — 그룹 키(없으면 type 폴백). 레거시·운영자 입력 주문은 null 가능. */
  catalogItemId: string | null;
  /** 이용일 YYYY-MM-DD(없으면 null) — 그룹 키에 포함(같은 품목이라도 날짜 다르면 별도 구매). */
  serviceDate: string | null;
  /** 표시 품목명(그룹 대표 — 같은 품목이라 첫 라인 명칭과 동일). */
  nameKo: string;
  /** 판매가 — VND는 bigint 문자열(없으면 null), KRW는 원 단위 정수. */
  priceKrw: number;
  priceVnd: string | null;
}

// 대표 상태 우선순위: 요청 > 확정(CONFIRMED) > 제공완료(DELIVERED) > 취소. 처리필요를 위로.
const REP_STATUS_PRIORITY: readonly ServiceOrderStatus[] = [
  "REQUESTED",
  "CONFIRMED",
  "DELIVERED",
  "CANCELLED",
];

function representativeStatus(
  orders: readonly { status: ServiceOrderStatus }[]
): ServiceOrderStatus {
  const present = new Set(orders.map((o) => o.status));
  for (const s of REP_STATUS_PRIORITY) if (present.has(s)) return s;
  return "CANCELLED"; // 빈 그룹 방어(실제로는 최소 1건)
}

export interface OrderGroup<T extends OrderGroupInput = OrderGroupInput> {
  /** 그룹 키 = (catalogItemId ?? type) + serviceDate. */
  key: string;
  /** 표시 품목명(첫 라인 기준). */
  name: string;
  /** 그룹 공통 이용일(키에 포함되므로 그룹 내 라인 전부 동일). */
  serviceDate: string | null;
  /** 소속 라인(입력 순서 보존). */
  orders: T[];
  /** 총수량 합(라인 quantity Σ). */
  totalQuantity: number;
  /** 판매가 합 — KRW 원 단위. */
  totalPriceKrw: number;
  /** 판매가 합 — VND bigint 문자열. */
  totalPriceVnd: string;
  /** 대표 상태 배지(우선순위 요청>확정>제공완료>취소). */
  representativeStatus: ServiceOrderStatus;
  /** 라인 orderAttention OR 승격(그룹 헤더 처리필요 신호). */
  attention: OrderAttention;
  /** attention 세 신호 OR — 기본 펼침 판단용. */
  hasAttention: boolean;
  /** TICKET 라인이 하나라도 있는지 — 티켓 카운터 표시 게이트. */
  hasTicket: boolean;
  /** TICKET 라인 발행 수 Σ / 필요(수량) Σ. */
  ticketIssued: number;
  ticketNeeded: number;
}

/**
 * 주문 라인 배열 → 품목+이용일 그룹 배열. 순수·부작용 없음.
 *   - 그룹 키: (catalogItemId ?? type) + serviceDate. 첫 등장 순서 보존(입력 정렬 유지).
 *   - 집계: 총수량·판매가 합(KRW/VND)·대표 상태·attention OR·티켓 카운터 합(TICKET 라인만).
 *   ★필터가 적용된 라인 배열을 넘기면 그룹 집계도 그 부분집합 기준(헤더=보이는 라인 요약).
 */
export function groupAdminOrders<T extends OrderGroupInput>(
  orders: readonly T[]
): OrderGroup<T>[] {
  const groups: OrderGroup<T>[] = [];
  const byKey = new Map<string, OrderGroup<T>>();
  const vndByKey = new Map<string, bigint>();

  for (const o of orders) {
    // NUL 구분자로 (품목 ?? type) + 이용일 결합 — 값 안에 나타날 수 없어 충돌 없음.
    const key = `${o.catalogItemId ?? o.type} ${o.serviceDate ?? ""}`;
    let g = byKey.get(key);
    if (!g) {
      g = {
        key,
        name: o.nameKo,
        serviceDate: o.serviceDate,
        orders: [],
        totalQuantity: 0,
        totalPriceKrw: 0,
        totalPriceVnd: "0",
        representativeStatus: "CANCELLED",
        attention: { requested: false, unresolvedProposal: false, ticketShort: false },
        hasAttention: false,
        hasTicket: false,
        ticketIssued: 0,
        ticketNeeded: 0,
      };
      byKey.set(key, g);
      vndByKey.set(key, 0n);
      groups.push(g);
    }
    g.orders.push(o);
    g.totalQuantity += o.quantity;
    g.totalPriceKrw += o.priceKrw;
    vndByKey.set(key, vndByKey.get(key)! + (o.priceVnd ? BigInt(o.priceVnd) : 0n));
    const a = orderAttention(o);
    if (a.requested) g.attention.requested = true;
    if (a.unresolvedProposal) g.attention.unresolvedProposal = true;
    if (a.ticketShort) g.attention.ticketShort = true;
    if (o.type === "TICKET") {
      g.hasTicket = true;
      g.ticketIssued += o.ticketUrls.length;
      g.ticketNeeded += o.quantity;
    }
  }

  for (const g of groups) {
    g.totalPriceVnd = vndByKey.get(g.key)!.toString();
    g.hasAttention =
      g.attention.requested || g.attention.unresolvedProposal || g.attention.ticketShort;
    g.representativeStatus = representativeStatus(g.orders);
  }

  return groups;
}
