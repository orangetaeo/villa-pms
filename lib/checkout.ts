import {
  BookingStatus,
  DepositStatus,
  PrismaClient,
  type Booking,
  type CheckOutRecord,
} from "@prisma/client";
import { createCheckoutCleaningTask } from "./cleaning";
import { writeAuditLog } from "./audit-log";

/**
 * 체크아웃 단일 소스 (SPEC F4 체크아웃 1~4)
 *
 * - CHECKED_IN → CHECKED_OUT 전이 (status 가드 — 중복 체크아웃 차단)
 * - 보증금 상태기계: 파손 없음 → REFUNDED / 파손 → PARTIAL_DEDUCTED + 차감액(VND BigInt) 필수
 * - 같은 트랜잭션에서 createCheckoutCleaningTask 호출 — CleaningTask(CHECKOUT) 생성과
 *   villa.isSellable=false(게이트 닫기)가 체크아웃과 원자적으로 묶인다
 * - 미니바는 읽기 전용 표시(ADR-0003) — 소모분은 deductionVnd에 수기 반영, 자동 차감 없음
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

export interface CompleteCheckoutInput {
  bookingId: string;
  /** 공간별 상태 사진 (기준 사진과 비교용) — 1장 이상 */
  photoUrls: string[];
  damageFound: boolean;
  damageNote?: string;
  damagePhotoUrls?: string[];
  deductionVnd?: bigint | null;
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
      select: { id: true, status: true, depositStatus: true },
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
      },
    });

    const updated = await tx.booking.findUniqueOrThrow({ where: { id: booking.id } });
    return { booking: updated, record };
  });
}
