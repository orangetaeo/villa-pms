import {
  BookingStatus,
  Currency,
  DepositStatus,
  Prisma,
  type PrismaClient,
} from "@prisma/client";
import { writeAuditLog } from "@/lib/audit-log";
import type { PassportOcrData } from "@/lib/gemini";

/**
 * 체크인 단일 소스 (T3.1 — SPEC F4 체크인 1·3·5, 계약: docs/contracts/T3.1-checkin.md)
 *
 * - CONFIRMED → CHECKED_IN 전이는 status 가드 updateMany (T2.3 패턴 — 동시성 안전)
 * - CheckInRecord.bookingId @unique가 중복 체크인 2차 방어
 * - 동의서·서명(T3.2)·여권 Zalo 전달(T3.6)은 별도 — agreementSignedAt·tamTruSentAt은 비워 둠
 *   (서명 없는 CHECKED_IN 허용 — QA 합의 조건 C, 게이트화는 T3.2 계약에서 결정)
 * - 개인정보: OCR 데이터는 ADMIN이 확인·수정한 확정본만 저장, 로그에 미기록
 */

const INT4_MAX = 2_147_483_647; // depositAmount Int 컬럼 오버플로 방어 (QA 권고 3)

export class CheckInRejectedError extends Error {
  constructor(
    public readonly reason: "NOT_FOUND" | "INVALID_STATUS" | "ALREADY_CHECKED_IN",
    detail?: string
  ) {
    super(detail ?? reason);
    this.name = "CheckInRejectedError";
  }
}

export interface CheckInDepositInput {
  amount: number;
  currency: Currency;
}

export interface CheckInInput {
  bookingId: string;
  passportPhotoUrls: string[];
  /** ADMIN이 확인·수정한 OCR 확정본 (장별) — 자동 저장 금지 원칙의 산출물 */
  passportData: PassportOcrData[];
  /** null = 보증금 미수취 (depositStatus NONE 유지) */
  deposit: CheckInDepositInput | null;
  /** T3.2 — 터치 서명 PNG의 비공개 서빙 경로(/api/passports/sig-…). 무서명 체크인 허용(계약 결정 1) */
  signatureUrl?: string | null;
  notes?: string;
  actorUserId: string;
  now?: Date;
}

/** 서명 파일은 비공개 증빙 파이프라인 경로만 허용 (T3.1 조건 A 정합, T3.2 계약 결정 3) */
export const PRIVATE_EVIDENCE_PATH = /^\/api\/passports\/[a-zA-Z0-9._-]+$/;

// ===================== 순수 함수 층 (단위 테스트 대상) =====================

const ALLOWED_DEPOSIT_CURRENCIES: Currency[] = [
  Currency.KRW,
  Currency.VND,
  Currency.USD,
];

/** 입력 검증 — 위반 시 RangeError (API에서 400) */
export function assertCheckInInput(input: {
  passportPhotoUrls: string[];
  deposit: CheckInDepositInput | null;
  signatureUrl?: string | null;
}): void {
  if (input.signatureUrl != null && !PRIVATE_EVIDENCE_PATH.test(input.signatureUrl)) {
    throw new RangeError("서명 이미지는 비공개 증빙 경로(/api/passports/…)만 허용됩니다");
  }
  if (input.passportPhotoUrls.length < 1) {
    throw new RangeError("여권 사진은 최소 1장 필요합니다 (SPEC F4 체크인 1)");
  }
  if (input.deposit !== null) {
    const { amount, currency } = input.deposit;
    if (!Number.isInteger(amount) || amount < 1 || amount > INT4_MAX) {
      throw new RangeError(
        `보증금 금액은 1~${INT4_MAX} 정수여야 합니다 (통화 최소단위)`
      );
    }
    if (!ALLOWED_DEPOSIT_CURRENCIES.includes(currency)) {
      throw new RangeError(`허용되지 않은 보증금 통화: ${currency}`);
    }
  }
}

// ===================== DB 층 =====================

/**
 * 체크인 완료 — 단일 트랜잭션:
 * ① CONFIRMED→CHECKED_IN (가드) ② CheckInRecord ③ 보증금 HELD/NONE ④ AuditLog
 */
export async function completeCheckIn(prisma: PrismaClient, input: CheckInInput) {
  assertCheckInInput(input);

  return prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({
      where: { id: input.bookingId },
      select: { id: true, status: true, depositStatus: true, checkInRecord: { select: { id: true } } },
    });
    if (!booking) throw new CheckInRejectedError("NOT_FOUND");
    if (booking.checkInRecord) {
      throw new CheckInRejectedError("ALREADY_CHECKED_IN", "이미 체크인 기록이 있습니다");
    }

    // status 가드 updateMany — 동시 요청이 와도 CONFIRMED 1건만 전이 성공
    const transitioned = await tx.booking.updateMany({
      where: { id: input.bookingId, status: BookingStatus.CONFIRMED },
      data: {
        status: BookingStatus.CHECKED_IN,
        ...(input.deposit
          ? {
              depositAmount: input.deposit.amount,
              depositCurrency: input.deposit.currency,
              depositStatus: DepositStatus.HELD,
            }
          : {}),
      },
    });
    if (transitioned.count === 0) {
      throw new CheckInRejectedError(
        "INVALID_STATUS",
        `CONFIRMED 상태에서만 체크인할 수 있습니다 (현재: ${booking.status})`
      );
    }

    const record = await tx.checkInRecord.create({
      data: {
        bookingId: input.bookingId,
        passportPhotoUrls: input.passportPhotoUrls,
        passportOcrJson: input.passportData as unknown as Prisma.InputJsonValue,
        // T3.2 — 체크인 중 서명 완료 시 함께 기록 (무서명이면 null — 사후 서명 경로)
        signatureUrl: input.signatureUrl ?? null,
        agreementSignedAt: input.signatureUrl ? input.now ?? new Date() : null,
        notes: input.notes ?? null,
        createdBy: input.actorUserId,
      },
      select: { id: true, bookingId: true, createdAt: true, agreementSignedAt: true },
    });

    await writeAuditLog({
      db: tx, // 트랜잭션 원자 기록 — 롤백 시 유령 로그 방지
      userId: input.actorUserId,
      action: "UPDATE",
      entity: "Booking",
      entityId: input.bookingId,
      changes: {
        status: { old: BookingStatus.CONFIRMED, new: BookingStatus.CHECKED_IN },
        // 여권 데이터는 개인정보 — 장수만 기록 (QA 권고 4). 서명도 여부만
        passportPhotoCount: { new: input.passportPhotoUrls.length },
        agreementSigned: { new: Boolean(input.signatureUrl) },
        ...(input.deposit
          ? {
              depositStatus: { old: booking.depositStatus, new: DepositStatus.HELD },
              depositAmount: { new: input.deposit.amount },
              depositCurrency: { new: input.deposit.currency },
            }
          : {}),
      },
    });

    return record;
  });
}

// ===================== 사후 서명 (T3.2 계약 결정 2 — 무서명 레코드 소급 해소) =====================

export class AgreementRejectedError extends Error {
  constructor(
    public readonly reason: "NOT_FOUND" | "NO_CHECKIN_RECORD" | "ALREADY_SIGNED" | "INVALID_STATUS",
    detail?: string
  ) {
    super(detail ?? reason);
    this.name = "AgreementRejectedError";
  }
}

/**
 * 사후 서명 — CHECKED_IN + 체크인 기록 존재 + 미서명일 때만.
 * signatureUrl null 가드 updateMany로 동시 서명 경합 차단.
 */
export async function signAgreement(
  prisma: PrismaClient,
  input: { bookingId: string; signatureUrl: string; actorUserId: string; now: Date }
) {
  if (!PRIVATE_EVIDENCE_PATH.test(input.signatureUrl)) {
    throw new RangeError("서명 이미지는 비공개 증빙 경로(/api/passports/…)만 허용됩니다");
  }

  return prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({
      where: { id: input.bookingId },
      select: {
        id: true,
        status: true,
        checkInRecord: { select: { id: true, signatureUrl: true } },
      },
    });
    if (!booking) throw new AgreementRejectedError("NOT_FOUND");
    if (booking.status !== BookingStatus.CHECKED_IN) {
      throw new AgreementRejectedError(
        "INVALID_STATUS",
        `체크인 상태에서만 서명할 수 있습니다 (현재: ${booking.status})`
      );
    }
    if (!booking.checkInRecord) {
      throw new AgreementRejectedError("NO_CHECKIN_RECORD", "체크인 기록이 없습니다");
    }
    if (booking.checkInRecord.signatureUrl) {
      throw new AgreementRejectedError("ALREADY_SIGNED", "이미 서명이 등록되어 있습니다");
    }

    // 미서명 가드 — 동시 사후 서명 경합에서 한쪽만 승리
    const guarded = await tx.checkInRecord.updateMany({
      where: { id: booking.checkInRecord.id, signatureUrl: null },
      data: { signatureUrl: input.signatureUrl, agreementSignedAt: input.now },
    });
    if (guarded.count !== 1) throw new AgreementRejectedError("ALREADY_SIGNED");

    await writeAuditLog({
      db: tx,
      userId: input.actorUserId,
      action: "UPDATE",
      entity: "CheckInRecord",
      entityId: booking.checkInRecord.id,
      changes: { agreementSigned: { old: false, new: true } },
    });

    return tx.checkInRecord.findUniqueOrThrow({
      where: { id: booking.checkInRecord.id },
      select: { id: true, bookingId: true, agreementSignedAt: true },
    });
  });
}
