import {
  BookingStatus,
  NotificationType,
  SettlementStatus,
  type PrismaClient,
  type Settlement,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { enqueueNotification } from "@/lib/zalo";
import { postCostAccrual, postFxAdjustment, postPayout } from "@/lib/ledger";

/**
 * 최소 정산 단일 소스 (SPEC F6, 계약: docs/contracts/T4.5-settlement.md)
 *
 * - 집계 기준 = 체크아웃이 속한 월(UTC, @db.Date 규약). 대상 = CHECKED_OUT·NO_SHOW
 * - 금액 = supplierCostVnd(BigInt) 합계만 — 판매가·마진은 이 모듈에 들어오지 않는다
 * - 멱등: DRAFT는 items 전체 재생성, CONFIRMED/PAID는 불변(skip 보고) —
 *   지급 확정 후 항목 수정 금지 (fin/settlement-pattern: 정정은 차월 조정)
 * - 보증금 차감(depositDeductVnd)은 공급자 정산과 무관 (SPEC F6 규칙)
 * - 전이: DRAFT→CONFIRMED→PAID. PAID 시 paidAt + SETTLEMENT_READY 알림 큐 적재(같은 트랜잭션)
 */

/** 집계 대상 예약 상태 — CANCELLED·EXPIRED·HOLD 등은 제외 (계약 완료 기준 3) */
export const SETTLEMENT_BOOKING_STATUSES = [
  BookingStatus.CHECKED_OUT,
  BookingStatus.NO_SHOW,
] as const;

// ===================== 순수 함수 층 (단위 테스트 대상) =====================

const YEAR_MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * "YYYY-MM" → [월초, 익월초) UTC 자정 Date 쌍 (end exclusive).
 * 형식 오류·존재하지 않는 월은 RangeError — 조용한 폴백 금지 (호출부 버그)
 */
export function monthRangeUtc(yearMonth: string): { start: Date; end: Date } {
  if (!YEAR_MONTH_RE.test(yearMonth)) {
    throw new RangeError(`yearMonth 형식 오류 (YYYY-MM 필요): ${yearMonth}`);
  }
  const year = Number(yearMonth.slice(0, 4));
  const month = Number(yearMonth.slice(5, 7)); // 1~12 보장 (정규식)
  return {
    start: new Date(Date.UTC(year, month - 1, 1)),
    end: new Date(Date.UTC(year, month, 1)), // 12월이면 Date.UTC가 익년 1월로 롤오버
  };
}

export interface SettlementSourceBooking {
  bookingId: string;
  supplierId: string;
  supplierCostVnd: bigint;
}

export interface SupplierGroup {
  totalVnd: bigint;
  items: { bookingId: string; amountVnd: bigint }[];
}

/** 공급자별 그룹 + BigInt 합산 — Number 변환 절대 금지 (money-pattern) */
export function groupBySupplier(
  bookings: readonly SettlementSourceBooking[]
): Map<string, SupplierGroup> {
  const groups = new Map<string, SupplierGroup>();
  for (const b of bookings) {
    const group = groups.get(b.supplierId) ?? { totalVnd: 0n, items: [] };
    group.totalVnd += b.supplierCostVnd;
    group.items.push({ bookingId: b.bookingId, amountVnd: b.supplierCostVnd });
    groups.set(b.supplierId, group);
  }
  return groups;
}

// 지급 생애주기 (정산 2차 P2-2): DRAFT→CONFIRMED→COLLECTED→FX_ADJUSTED→PAID.
// 환차(ADJUST_FX)는 선택 단계 — 환차 없는 정산은 건너뛰고 PAID 가능. 기존 CONFIRMED 정산 호환.
export type SettlementAction = "CONFIRM" | "COLLECT" | "ADJUST_FX" | "MARK_PAID";

/** 허용 전이표 — from 배열 중 현재 상태가 있어야 통과. 그 외는 409 SettlementTransitionError */
export const SETTLEMENT_TRANSITIONS: Record<
  SettlementAction,
  { from: SettlementStatus[]; to: SettlementStatus }
> = {
  CONFIRM: { from: [SettlementStatus.DRAFT], to: SettlementStatus.CONFIRMED },
  COLLECT: { from: [SettlementStatus.CONFIRMED], to: SettlementStatus.COLLECTED },
  // 환차 반영·재조정 — COLLECTED 또는 이미 FX_ADJUSTED(금액 정정)에서 허용
  ADJUST_FX: {
    from: [SettlementStatus.COLLECTED, SettlementStatus.FX_ADJUSTED],
    to: SettlementStatus.FX_ADJUSTED,
  },
  // 지급 완료 — 환차 단계 선택적이므로 CONFIRMED·COLLECTED·FX_ADJUSTED 어디서든 가능
  MARK_PAID: {
    from: [
      SettlementStatus.CONFIRMED,
      SettlementStatus.COLLECTED,
      SettlementStatus.FX_ADJUSTED,
    ],
    to: SettlementStatus.PAID,
  },
};

export class SettlementNotFoundError extends Error {
  readonly code = "NOT_FOUND" as const;
  constructor(id: string) {
    super(`정산을 찾을 수 없습니다: ${id}`);
    this.name = "SettlementNotFoundError";
  }
}

/** 409 의미 — 현재 상태에서 허용되지 않는 액션 (역방향·건너뛰기·중복) */
export class SettlementTransitionError extends Error {
  readonly code = "INVALID_TRANSITION" as const;
  constructor(
    readonly current: SettlementStatus,
    readonly action: SettlementAction
  ) {
    super(`허용되지 않는 정산 전이: ${current} + ${action}`);
    this.name = "SettlementTransitionError";
  }
}

/** 전이 판정 — 통과 시 목표 상태 반환, 위반 시 throw (순수 함수) */
export function assertSettlementTransition(
  current: SettlementStatus,
  action: SettlementAction
): SettlementStatus {
  const transition = SETTLEMENT_TRANSITIONS[action];
  if (!transition.from.includes(current)) {
    throw new SettlementTransitionError(current, action);
  }
  return transition.to;
}

// ===================== 월 집계 (DB 층) =====================

export interface GenerateSkipReport {
  supplierId: string;
  /** 예약 단위 skip일 때만 (타 정산 귀속) */
  bookingId?: string;
  reason:
    | "SETTLEMENT_CONFIRMED" // 기존 정산 확정됨 — 불변
    | "SETTLEMENT_PAID" // 기존 정산 지급됨 — 불변
    | "BOOKING_IN_OTHER_SETTLEMENT"; // bookingId @unique — 타 월 정산에 이미 귀속
}

export interface GenerateSettlementsSummary {
  yearMonth: string;
  /** 신규 Settlement(DRAFT) 생성 수 */
  created: number;
  /** 기존 DRAFT 재집계 수 */
  updated: number;
  skipped: GenerateSkipReport[];
  /** 집계 대상 예약이 있는 공급자 수 */
  totalSuppliers: number;
}

/**
 * 월 정산 집계 (멱등) — 해당 월 체크아웃의 CHECKED_OUT·NO_SHOW 예약을
 * 공급자별 supplierCostVnd 합계로 Settlement(DRAFT) + SettlementItem 생성.
 *
 * - 기존 DRAFT: items 전체 재생성(deleteMany → create) 후 totalVnd 갱신
 * - 기존 CONFIRMED/PAID: 불변 — skip 보고
 * - 타 정산(SettlementItem.bookingId @unique)에 이미 귀속된 예약: skip 보고
 * - totalVnd === Σ items.amountVnd 는 동일 소스에서 도출되므로 구조적으로 보장
 */
export async function generateMonthlySettlements(
  yearMonth: string,
  db: PrismaClient = prisma
): Promise<GenerateSettlementsSummary> {
  const { start, end } = monthRangeUtc(yearMonth); // 형식 오류는 여기서 throw

  // 왕복 횟수 상수화 (QA D-1): 공급자별 순차 N+1 → 일괄 조회·삭제 + 병렬 쓰기.
  // 원격 DB(왕복 ~500ms)에서 공급자 수에 비례해 기본 5s 타임아웃을 넘던 문제의 근본 수정.
  return db.$transaction(
    async (tx) => {
      const bookings = await tx.booking.findMany({
        where: {
          status: { in: [...SETTLEMENT_BOOKING_STATUSES] },
          checkOut: { gte: start, lt: end },
        },
        select: {
          id: true,
          supplierCostVnd: true,
          villa: { select: { supplierId: true } },
          settlementItem: { select: { settlementId: true } },
        },
      });

      const summary: GenerateSettlementsSummary = {
        yearMonth,
        created: 0,
        updated: 0,
        skipped: [],
        totalSuppliers: 0,
      };

      // 공급자별 그룹 (skip 판정은 정산 단위 조회 후 예약 단위로 수행)
      const bySupplier = new Map<string, typeof bookings>();
      for (const b of bookings) {
        const list = bySupplier.get(b.villa.supplierId) ?? [];
        list.push(b);
        bySupplier.set(b.villa.supplierId, list);
      }
      summary.totalSuppliers = bySupplier.size;
      if (bySupplier.size === 0) return summary;

      // 기존 Settlement 일괄 조회 — 공급자 수와 무관하게 1회 왕복
      const existingSettlements = await tx.settlement.findMany({
        where: { yearMonth, supplierId: { in: [...bySupplier.keys()] } },
        select: { id: true, status: true, supplierId: true },
      });
      const existingBySupplier = new Map(
        existingSettlements.map((s) => [s.supplierId, s])
      );

      // 자기 DRAFT의 기존 items는 전체 재생성 — 먼저 일괄로 비워 bookingId 충돌 해소 (1회 왕복)
      const draftIds = existingSettlements
        .filter((s) => s.status === SettlementStatus.DRAFT)
        .map((s) => s.id);
      if (draftIds.length > 0) {
        await tx.settlementItem.deleteMany({
          where: { settlementId: { in: draftIds } },
        });
      }

      // 메모리에서 skip 판정 + 쓰기 작업 수집 (skipped 순서는 기존과 동일하게 동기 루프에서 확정)
      const writes: Promise<unknown>[] = [];
      for (const [supplierId, supplierBookings] of bySupplier) {
        const existing = existingBySupplier.get(supplierId);

        // 확정·지급 후 불변 — 재집계 금지 (fin/settlement-pattern)
        if (existing && existing.status !== SettlementStatus.DRAFT) {
          summary.skipped.push({
            supplierId,
            reason:
              existing.status === SettlementStatus.PAID
                ? "SETTLEMENT_PAID"
                : "SETTLEMENT_CONFIRMED",
          });
          continue;
        }

        // 타 정산에 이미 귀속된 예약은 제외 (bookingId @unique 충돌 방지)
        // — 자기 DRAFT items는 위에서 일괄 삭제했으므로 남은 귀속처는 전부 타 정산
        const eligible: SettlementSourceBooking[] = [];
        for (const b of supplierBookings) {
          if (b.settlementItem && b.settlementItem.settlementId !== existing?.id) {
            summary.skipped.push({
              supplierId,
              bookingId: b.id,
              reason: "BOOKING_IN_OTHER_SETTLEMENT",
            });
            continue;
          }
          eligible.push({
            bookingId: b.id,
            supplierId,
            supplierCostVnd: b.supplierCostVnd,
          });
        }

        const group = groupBySupplier(eligible).get(supplierId) ?? {
          totalVnd: 0n,
          items: [],
        };

        if (existing) {
          writes.push(
            tx.settlement.update({
              where: { id: existing.id },
              data: {
                totalVnd: group.totalVnd,
                items: { create: group.items },
              },
            })
          );
          summary.updated += 1;
        } else {
          if (group.items.length === 0) continue; // 전부 타 정산 귀속 — 빈 정산 미생성
          writes.push(
            tx.settlement.create({
              data: {
                supplierId,
                yearMonth,
                totalVnd: group.totalVnd,
                status: SettlementStatus.DRAFT,
                items: { create: group.items },
              },
            })
          );
          summary.created += 1;
        }
      }

      // 쓰기 병렬 발행 — tx 커넥션에서 파이프라인 처리, 실패 시 전체 롤백
      await Promise.all(writes);

      return summary;
    },
    // 안전망 (QA D-1): 기본 5000ms는 원격 DB 왕복 지연에 취약 — 대량 데이터 대비 여유 확보
    { timeout: 30_000, maxWait: 10_000 }
  );
}

// ===================== 상태 전이 (DB 층) =====================

/**
 * DRAFT→CONFIRMED(CONFIRM) / CONFIRMED→PAID(MARK_PAID, paidAt=now).
 * PAID 시 같은 트랜잭션에서 SETTLEMENT_READY 알림 큐 적재 (발송은 cron — T3.5).
 * 위반: SettlementNotFoundError(404) / SettlementTransitionError(409)
 */
export async function transitionSettlement(
  id: string,
  action: SettlementAction,
  actorId: string,
  db: PrismaClient = prisma,
  opts: { fxAdjustmentVnd?: bigint } = {}
): Promise<Settlement> {
  return db.$transaction(async (tx) => {
    const settlement = await tx.settlement.findUnique({
      where: { id },
      select: { id: true, status: true, supplierId: true, yearMonth: true, totalVnd: true },
    });
    if (!settlement) throw new SettlementNotFoundError(id);

    const nextStatus = assertSettlementTransition(settlement.status, action);
    const now = new Date();
    // 환차 금액 — ADJUST_FX일 때만(+이익/−손실). 0n 허용(환차 없음 명시 기록).
    const fxAdjustmentVnd =
      action === "ADJUST_FX" ? (opts.fxAdjustmentVnd ?? 0n) : undefined;

    // status 가드 — 동시 요청 경합에서 한쪽만 승리 (cleaning 패턴)
    const guarded = await tx.settlement.updateMany({
      where: { id, status: settlement.status },
      data: {
        status: nextStatus,
        ...(action === "COLLECT" ? { collectedAt: now } : {}),
        ...(action === "ADJUST_FX"
          ? { fxAdjustedAt: now, fxAdjustmentVnd }
          : {}),
        ...(action === "MARK_PAID" ? { paidAt: now } : {}),
      },
    });
    if (guarded.count !== 1) {
      throw new SettlementTransitionError(settlement.status, action);
    }

    // 복식부기 LEDGER 분개 (ADR-0018) — 전이별 멱등. totalVnd 0(빈 정산)은 분개 없음.
    if (settlement.totalVnd > 0n) {
      if (action === "COLLECT") {
        // COST_ACCRUAL: COGS +/ SUPPLIER_PAYABLE − (수납 시 원가·채무 인식)
        await postCostAccrual(tx, {
          settlementId: settlement.id,
          totalVnd: settlement.totalVnd,
          occurredAt: now,
          createdBy: actorId,
        });
      } else if (action === "MARK_PAID") {
        // COLLECT를 건너뛴 직접 지급(CONFIRMED→PAID 하위호환)이면 원가 적립이 없으므로
        // 먼저 COST_ACCRUAL을 멱등 보장(이미 있으면 no-op) 후 PAYOUT — 채무 잔액 0 유지.
        await postCostAccrual(tx, {
          settlementId: settlement.id,
          totalVnd: settlement.totalVnd,
          occurredAt: now,
          createdBy: actorId,
        });
        // PAYOUT: SUPPLIER_PAYABLE +/ CASH_VND − (채무 상계·현금 유출)
        await postPayout(tx, {
          settlementId: settlement.id,
          totalVnd: settlement.totalVnd,
          occurredAt: now,
          createdBy: actorId,
        });
      }
    }
    if (action === "ADJUST_FX") {
      // FX_ADJUSTMENT: CASH_VND ±/ FX_GAIN_LOSS ∓ (정산당 replace, 0이면 기존만 제거)
      await postFxAdjustment(tx, {
        settlementId: settlement.id,
        fxAdjustmentVnd: fxAdjustmentVnd ?? 0n,
        occurredAt: now,
        createdBy: actorId,
      });
    }

    if (action === "MARK_PAID") {
      // 공급자 자신의 정산액(원가 기반)만 — 판매가·마진 미포함 (마진 비공개 원칙)
      await enqueueNotification({
        userId: settlement.supplierId,
        type: NotificationType.SETTLEMENT_READY,
        payload: {
          settlementId: settlement.id,
          yearMonth: settlement.yearMonth,
          totalVnd: settlement.totalVnd.toString(),
        },
        db: tx,
      });
    }

    await writeAuditLog({
      db: tx,
      userId: actorId,
      action: "UPDATE",
      entity: "Settlement",
      entityId: settlement.id,
      changes: {
        status: { old: settlement.status, new: nextStatus },
        ...(action === "COLLECT" ? { collectedAt: { new: now.toISOString() } } : {}),
        ...(action === "ADJUST_FX"
          ? {
              fxAdjustedAt: { new: now.toISOString() },
              fxAdjustmentVnd: { new: (fxAdjustmentVnd ?? 0n).toString() },
            }
          : {}),
        ...(action === "MARK_PAID" ? { paidAt: { new: now.toISOString() } } : {}),
      },
    });

    return tx.settlement.findUniqueOrThrow({ where: { id } });
  });
}
