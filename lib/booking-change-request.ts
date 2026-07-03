// lib/booking-change-request.ts — 파트너 예약 취소·변경·홀드연장 "요청" 코어 (T-partner-workflow-gaps ②)
//
//   사업원칙: 파트너는 예약을 직접 취소·변경할 수 없다(운영자 게이트 유지). 이 모듈은 요청 큐만 담당.
//   kind: CANCEL(취소) | MODIFY(변경 — 자유 텍스트로 희망 내용) | HOLD_EXTEND(가예약 연장)
//   status: PENDING → APPROVED | REJECTED (운영자 처리. 동시 처리는 updateMany status 가드로 한쪽만 승리)
//
//   ★ 누수: 반환 shape에 마진·원가·KRW·신용정보 없음. 파트너 화면 직렬화는 화이트리스트 select.
import type { Prisma, PrismaClient } from "@prisma/client";
import { BookingStatus } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";
import { sendBotMessage } from "@/lib/zalo-runtime";

export const CHANGE_REQUEST_KINDS = ["CANCEL", "MODIFY", "HOLD_EXTEND"] as const;
export type ChangeRequestKind = (typeof CHANGE_REQUEST_KINDS)[number];

export type ChangeRequestErrorReason =
  | "NOT_FOUND" // 예약/요청 미존재 또는 타 파트너(IDOR — 404로 위장)
  | "INVALID_STATUS" // 예약 상태가 해당 요청을 허용하지 않음
  | "DUPLICATE" // 같은 예약에 미해결(PENDING) 요청 존재
  | "ALREADY_RESOLVED"; // 이미 처리된 요청(동시 처리 경합 포함)

export class ChangeRequestError extends Error {
  constructor(
    public reason: ChangeRequestErrorReason,
    message?: string
  ) {
    super(message ?? reason);
    this.name = "ChangeRequestError";
  }
}

/** kind별 허용 예약 상태 — CANCEL/HOLD_EXTEND는 좁게, MODIFY는 체크인 후 연장(ADR-0030)도 허용 */
export function allowedStatusesFor(kind: ChangeRequestKind): BookingStatus[] {
  switch (kind) {
    case "CANCEL":
      return [BookingStatus.HOLD, BookingStatus.CONFIRMED];
    case "MODIFY":
      return [BookingStatus.HOLD, BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN];
    case "HOLD_EXTEND":
      return [BookingStatus.HOLD];
  }
}

export interface CreatedChangeRequest {
  id: string;
  kind: ChangeRequestKind;
  status: string;
  createdAt: Date;
  villaName: string;
  checkIn: Date;
  checkOut: Date;
}

/**
 * 파트너 요청 생성 — 본인(partnerId) 예약만(IDOR 404), kind별 상태 가드, 예약당 미해결 1건 제한.
 * 알림 발송은 하지 않는다(라우트 책임 — 커밋 후 발송 원칙).
 */
export async function createChangeRequest(
  db: PrismaClient | Prisma.TransactionClient,
  input: {
    partnerId: string;
    bookingId: string;
    kind: ChangeRequestKind;
    note?: string | null;
  }
): Promise<CreatedChangeRequest> {
  const booking = await db.booking.findFirst({
    where: { id: input.bookingId, partnerId: input.partnerId },
    select: {
      id: true,
      status: true,
      checkIn: true,
      checkOut: true,
      villa: { select: { name: true } },
    },
  });
  if (!booking) throw new ChangeRequestError("NOT_FOUND");

  if (!allowedStatusesFor(input.kind).includes(booking.status)) {
    throw new ChangeRequestError("INVALID_STATUS", `현재 상태: ${booking.status}`);
  }

  const pending = await db.bookingChangeRequest.findFirst({
    where: { bookingId: booking.id, status: "PENDING" },
    select: { id: true },
  });
  if (pending) throw new ChangeRequestError("DUPLICATE");

  const note = input.note?.trim() ? input.note.trim() : null;
  const created = await db.bookingChangeRequest.create({
    data: {
      bookingId: booking.id,
      partnerId: input.partnerId,
      kind: input.kind,
      note,
    },
    select: { id: true, kind: true, status: true, createdAt: true },
  });

  return {
    id: created.id,
    kind: created.kind as ChangeRequestKind,
    status: created.status,
    createdAt: created.createdAt,
    villaName: booking.villa.name,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
  };
}

export interface ResolvedChangeRequest {
  id: string;
  kind: ChangeRequestKind;
  status: "APPROVED" | "REJECTED";
  bookingId: string;
  partnerId: string;
  villaName: string;
  note: string | null;
  resolutionNote: string | null;
  /** HOLD_EXTEND 승인 시 새 만료 시각(그 외 null) */
  newHoldExpiresAt: Date | null;
}

/**
 * 운영자 요청 처리 — PENDING → APPROVED/REJECTED. 동시 처리는 updateMany status 가드로 한쪽만 승리.
 *   - HOLD_EXTEND 승인: 예약이 여전히 HOLD면 holdExpiresAt = max(now, 기존) + extendHours.
 *     (이미 만료 전이됐으면 INVALID_STATUS — 재제안이 정도)
 *   - CANCEL 승인: 실제 취소(cancelBooking)는 라우트가 이 함수 "이전"에 수행한다(외부 트랜잭션·알림 분리).
 *   - MODIFY 승인: 상태 표시만 — 실제 변경은 운영자가 기존 예약변경 화면에서 수행.
 * 알림 발송은 하지 않는다(라우트 책임).
 */
export async function resolveChangeRequest(
  db: PrismaClient,
  input: {
    requestId: string;
    actorUserId: string;
    action: "APPROVE" | "REJECT";
    resolutionNote?: string | null;
    /** HOLD_EXTEND 승인 시 연장 시간(기본 24h, 1~72h) */
    extendHours?: number;
  }
): Promise<ResolvedChangeRequest> {
  return db.$transaction(async (tx) => {
    const reqRow = await tx.bookingChangeRequest.findUnique({
      where: { id: input.requestId },
      select: {
        id: true,
        kind: true,
        status: true,
        note: true,
        bookingId: true,
        partnerId: true,
        booking: {
          select: {
            status: true,
            holdExpiresAt: true,
            villa: { select: { name: true } },
          },
        },
      },
    });
    if (!reqRow) throw new ChangeRequestError("NOT_FOUND");
    if (reqRow.status !== "PENDING") throw new ChangeRequestError("ALREADY_RESOLVED");

    const now = new Date();
    const nextStatus = input.action === "APPROVE" ? "APPROVED" : "REJECTED";
    let newHoldExpiresAt: Date | null = null;

    if (input.action === "APPROVE" && reqRow.kind === "HOLD_EXTEND") {
      if (reqRow.booking.status !== BookingStatus.HOLD) {
        throw new ChangeRequestError(
          "INVALID_STATUS",
          `예약이 더 이상 HOLD가 아닙니다: ${reqRow.booking.status}`
        );
      }
      const hours = Math.min(Math.max(input.extendHours ?? 24, 1), 72);
      const base = Math.max(now.getTime(), reqRow.booking.holdExpiresAt?.getTime() ?? 0);
      newHoldExpiresAt = new Date(base + hours * 3_600_000);
      // status=HOLD 가드 — cron 만료·동시 확정과 경합해도 한쪽만 승리
      const guarded = await tx.booking.updateMany({
        where: { id: reqRow.bookingId, status: BookingStatus.HOLD },
        data: { holdExpiresAt: newHoldExpiresAt },
      });
      if (guarded.count !== 1) {
        throw new ChangeRequestError("INVALID_STATUS", "동시 변경이 감지되었습니다");
      }
    }

    // PENDING 가드 — 두 운영자가 동시에 처리해도 한쪽만 승리
    const updated = await tx.bookingChangeRequest.updateMany({
      where: { id: reqRow.id, status: "PENDING" },
      data: {
        status: nextStatus,
        resolvedById: input.actorUserId,
        resolutionNote: input.resolutionNote?.trim() || null,
        resolvedAt: now,
      },
    });
    if (updated.count !== 1) throw new ChangeRequestError("ALREADY_RESOLVED");

    return {
      id: reqRow.id,
      kind: reqRow.kind as ChangeRequestKind,
      status: nextStatus as "APPROVED" | "REJECTED",
      bookingId: reqRow.bookingId,
      partnerId: reqRow.partnerId,
      villaName: reqRow.booking.villa.name,
      note: reqRow.note,
      resolutionNote: input.resolutionNote?.trim() || null,
      newHoldExpiresAt,
    };
  });
}

const KIND_LABEL_KO: Record<ChangeRequestKind, string> = {
  CANCEL: "취소 요청",
  MODIFY: "변경 요청",
  HOLD_EXTEND: "홀드 연장 요청",
};

/**
 * 새 파트너 요청을 운영자(OWNER/ADMIN, zaloUserId 연결자)에게 Zalo로 통지.
 * 실패해도 throw하지 않는다(요청 생성 자체는 이미 성공).
 */
export async function notifyOperatorsOfChangeRequest(input: {
  partnerName: string;
  kind: ChangeRequestKind;
  villaName: string;
  checkIn: Date;
  checkOut: Date;
  note?: string | null;
  bookingId: string;
}): Promise<void> {
  try {
    const operators = await defaultPrisma.user.findMany({
      where: {
        role: { in: ["OWNER", "ADMIN"] },
        zaloUserId: { not: null },
        deletedAt: null,
      },
      select: { zaloUserId: true },
    });
    if (operators.length === 0) return;

    const d = (x: Date) => x.toISOString().slice(0, 10);
    const lines = [
      `📮 파트너 ${KIND_LABEL_KO[input.kind]}`,
      `${input.partnerName} · ${input.villaName}`,
      `${d(input.checkIn)} ~ ${d(input.checkOut)}`,
    ];
    if (input.note?.trim()) lines.push(`메모: ${input.note.trim()}`);
    lines.push(`처리: /bookings/${input.bookingId}`);
    const text = lines.join("\n");

    for (const op of operators) {
      if (!op.zaloUserId) continue;
      try {
        await sendBotMessage(op.zaloUserId, text);
      } catch {
        // 개별 실패 무시 — 다음 수신자 계속
      }
    }
  } catch (e) {
    console.warn("[change-request] 운영자 Zalo 통지 실패", e);
  }
}
