import { NotificationType, type PrismaClient } from "@prisma/client";
import { writeAuditLog } from "@/lib/audit-log";
import { enqueueNotification } from "@/lib/zalo";

/**
 * 여권 Zalo 전달 (임시거주신고) 단일 소스 (T3.6 — SPEC F4 체크인 2, 계약: docs/contracts/T3.6-tamtru-passport.md)
 *
 * 베트남 법상 외국인 투숙 시 집주인(공급자)이 임시거주신고(tạm trú) 의무.
 * 운영자가 체크인 시 받은 여권 사진을 공급자 Zalo로 전달해 신고를 위임한다.
 *
 * - 전제: CheckInRecord 존재 + passportPhotoUrls 비어있지 않음 (없으면 거부)
 * - 공급자(villa.supplier) 대상 TAMTRU_PASSPORT 알림 큐잉 + CheckInRecord.tamTruSentAt 기록 + AuditLog
 * - 재전달 허용: 이미 보낸 경우도 재발송 가능(공급자가 못 받았을 때) — tamTruSentAt 갱신
 * - 공급자 zaloUserId 미연결이어도 enqueue는 진행 (dispatch가 NO_ZALO_LINK로 처리) — 응답에 경고
 * - 개인정보 최소화: 빌더 화이트리스트(villaName·guestName·checkIn)만 본문 노출,
 *   여권 사진 URL은 전달 증빙으로 payload·ZaloMessage.attachmentUrls에 기록.
 *   고객 연락처·마진·판매가는 payload에 절대 포함하지 않음.
 */

export class TamTruRejectedError extends Error {
  constructor(
    public readonly reason: "NOT_FOUND" | "NO_CHECKIN" | "NO_PASSPORT",
    detail?: string
  ) {
    super(detail ?? reason);
    this.name = "TamTruRejectedError";
  }
}

export interface SendTamTruInput {
  bookingId: string;
  actorUserId: string;
  now?: Date;
}

export interface SendTamTruResult {
  tamTruSentAt: Date;
  /** 공급자 Zalo 계정 연결 여부 — false면 실제 발송 불가(NO_ZALO_LINK), FE 경고 */
  supplierLinked: boolean;
}

/**
 * 여권 전달 — 단일 트랜잭션:
 * ① 전제 검증(CheckInRecord·passportPhotoUrls) ② 알림 큐잉 ③ tamTruSentAt 기록 ④ AuditLog
 */
export async function sendTamTruPassport(
  prisma: PrismaClient,
  input: SendTamTruInput
): Promise<SendTamTruResult> {
  const now = input.now ?? new Date();

  return prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({
      where: { id: input.bookingId },
      select: {
        id: true,
        guestName: true,
        checkIn: true,
        checkInRecord: { select: { id: true, passportPhotoUrls: true } },
        villa: {
          select: {
            name: true,
            supplierId: true,
            supplier: { select: { zaloUserId: true } },
          },
        },
      },
    });
    if (!booking) throw new TamTruRejectedError("NOT_FOUND");
    if (!booking.checkInRecord) {
      throw new TamTruRejectedError("NO_CHECKIN", "체크인 기록이 없습니다");
    }
    if (booking.checkInRecord.passportPhotoUrls.length < 1) {
      throw new TamTruRejectedError("NO_PASSPORT", "여권 사진이 없습니다");
    }

    const checkInIso =
      booking.checkIn instanceof Date
        ? booking.checkIn.toISOString().slice(0, 10) // @db.Date — 날짜만 (빌더 formatDateVi 입력 규격)
        : String(booking.checkIn);

    // 화이트리스트 payload만 — 고객 연락처·마진·판매가 절대 미포함
    await enqueueNotification({
      userId: booking.villa.supplierId,
      type: NotificationType.TAMTRU_PASSPORT,
      payload: {
        villaName: booking.villa.name,
        guestName: booking.guestName,
        checkIn: checkInIso,
        // 전달 증빙 — 실 이미지 발송은 dispatch 미러의 attachmentUrls로 기록 (Phase 1)
        passportPhotoUrls: booking.checkInRecord.passportPhotoUrls,
      },
      db: tx,
    });

    // 재전달 허용 — tamTruSentAt 갱신
    await tx.checkInRecord.update({
      where: { id: booking.checkInRecord.id },
      data: { tamTruSentAt: now },
    });

    await writeAuditLog({
      db: tx,
      userId: input.actorUserId,
      action: "UPDATE",
      entity: "CheckInRecord",
      entityId: booking.checkInRecord.id,
      // 여권 데이터는 개인정보 — 전달 시각·장수만 기록 (URL·OCR 미기록)
      changes: {
        tamTruSentAt: { new: now.toISOString() },
        passportPhotoCount: { new: booking.checkInRecord.passportPhotoUrls.length },
      },
    });

    return {
      tamTruSentAt: now,
      supplierLinked: Boolean(booking.villa.supplier.zaloUserId),
    };
  });
}
