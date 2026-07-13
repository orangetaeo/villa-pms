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
import {
  computeGuestBill,
  normalizeSettlementLines,
  type GuestSettlementMethodValue,
  type SettlementLineInput,
} from "./checkout-settlement";
import { planRecover } from "./minibar-inventory";

/**
 * 체크아웃 단일 소스 (SPEC F4 체크아웃 1~4)
 *
 * - CHECKED_IN → CHECKED_OUT 전이 (status 가드 — 중복 체크아웃 차단)
 * - 보증금 상태기계: (파손차감 + 보증금 상계) 없음 → REFUNDED / 있으면 → PARTIAL_DEDUCTED (ADR-0041)
 * - 같은 트랜잭션에서 createCheckoutCleaningTask 호출 — CleaningTask(CHECKOUT) 생성과
 *   villa.isSellable=false(게이트 닫기)가 체크아웃과 원자적으로 묶인다
 * - 미니바 소모분은 게스트 청구(guestChargeVnd)로만 1회 계상한다(ADR-0041 이중 계상 수정).
 *   품목별 판매 라인을 CheckoutMinibarLine으로 저장(미니바 매출·마진 통계 소스). 가격·원가는 서버가
 *   MinibarItem에서 조회해 스냅샷(클라가 보낸 가격 신뢰 금지 — 무결성·마진 비공개). minibarChargeVnd=ΣlineVnd.
 *   ⚠ deductionVnd는 "파손 차감액만"의 의미다 — 미니바를 보증금으로 받으려면 DEPOSIT 수납 라인(상계)으로 처리.
 * - 보증금 상계(DEPOSIT 수납 라인, ADR-0041): 파손·미니바·부가서비스 청구를 보증금에서 차감(가감산).
 *   서버가 Booking(depositStatus/depositAmount/depositCurrency)을 조회해 검증(클라 신뢰 금지).
 */

export class CheckoutRejectedError extends Error {
  constructor(public readonly reason: "NOT_CHECKED_IN" | "ALREADY_CHECKED_OUT" | "NOT_FOUND", detail?: string) {
    super(detail ? `${reason}: ${detail}` : reason);
    this.name = "CheckoutRejectedError";
  }
}

/**
 * 보증금 상계(DEPOSIT 수납 라인) 검증 실패 — 라우트가 code로 400 구분 응답한다 (ADR-0041).
 *   - DEPOSIT_NOT_HELD: 보증금 미수취(depositStatus=NONE)인데 DEPOSIT 라인 존재
 *   - DEPOSIT_NOT_VND: 보증금이 VND HELD 상태가 아님(상계 불가)
 *   - DEPOSIT_OFFSET_EXCEEDS: 상계액이 (보증금 − 파손차감) 잔액을 초과 / 보증금 금액 미기록
 */
export class DepositOffsetError extends Error {
  constructor(
    public readonly code: "DEPOSIT_NOT_HELD" | "DEPOSIT_NOT_VND" | "DEPOSIT_OFFSET_EXCEEDS",
    detail?: string
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "DepositOffsetError";
  }
}

// ===================== 순수 함수 층 (단위 테스트 대상) =====================

export interface DepositOutcome {
  depositStatus: DepositStatus;
  deductionVnd: bigint | null;
}

/**
 * 보증금 처리 판정 — 파손 차감·보증금 상계·현재 보증금 상태의 정합 검증 (SPEC F4 체크아웃 3, ADR-0041)
 * - HELD(수취): (파손차감 + 상계) > 0 ⇒ PARTIAL_DEDUCTED / == 0 ⇒ REFUNDED.
 *     파손 시 파손차감(>0) 필수·무파손 시 파손차감 금지(기존 규칙 유지).
 *     반환 deductionVnd = 파손차감 + 상계 합(depositDeductVnd 저장용 — 보증금에서 빠진 총액, 표시 하위호환).
 * - NONE(미수취): 상태 NONE 유지 — REFUNDED 둔갑 차단 (T3.1 인계 메모 1, T3.2 계약 결정 4).
 *     DEPOSIT 라인(상계 > 0) 존재 시 → DepositOffsetError("DEPOSIT_NOT_HELD") (차감할 보증금이 없음).
 *     파손 시 deductionVnd는 보증금 차감이 아닌 청구 근거로 기록 허용(선택).
 * @param depositOffsetVnd ΣDEPOSIT 라인(보증금 상계액, VND). 기본 0n.
 */
export function resolveDepositOutcome(
  damageFound: boolean,
  deductionVnd: bigint | null | undefined,
  currentDepositStatus: DepositStatus = DepositStatus.HELD,
  depositOffsetVnd: bigint = 0n
): DepositOutcome {
  if (currentDepositStatus === DepositStatus.NONE) {
    // 미수취 보증금은 상계 대상이 없음 — DEPOSIT 라인은 라우트 400
    if (depositOffsetVnd > 0n) {
      throw new DepositOffsetError("DEPOSIT_NOT_HELD", "보증금을 수취하지 않아 상계할 수 없습니다");
    }
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
  // HELD — 파손차감 정합 검증(기존 규칙 유지)
  const damageDeduct = deductionVnd ?? 0n;
  if (damageFound) {
    if (deductionVnd == null || deductionVnd <= 0n) {
      throw new RangeError("파손 발견 시 차감액(VND)은 0보다 커야 합니다");
    }
  } else if (deductionVnd != null && deductionVnd !== 0n) {
    throw new RangeError("파손이 없으면 차감액을 기록할 수 없습니다 (전액 환불)");
  }
  // 보증금에서 빠진 총액 = 파손차감 + 상계. > 0이면 부분 차감, 0이면 전액 환불.
  const totalDeduct = damageDeduct + depositOffsetVnd;
  if (totalDeduct > 0n) {
    return { depositStatus: DepositStatus.PARTIAL_DEDUCTED, deductionVnd: totalDeduct };
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
  /** 공간별 상태 사진 — 정책 변경(2026-07-10)으로 선택. 신규 체크아웃은 보내지 않고 빈 배열로 저장. */
  photoUrls?: string[];
  damageFound: boolean;
  damageNote?: string;
  damagePhotoUrls?: string[];
  deductionVnd?: bigint | null;
  /** 미니바 소모 라인(consumed>0만 전송 권장 — 0/음수는 서버에서 무시) */
  minibarLines?: MinibarLineInput[];
  /**
   * 게스트 통합정산(미니바+확정옵션) 수납 — 입력 시 결제수단·수납시각 기록 (ADR-0019 S4).
   *   ★ 결제수단 혼합(분할) 지원 (T-checkout-mixed): lines[]로 수단×통화×금액을 받아
   *     서버가 통화별 합계(settledVnd/Krw/Usd)와 대표 수단(1종=그 수단·2종↑=MIXED)을 파생한다.
   *   하위호환: lines 없이 amounts+method(구 shape)면 amounts를 그 단일 수단의 라인들로 변환(0/null 통화는 라인 미생성).
   *     lines·amounts 둘 다 없고 method만이면 기존처럼 수단·수납시각만 기록(금액 없음).
   *   amounts: 통화별 실수납액. 원본 통화 그대로(환산 저장 금지). VND=BigInt(동), KRW/USD=정수. 음수·비정수는 RangeError.
   */
  settlement?: {
    method?: GuestSettlementMethodValue | null;
    note?: string | null;
    lines?: SettlementLineInput[] | null;
    amounts?: { vnd?: bigint | null; krw?: number | null; usd?: number | null } | null;
  } | null;
  /** 수납 환율 스냅샷 — 라우트가 getDailyRates로 조회해 전달(클라 신뢰 금지). 없으면 null */
  settlementFx?: { date: string; vndPerKrw: number; vndPerUsd: number } | null;
  actorUserId: string;
  now: Date;
}

/**
 * 수납 입력(settlement)에서 유효 라인 배열을 해석한다 — 순수. (T-checkout-mixed)
 *   ① lines가 있으면 lines 우선.
 *   ② lines 없고 amounts+method(구 shape)면 amounts를 그 단일 수단의 라인들로 변환(0/null 통화는 라인 미생성).
 *   ③ 둘 다 없으면 빈 배열(수단·수납시각만 기록하는 기존 동작 — 라인 없음).
 *   음수·비정수 금액 검증은 호출부의 amounts 검증 + normalizeSettlementLines가 담당.
 */
export function resolveSettlementLines(
  settlement: CompleteCheckoutInput["settlement"]
): SettlementLineInput[] {
  if (!settlement) return [];
  if (settlement.lines && settlement.lines.length > 0) {
    return settlement.lines;
  }
  const amounts = settlement.amounts;
  const method = settlement.method;
  if (amounts && method) {
    const out: SettlementLineInput[] = [];
    if (amounts.vnd != null && amounts.vnd > 0n) out.push({ method, currency: "VND", amount: amounts.vnd });
    if (amounts.krw != null && amounts.krw > 0) out.push({ method, currency: "KRW", amount: BigInt(amounts.krw) });
    if (amounts.usd != null && amounts.usd > 0) out.push({ method, currency: "USD", amount: BigInt(amounts.usd) });
    return out;
  }
  return [];
}

// ===================== DB 층 =====================

export async function completeCheckout(
  prisma: PrismaClient,
  input: CompleteCheckoutInput
): Promise<{ booking: Booking; record: CheckOutRecord }> {
  // 체크아웃 상태 사진은 정책 변경(2026-07-10)으로 더 이상 필수가 아니다 — 파손 시에만 증빙 입력.
  if (input.damageFound && !input.damageNote?.trim() && !(input.damagePhotoUrls?.length)) {
    throw new RangeError("파손 발견 시 상세 내용 또는 증빙 사진이 필요합니다");
  }
  // 게스트 수납 분할 금액 검증 — 음수·비정수 차단(원본 통화 그대로 저장, 환산 저장 금지)
  const settlementAmounts = input.settlement?.amounts ?? null;
  if (settlementAmounts) {
    if (settlementAmounts.vnd != null && settlementAmounts.vnd < 0n) {
      throw new RangeError("수납액(VND)은 0 이상이어야 합니다");
    }
    if (
      settlementAmounts.krw != null &&
      (!Number.isInteger(settlementAmounts.krw) || settlementAmounts.krw < 0)
    ) {
      throw new RangeError("수납액(KRW)은 0 이상 정수여야 합니다");
    }
    if (
      settlementAmounts.usd != null &&
      (!Number.isInteger(settlementAmounts.usd) || settlementAmounts.usd < 0)
    ) {
      throw new RangeError("수납액(USD)은 0 이상 정수여야 합니다");
    }
  }

  // 수납 라인 해석·정규화 (혼합 수납) — 검증(0·음수·13라인↑)·(수단,통화) 병합·통화별 합계·대표 수단 파생.
  //   트랜잭션 진입 전에 선반영해 잘못된 입력이 record를 만들었다가 롤백되는 낭비를 막는다.
  const resolvedSettlementLines = resolveSettlementLines(input.settlement);
  const normalizedSettlement = normalizeSettlementLines(resolvedSettlementLines);

  return prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({
      where: { id: input.bookingId },
      select: {
        id: true,
        status: true,
        depositStatus: true,
        depositAmount: true,
        depositCurrency: true,
        villaId: true,
        checkOut: true,
        seller: true,
      },
    });
    if (!booking) throw new CheckoutRejectedError("NOT_FOUND");
    if (booking.status === BookingStatus.CHECKED_OUT) {
      throw new CheckoutRejectedError("ALREADY_CHECKED_OUT");
    }
    if (booking.status !== BookingStatus.CHECKED_IN) {
      throw new CheckoutRejectedError("NOT_CHECKED_IN", `현재 상태: ${booking.status}`);
    }

    // ── 보증금 상계(DEPOSIT 수납 라인) 서버 검증 (ADR-0041) ─────────────────
    //   보증금 원천은 서버가 Booking에서 조회한다(클라 신뢰 금지). 상계액이 있으면:
    //     · NONE(미수취) → DEPOSIT_NOT_HELD
    //     · HELD 아님 또는 depositCurrency≠VND → DEPOSIT_NOT_VND
    //     · depositAmount 미기록(null) 또는 ΣDEPOSIT > (depositAmount − 파손차감) → DEPOSIT_OFFSET_EXCEEDS
    const depositOffsetVnd = normalizedSettlement.depositOffsetVnd; // ≥ 0n (VND)
    if (depositOffsetVnd > 0n) {
      if (booking.depositStatus === DepositStatus.NONE) {
        throw new DepositOffsetError("DEPOSIT_NOT_HELD", "보증금을 수취하지 않아 상계할 수 없습니다");
      }
      if (booking.depositStatus !== DepositStatus.HELD || booking.depositCurrency !== "VND") {
        throw new DepositOffsetError(
          "DEPOSIT_NOT_VND",
          "보증금이 VND HELD 상태가 아니어서 상계할 수 없습니다"
        );
      }
      if (booking.depositAmount == null) {
        throw new DepositOffsetError(
          "DEPOSIT_OFFSET_EXCEEDS",
          "보증금 금액이 기록되지 않아 상계할 수 없습니다"
        );
      }
      // depositAmount는 Int?(동 단위) — 상계·잔액 계산은 BigInt로 (부동소수점·정밀도 금지)
      const damageDeduct = input.deductionVnd ?? 0n;
      const available = BigInt(booking.depositAmount) - damageDeduct;
      if (depositOffsetVnd > available) {
        throw new DepositOffsetError("DEPOSIT_OFFSET_EXCEEDS", "상계액이 보증금 잔액을 초과합니다");
      }
    }

    // 보증금 판정은 현재 상태 기준 — NONE(미수취)은 NONE 유지 (T3.3 핫픽스).
    //   상계액을 넘겨 (파손차감 + 상계) 합으로 REFUNDED/PARTIAL_DEDUCTED 판정 (ADR-0041).
    const outcome = resolveDepositOutcome(
      input.damageFound,
      input.deductionVnd,
      booking.depositStatus,
      depositOffsetVnd
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
        photoUrls: input.photoUrls ?? [],
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

    // ── 미니바 전환 자동 회수 (ADR-0019 Phase 2 / ADR-0021 D6) ───────────
    // 미니바 = 운영자 재고. 이번 체크아웃으로 빌라가 비고, 다음 예약이 공급자 직접판매
    //   (seller=SUPPLIER)면 우리가 운영하지 않는 판매에 재고를 남기지 않도록 전량 회수한다.
    //   다음 = OPERATOR / 없음(미정)이면 회수하지 않는다(자동 RESTOCK은 범위 밖 — 수동 유지).
    //   ★ RECOVER 이동은 원가 없음(unitCostVnd 미설정) — 단순 수량 회수 원장(마진 비공개 원칙2).
    const nextBooking = await tx.booking.findFirst({
      where: {
        villaId: booking.villaId,
        id: { not: booking.id },
        status: { in: [BookingStatus.HOLD, BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN] },
        checkIn: { gte: booking.checkOut },
      },
      orderBy: { checkIn: "asc" },
      select: { seller: true },
    });
    let recoveredItemCount = 0;
    if (nextBooking?.seller === "SUPPLIER") {
      // 방금 CONSUME 포함, 품목별 현재고(ΣqtyDelta) 집계 → 양수만 회수
      const onHandRows = await tx.minibarStockMovement.groupBy({
        by: ["minibarItemId"],
        where: { villaId: booking.villaId },
        _sum: { qtyDelta: true },
      });
      const recoverLines = planRecover(
        onHandRows.map((r) => ({
          minibarItemId: r.minibarItemId,
          onHand: r._sum.qtyDelta ?? 0,
        }))
      );
      for (const line of recoverLines) {
        await tx.minibarStockMovement.create({
          data: {
            villaId: booking.villaId,
            minibarItemId: line.minibarItemId,
            type: "RECOVER",
            qtyDelta: line.qtyDelta,
            bookingId: booking.id,
            createdBy: input.actorUserId,
            note: "전환 회수: 다음 공급자 직접판매",
          },
        });
      }
      recoveredItemCount = recoverLines.length;
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
    // 수납 라인(수단×통화) — normalize 결과가 통화별 합계·대표 수단의 단일 원천.
    //   라인이 있으면 CheckoutSettlementLine 원장 생성 + settlementMethod=derivedMethod(1종=그 수단·2종↑=MIXED).
    //   라인이 없으면(구 shape의 method-only 등) 기존처럼 수단·수납시각만 기록.
    const settledVnd = normalizedSettlement.settledVnd;
    const settledKrw = normalizedSettlement.settledKrw;
    const settledUsd = normalizedSettlement.settledUsd;
    const settlementLines = normalizedSettlement.lines;
    const hasSettlementLines = settlementLines.length > 0;
    // 양수 수납액이 하나라도 있으면 환율 스냅샷 동봉(표시·검증 근거).
    const hasSettledAmount = settledVnd != null || settledKrw != null || settledUsd != null;

    if (hasSettlementLines) {
      await tx.checkoutSettlementLine.createMany({
        data: settlementLines.map((l) => ({
          checkOutRecordId: record.id,
          method: l.method,
          currency: l.currency,
          amount: l.amount,
        })),
      });
    }

    await tx.checkOutRecord.update({
      where: { id: record.id },
      data: {
        guestChargeVnd: bill.totalVnd > 0n ? bill.totalVnd : null,
        guestChargeKrw: bill.totalKrw > 0 ? bill.totalKrw : null,
        ...(input.settlement
          ? {
              // 라인 있으면 파생 수단(MIXED 가능), 없으면 구 shape의 단일 method(없으면 null)
              settlementMethod: hasSettlementLines
                ? normalizedSettlement.derivedMethod
                : input.settlement.method ?? null,
              settledAt: input.now,
              settlementNote: input.settlement.note?.trim() || null,
              settledVnd,
              settledKrw,
              settledUsd,
              settlementFx:
                hasSettledAmount && input.settlementFx ? input.settlementFx : undefined,
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
        // depositDeductVnd = 파손차감 + 보증금 상계 합(보증금에서 빠진 총액, ADR-0041)
        depositDeductVnd: { new: outcome.deductionVnd?.toString() ?? null },
        // 보증금 상계액(ΣDEPOSIT 라인) — 파손차감과 분리 기록(문자열)
        depositOffsetVnd: { new: depositOffsetVnd.toString() },
        checkOutRecordId: { new: record.id },
        // 미니바 판매 합계(라인 캡처) — BigInt는 문자열로 기록
        minibarChargeVnd: { new: minibarChargeVnd?.toString() ?? null },
        // 게스트 통화별 실수납액 — BigInt(VND)는 문자열, KRW/USD는 정수
        ...(input.settlement
          ? {
              settledVnd: { new: settledVnd?.toString() ?? null },
              settledKrw: { new: settledKrw ?? null },
              settledUsd: { new: settledUsd ?? null },
              // 수납 라인(수단×통화) 요약 — BigInt 금액은 문자열. 라인 없으면 미기록.
              ...(hasSettlementLines
                ? {
                    settlementLines: {
                      new: settlementLines.map((l) => ({
                        method: l.method,
                        currency: l.currency,
                        amount: l.amount.toString(),
                      })),
                    },
                  }
                : {}),
            }
          : {}),
        // 전환 회수(RECOVER) 발생 시 회수 품목 수만 기록 — 원가·수량 상세는 원장에 (마진 비공개)
        ...(recoveredItemCount > 0
          ? { minibarRecoveredItems: { new: recoveredItemCount } }
          : {}),
      },
    });

    const updated = await tx.booking.findUniqueOrThrow({ where: { id: booking.id } });
    // record는 minibar·게스트청구 update 전 스냅샷이므로 최신본 재조회(항상 update됨)
    const finalRecord = await tx.checkOutRecord.findUniqueOrThrow({ where: { id: record.id } });
    return { booking: updated, record: finalRecord };
  });
}
