import { promises as fs } from "fs";
import path from "path";
import { NotificationType, type PrismaClient } from "@prisma/client";
import { writeAuditLog } from "@/lib/audit-log";
import { enqueueNotification } from "@/lib/zalo";
import { getPassportDir } from "@/lib/storage";
import { extractPassportPhotoFileName } from "@/lib/passport-name";
import { getSystemBotOwnerId } from "@/lib/zalo-credentials";
import { sendChatImageAsAdmin } from "@/lib/zalo-runtime";
import { recordSecurityEvent } from "@/lib/security-event";

/**
 * 여권 Zalo 전달 (임시거주신고) 단일 소스 (T3.6 Phase 1 + T3.7 Phase 2 — SPEC F4 체크인 2,
 *   ADR-0029 여권 사진 실발송, 계약: docs/contracts/T3.6-tamtru-passport.md)
 *
 * 베트남 법상 외국인 투숙 시 집주인(공급자)이 임시거주신고(tạm trú) 의무.
 * 운영자(ADMIN)가 체크인 시 받은 여권 사진을 공급자 Zalo로 전달해 신고를 위임한다.
 *
 * Phase 1(기구현): 텍스트 알림(빌라명·게스트명·체크인일) 큐잉 + tamTruSentAt + AuditLog.
 * Phase 2(ADR-0029, 본 변경): **여권 사진면 1장의 실제 이미지 바이트**를 비공개 디스크에서 읽어
 *   `sendChatImageAsAdmin`(공개 URL 미경유·Buffer 직접발송)로 공급자 Zalo에 직접 발송한다.
 *
 * 절대 규칙 (ADR-0029):
 * - 수신자는 서버가 booking→villa→supplier.zaloUserId로 **결정**(클라가 지정 불가, 오발송 차단 D3).
 * - **B1 미연결 short-circuit**: 공급자 zaloUserId 미연결이면 여권 Buffer를 디스크에서 **읽기 전**에
 *   이미지 발송을 중단(PII를 메모리에 적재조차 안 함). 텍스트 알림은 Phase 1대로 큐잉.
 * - **B3 전달 소스 한정**: passportPhotoUrls 중 **사진면 1장만**. signatureUrl·paperDocUrls(sig-/doc-)
 *   절대 혼입 금지 — extractPassportPhotoFileName가 접두·경로주입을 거부.
 * - **D6 감사 2채널**: 전달 1건(재전송 포함)마다 SecurityEvent(PII_FORWARD)+AuditLog. 여권번호·URL·
 *   평문 PII는 meta·changes에 미기록. 마진·판매가·원가·타예약은 일절 미포함(원칙1·2).
 * - 실패 격리: 이미지 발송 실패가 라우트를 500으로 죽이지 않는다(시도도 감사 기록, 결과만 반환).
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
  /** 공급자 Zalo 계정 연결 여부 — false면 이미지 발송 불가(B1 short-circuit), FE 경고 */
  supplierLinked: boolean;
  /** 여권 사진 이미지 실발송 결과 — linked이고 발송 시도했을 때만. 미시도(미연결·소스없음)=false */
  imageSent: boolean;
}

/**
 * 여권 전달 — 트랜잭션(전제검증·텍스트 큐잉·tamTruSentAt·AuditLog) + 트랜잭션 후 이미지 실발송.
 * 이미지 발송은 비공개 디스크 I/O·외부 발송이라 트랜잭션 밖에서(커밋 후) 수행해 DB 잠금을 늘리지 않는다.
 */
export async function sendTamTruPassport(
  prisma: PrismaClient,
  input: SendTamTruInput
): Promise<SendTamTruResult> {
  const now = input.now ?? new Date();

  // ── ① 트랜잭션: 전제검증 + 텍스트 알림 큐잉 + tamTruSentAt + AuditLog ──────────────
  const txResult = await prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({
      where: { id: input.bookingId },
      select: {
        id: true,
        guestName: true,
        checkIn: true,
        villaId: true,
        checkInRecord: {
          select: {
            id: true,
            passportPhotoUrls: true,
            // B2 동의 스냅샷 — 전달 시점의 서명 여부·판본(여권번호·URL 등 PII는 select 안 함)
            signatureUrl: true,
            agreementVersion: true,
          },
        },
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
        // 전달 증빙 — 실 이미지 발송은 트랜잭션 후 sendChatImageAsAdmin이 수행(Phase 2)
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
      // 여권 데이터는 개인정보 — 전달 시각·장수만 기록 (URL·OCR·여권번호 미기록)
      changes: {
        tamTruSentAt: { new: now.toISOString() },
        passportPhotoCount: { new: booking.checkInRecord.passportPhotoUrls.length },
      },
    });

    return {
      checkInRecordId: booking.checkInRecord.id,
      villaId: booking.villaId,
      supplierId: booking.villa.supplierId,
      supplierZaloUserId: booking.villa.supplier.zaloUserId,
      villaName: booking.villa.name,
      // B3 — 전달 소스를 사진면 1장으로 한정. 첫 항목부터 사진면(sig-/doc- 아님)을 고른다.
      passportPhotoUrls: booking.checkInRecord.passportPhotoUrls,
      // B2 동의 스냅샷
      agreementSigned: Boolean(booking.checkInRecord.signatureUrl),
      agreementVersion: booking.checkInRecord.agreementVersion ?? null,
    };
  });

  const supplierLinked = Boolean(txResult.supplierZaloUserId);

  // ── ② B1 short-circuit: 미연결이면 여권 Buffer를 읽지 않고 즉시 종료 ──────────────
  //   (PII를 메모리에 적재조차 하지 않음). 텍스트 알림은 위에서 이미 큐잉됨.
  if (!supplierLinked) {
    return { tamTruSentAt: now, supplierLinked: false, imageSent: false };
  }

  // ── ③ 이미지 실발송 (커밋 후, 트랜잭션 밖) — 실패해도 throw하지 않음(라우트 200 유지) ──
  const imageSent = await forwardPassportImage(prisma, {
    actorUserId: input.actorUserId,
    supplierZaloUserId: txResult.supplierZaloUserId as string,
    bookingId: input.bookingId,
    checkInRecordId: txResult.checkInRecordId,
    villaId: txResult.villaId,
    recipientSupplierId: txResult.supplierId,
    villaName: txResult.villaName,
    passportPhotoUrls: txResult.passportPhotoUrls,
    agreementSigned: txResult.agreementSigned,
    agreementVersion: txResult.agreementVersion,
  });

  return { tamTruSentAt: now, supplierLinked: true, imageSent };
}

interface ForwardImageInput {
  actorUserId: string;
  supplierZaloUserId: string;
  bookingId: string;
  checkInRecordId: string;
  villaId: string;
  recipientSupplierId: string;
  villaName: string;
  passportPhotoUrls: string[];
  agreementSigned: boolean;
  agreementVersion: string | null;
}

/**
 * 여권 사진면 1장을 비공개 디스크에서 읽어 공급자 Zalo로 직접 발송 + 감사 2채널 기록.
 *  - B3: passportPhotoUrls 중 **사진면 1장만**(sig-/doc- 접두·경로주입 거부). 미선별 시 미발송.
 *  - D6: 전달 1건마다 SecurityEvent(PII_FORWARD)+AuditLog. 성공·실패 모두 status 기록(항목 6).
 *  - 절대 throw 금지 — 발송 실패가 라우트를 500으로 죽이지 않는다.
 * @returns 실제 이미지 발송 성공 여부
 */
async function forwardPassportImage(
  prisma: PrismaClient,
  input: ForwardImageInput
): Promise<boolean> {
  // B3 — 사진면 1장 선별(접두·경로주입 거부). 사진면이 하나도 없으면 미발송(소스 없음).
  let photoFileName: string | null = null;
  for (const url of input.passportPhotoUrls) {
    const f = extractPassportPhotoFileName(url);
    if (f) {
      photoFileName = f;
      break;
    }
  }
  if (!photoFileName) {
    await recordForwardAudit(prisma, input, "NO_PHOTO_SOURCE");
    return false;
  }

  // 발송할 ADMIN 인스턴스 결정 — 트리거한 운영자(actorUserId)의 zca-js 인스턴스.
  //   통합 모드에선 시스템봇 소유자(테오)가 actor와 동일하지만, 미상일 때 시스템봇 소유자로 폴백.
  let adminUserId = input.actorUserId;
  try {
    const sysOwner = await getSystemBotOwnerId();
    if (sysOwner) adminUserId = sysOwner;
  } catch {
    /* 폴백: actorUserId 그대로 */
  }

  // 비공개 디스크에서 여권 사진면 Buffer 직접 읽기(공개 URL 미경유) — 경로는 getPassportDir() 하위로 강제.
  let buffer: Buffer;
  try {
    buffer = await fs.readFile(path.join(getPassportDir(), photoFileName));
  } catch (e) {
    console.error(
      "[tamtru] 여권 파일 읽기 실패:",
      e instanceof Error ? e.message : "unknown"
    );
    await recordForwardAudit(prisma, input, "FILE_READ_FAIL");
    return false;
  }

  // 캡션 — 식별용 최소 + 삭제 권고(D5). 여권번호 등 평문 PII는 넣지 않는다(이미지에 이미 담김).
  const caption =
    `[tạm trú] ${input.villaName}\n` +
    "Ảnh hộ chiếu để khai báo tạm trú. Vui lòng xóa sau khi hoàn tất khai báo.";

  const send = await sendChatImageAsAdmin(
    adminUserId,
    input.supplierZaloUserId,
    buffer,
    photoFileName,
    caption
  );

  await recordForwardAudit(prisma, input, send.ok ? "SENT" : "SEND_FAIL");
  return send.ok;
}

type ForwardStatus = "SENT" | "SEND_FAIL" | "FILE_READ_FAIL" | "NO_PHOTO_SOURCE";

/**
 * 여권 전달 1건 감사 2채널 — SecurityEvent(PII_FORWARD)+AuditLog. throw 안 함(기록 실패가 흐름 차단 금지).
 * meta에는 식별자·동의 스냅샷·status만 — 여권번호·URL·게스트 평문 PII·마진·판매가 절대 미포함.
 */
async function recordForwardAudit(
  prisma: PrismaClient,
  input: ForwardImageInput,
  status: ForwardStatus
): Promise<void> {
  // SecurityEvent — 민감정보(여권 사진) 이동 추적 채널. recordSecurityEvent는 throw하지 않음.
  await recordSecurityEvent({
    type: "PII_FORWARD",
    actorUserId: input.actorUserId,
    path: `/api/bookings/${input.bookingId}/tamtru`,
    meta: {
      bookingId: input.bookingId,
      villaId: input.villaId,
      recipientSupplierId: input.recipientSupplierId,
      agreementSigned: input.agreementSigned,
      agreementVersion: input.agreementVersion,
      status,
    },
  });

  // AuditLog — 영구 변경 이력. 여권 URL·번호·OCR 미기록.
  try {
    await writeAuditLog({
      db: prisma,
      userId: input.actorUserId,
      action: "UPDATE",
      entity: "CheckInRecord",
      entityId: input.checkInRecordId,
      changes: {
        passportImageForwarded: { new: status },
        recipientSupplierId: { new: input.recipientSupplierId },
      },
    });
  } catch (e) {
    console.error(
      "[tamtru] 전달 AuditLog 기록 실패:",
      e instanceof Error ? e.message : "unknown"
    );
  }
}
