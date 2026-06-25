import {
  BookingStatus,
  DepositStatus,
  ServiceOrderStatus,
  PrismaClient,
  type Booking,
  type CheckOutRecord,
} from "@prisma/client";
import { createCheckoutCleaningTask } from "./cleaning";
import { writeAuditLog } from "./audit-log";
import { computeGuestBill, type GuestSettlementMethodValue } from "./checkout-settlement";

/**
 * 체크아웃 단일 소스 (SPEC F4 체크아웃 1~4)
 *
 * - CHECKED_IN → CHECKED_OUT 전이 (status 가드 — 중복 체크아웃 차단)
 * - 보증금 상태기계: 파손 없음 → REFUNDED / 파손 → PARTIAL_DEDUCTED + 차감액(VND BigInt) 필수
 * - 같은 트랜잭션에서 createCheckoutCleaningTask 호출 — CleaningTask(CHECKOUT) 생성과
 *   villa.isSellable=false(게이트 닫기)가 체크아웃과 원자적으로 묶인다
 * - 미니바 소모분은 deductionVnd(보증금 차감)에 합산 반영(ADR-0003) + 품목별 판매 라인을
 *   CheckoutMinibarLine으로 저장(미니바 매출·마진 통계 소스). 가격·원가는 서버가 MinibarItem에서
 *   조회해 스냅샷(클라가 보낸 가격 신뢰 금지 — 무결성·마진 비공개). minibarChargeVnd=ΣlineVnd.
 */

export class CheckoutRejectedError extends Error {
  constructor(public readonly reason: "NOT_CHECKED_IN" | "ALREADY_CHECKED_OUT" | "NOT_FOUND", detail?: string) {
    super(detail ? `${reason}: ${detail}` : reason);
    this.name = "CheckoutRejectedError";
  }
}

// ===================== 순수 함수 층 (단위 테스트 대상) =====================

export interface DepositOutcome {
  depositStatus: DepositStatus;
  deductionVnd: bigint | null;
}

/**
 * 보증금 처리 판정 — 파손 여부·차감액·현재 보증금 상태의 정합 검증 (SPEC F4 체크아웃 3)
 * - HELD(수취): 파손⇒차감액(>0) 필수→PARTIAL_DEDUCTED / 무파손⇒차감 금지→REFUNDED
 * - NONE(미수취): 상태 NONE 유지 — REFUNDED 둔갑 차단 (T3.1 인계 메모 1, T3.2 계약 결정 4).
 *   파손 시 deductionVnd는 보증금 차감이 아닌 청구 근거로 기록 허용(선택)
 */
export function resolveDepositOutcome(
  damageFound: boolean,
  deductionVnd: bigint | null | undefined,
  currentDepositStatus: DepositStatus = DepositStatus.HELD
): DepositOutcome {
  if (currentDepositStatus === DepositStatus.NONE) {
    if (!damageFound && deductionVnd != null && deductionVnd !== 0n) {
      throw new RangeError("파손이 없으면 차감액을 기록할 수 없습니다");
    }
    if (damageFound && deductionVnd != null && deductionVnd <= 0n) {
      throw new RangeError("차감액(청구 근거)은 0보다 커야 합니다");
    }
    return {
      depositStatus: DepositStatus.NONE,
      deductionVnd: damageFound && deductionVnd ? deductionVnd : null,
    };
  }
  if (damageFound) {
    if (deductionVnd == null || deductionVnd <= 0n) {
      throw new RangeError("파손 발견 시 차감액(VND)은 0보다 커야 합니다");
    }
    return { depositStatus: DepositStatus.PARTIAL_DEDUCTED, deductionVnd };
  }
  if (deductionVnd != null && deductionVnd !== 0n) {
    throw new RangeError("파손이 없으면 차감액을 기록할 수 없습니다 (전액 환불)");
  }
  return { depositStatus: DepositStatus.REFUNDED, deductionVnd: null };
}

/** 체크아웃 미니바 소모 입력(클라 전송) — 가격은 받지 않는다(서버가 스냅샷 재계산). */
export interface MinibarLineInput {
  minibarItemId: string;
  /** 소모 수량(정수 ≥ 0, 0은 라인 미생성) */
  consumedQty: number;
  /** 비치 수량 스냅샷("남은 수량" 입력 UX 대비) — 정수 ≥ 0 */
  stockedQty: number;
}

export interface CompleteCheckoutInput {
  bookingId: string;
  /** 공간별 상태 사진 (기준 사진과 비교용) — 1장 이상 */
  photoUrls: string[];
  damageFound: boolean;
  damageNote?: string;
  damagePhotoUrls?: string[];
  deductionVnd?: bigint | null;
  /** 미니바 소모 라인(consumed>0만 전송 권장 — 0/음수는 서버에서 무시) */
  minibarLines?: MinibarLineInput[];
  /** 게스트 통합정산(미니바+확정옵션) 수납 — 입력 시 결제수단·수납시각 기록 (ADR-0019 S4) */
  settlement?: { method: GuestSettlementMethodValue; note?: string | null } | null;
  actorUserId: string;
  now: Date;
}

// ===================== DB 층 =====================

export async function completeCheckout(
  prisma: PrismaClient,
  input: CompleteCheckoutInput
): Promise<{ booking: Booking; record: CheckOutRecord }> {
  if (input.photoUrls.length < 1) {
    throw new RangeError("체크아웃 상태 사진은 1장 이상 필요합니다");
  }
  if (input.damageFound && !input.damageNote?.trim() && !(input.damagePhotoUrls?.length)) {
    throw new RangeError("파손 발견 시 상세 내용 또는 증빙 사진이 필요합니다");
  }

  return prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({
      where: { id: input.bookingId },
      select: { id: true, status: true, depositStatus: true, villaId: true },
    });
    if (!booking) throw new CheckoutRejectedError("NOT_FOUND");
    if (booking.status === BookingStatus.CHECKED_OUT) {
      throw new CheckoutRejectedError("ALREADY_CHECKED_OUT");
    }
    if (booking.status !== BookingStatus.CHECKED_IN) {
      throw new CheckoutRejectedError("NOT_CHECKED_IN", `현재 상태: ${booking.status}`);
    }

    // 보증금 판정은 현재 상태 기준 — NONE(미수취)은 NONE 유지 (T3.3 핫픽스)
    const outcome = resolveDepositOutcome(
      input.damageFound,
      input.deductionVnd,
      booking.depositStatus
    );

    // status 가드 — 동시 체크아웃 경합에서 한쪽만 승리
    const guarded = await tx.booking.updateMany({
      where: { id: booking.id, status: BookingStatus.CHECKED_IN },
      data: {
        status: BookingStatus.CHECKED_OUT,
        depositStatus: outcome.depositStatus,
        depositDeductVnd: outcome.deductionVnd,
      },
    });
    if (guarded.count !== 1) throw new CheckoutRejectedError("ALREADY_CHECKED_OUT");

    const record = await tx.checkOutRecord.create({
      data: {
        bookingId: booking.id,
        photoUrls: input.photoUrls,
        damageFound: input.damageFound,
        // 파손 아님이면 파손 필드 정규화 — REFUNDED 기록에 메모·사진 잔존 차단 (QA D4)
        damageNote: input.damageFound ? input.damageNote?.trim() || null : null,
        damagePhotoUrls: input.damageFound ? input.damagePhotoUrls ?? [] : [],
        deductionVnd: outcome.deductionVnd,
        refundedAt: input.now, // 환불(전액/차감 후) 기록 시각 — 실제 송금은 외부 처리 (SPEC: 기록만)
        createdBy: input.actorUserId,
      },
    });

    // ── 미니바 판매 라인 캡처 (작업 B) ─────────────────────────────────
    // 서버가 MinibarItem을 조회해 unitPriceVnd·costVnd·nameKo를 스냅샷한다(클라 가격 신뢰 금지).
    //   lineVnd = consumedQty × unitPriceVnd, lineCostVnd = costVnd ? consumedQty × costVnd : null.
    //   minibarChargeVnd = ΣlineVnd. 0건이면 null(라인 미생성). BigInt — 부동소수점 금지.
    let minibarChargeVnd: bigint | null = null;
    const validLines = (input.minibarLines ?? []).filter(
      (l) => Number.isInteger(l.consumedQty) && l.consumedQty > 0
    );
    if (validLines.length > 0) {
      const itemIds = [...new Set(validLines.map((l) => l.minibarItemId))];
      const items = await tx.minibarItem.findMany({
        where: { id: { in: itemIds } },
        select: { id: true, nameKo: true, unitPriceVnd: true, costVnd: true },
      });
      const itemMap = new Map(items.map((i) => [i.id, i]));
      // 알 수 없는 itemId는 라우트 zod에서 1차 거부하나, 방어적으로 여기서도 차단
      const unknown = itemIds.filter((id) => !itemMap.has(id));
      if (unknown.length > 0) {
        throw new RangeError(`알 수 없는 미니바 품목: ${unknown.join(", ")}`);
      }

      let chargeSum = 0n;
      for (const l of validLines) {
        const item = itemMap.get(l.minibarItemId)!;
        const qty = BigInt(l.consumedQty);
        const lineVnd = item.unitPriceVnd * qty;
        const lineCostVnd = item.costVnd != null ? item.costVnd * qty : null;
        chargeSum += lineVnd;
        await tx.checkoutMinibarLine.create({
          data: {
            checkOutRecordId: record.id,
            minibarItemId: item.id,
            nameKo: item.nameKo,
            stockedQty: Number.isInteger(l.stockedQty) && l.stockedQty >= 0 ? l.stockedQty : 0,
            consumedQty: l.consumedQty,
            unitPriceVnd: item.unitPriceVnd,
            costVnd: item.costVnd,
            lineVnd,
            lineCostVnd,
          },
        });
        // 실재고 차감 — 소모분을 이동 원장에 CONSUME(−)로 기록 (ADR-0019 S1).
        //   현재고 = ΣqtyDelta이므로 별도 차감 컬럼 갱신 불필요. 출처 예약(bookingId) 보존.
        await tx.minibarStockMovement.create({
          data: {
            villaId: booking.villaId,
            minibarItemId: item.id,
            type: "CONSUME",
            qtyDelta: -l.consumedQty,
            bookingId: booking.id,
            createdBy: input.actorUserId,
          },
        });
      }
      minibarChargeVnd = chargeSum;
      // 비정규화 캐시 갱신 — record는 이미 생성됐으므로 update로 합계 반영
      await tx.checkOutRecord.update({
        where: { id: record.id },
        data: { minibarChargeVnd },
      });
    }

    // ── 게스트 통합 청구 합산·정산 (ADR-0019 S4) ─────────────────────────
    // 미니바 소비 + 확정 부가옵션(CONFIRMED|DELIVERED). 통화별 분리(VND/KRW 합산 금지).
    //   settlement 입력 시 결제수단(현금/계좌이체/기타)·수납시각 기록. 보증금 차감과는 별개.
    const svcOrders = await tx.serviceOrder.findMany({
      where: {
        bookingId: booking.id,
        status: { in: [ServiceOrderStatus.CONFIRMED, ServiceOrderStatus.DELIVERED] },
      },
      select: { priceKrw: true, priceVnd: true },
    });
    const bill = computeGuestBill(minibarChargeVnd, svcOrders);
    await tx.checkOutRecord.update({
      where: { id: record.id },
      data: {
        guestChargeVnd: bill.totalVnd > 0n ? bill.totalVnd : null,
        guestChargeKrw: bill.totalKrw > 0 ? bill.totalKrw : null,
        ...(input.settlement
          ? {
              settlementMethod: input.settlement.method,
              settledAt: input.now,
              settlementNote: input.settlement.note?.trim() || null,
            }
          : {}),
      },
    });

    // 게이트 닫기 + 청소 태스크 생성 — 체크아웃과 원자적 (SPEC F4 체크아웃 4)
    await createCheckoutCleaningTask(tx, {
      bookingId: booking.id,
      actorUserId: input.actorUserId,
      now: input.now,
    });

    await writeAuditLog({
      db: tx,
      userId: input.actorUserId,
      action: "UPDATE",
      entity: "Booking",
      entityId: booking.id,
      changes: {
        status: { old: BookingStatus.CHECKED_IN, new: BookingStatus.CHECKED_OUT },
        depositStatus: { new: outcome.depositStatus },
        // BigInt는 Json 컬럼에 직접 못 들어감 — 문자열 기록
        depositDeductVnd: { new: outcome.deductionVnd?.toString() ?? null },
        checkOutRecordId: { new: record.id },
        // 미니바 판매 합계(라인 캡처) — BigInt는 문자열로 기록
        minibarChargeVnd: { new: minibarChargeVnd?.toString() ?? null },
      },
    });

    const updated = await tx.booking.findUniqueOrThrow({ where: { id: booking.id } });
    // record는 minibar·게스트청구 update 전 스냅샷이므로 최신본 재조회(항상 update됨)
    const finalRecord = await tx.checkOutRecord.findUniqueOrThrow({ where: { id: record.id } });
    return { booking: updated, record: finalRecord };
  });
}
