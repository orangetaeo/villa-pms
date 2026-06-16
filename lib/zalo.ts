// [SHARED-MODULE] Zalo OA 발송 패턴 (Nike 프로젝트 계보)
import {
  NotificationStatus,
  NotificationType,
  Prisma,
  ZaloMessageDirection,
  ZaloMessageSource,
  ZaloMessageStatus,
  type Notification,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { DbClient } from "@/lib/availability";
import { sendBotMessage, ERROR_BOT_NOT_CONNECTED } from "@/lib/zalo-runtime";
import { getSystemBotOwnerId } from "@/lib/zalo-credentials";

// 봇 미연결 상수 재노출 (S4 — 호출부가 lib/zalo에서 일괄 import하도록)
export { ERROR_BOT_NOT_CONNECTED };

/**
 * Zalo OA 발송 단일 소스 (SPEC F5, 계약: docs/contracts/T3.5-zalo-send.md)
 *
 * 흐름: 비즈니스 로직 → enqueueNotification(PENDING 큐 적재만) →
 *       cron(app/api/cron/notifications) → dispatchPendingNotifications(배치 발송)
 *
 * - 발송 실패가 비즈니스 트랜잭션을 깨지 않도록 큐잉과 발송을 분리한다
 * - 재시도: FAILED 최대 3회. attempt는 payload._attempt에 기록 (스키마 변경 금지)
 *   - NO_ZALO_LINK(사용자 Zalo 미연결)는 영구 실패 — 재시도 제외
 *   - ZALO_TOKEN_NOT_SET(토큰 미설정)은 attempt 미증가 — 토큰 입력 후 자동 회복
 * - 발송 성공 시 ZaloMessage(SYSTEM·OUTBOUND) 미러 기록 (ADR-0003).
 *   ZaloConversation 없으면(팔로우 전) conversationId 필수 관계이므로 미러 생략 후 집계에 표기
 * - 마진 비공개 원칙: 본문 빌더는 화이트리스트 필드만 읽는다 —
 *   payload에 판매가·마진이 섞여 들어와도 문구에 절대 노출되지 않음
 */

const ZALO_CS_API_URL = "https://openapi.zalo.me/v3.0/oa/message/cs";
const FETCH_TIMEOUT_MS = 10_000;

/** 재시도 상한 — 초과 시 영구 FAILED (계약 완료 기준 3) */
export const MAX_SEND_ATTEMPTS = 3;

/** 영구 실패: 사용자에게 zaloUserId가 없음 — 계정 연결 전에는 재시도 무의미 */
export const ERROR_NO_ZALO_LINK = "NO_ZALO_LINK";
/** 환경 실패: 토큰 미설정 — attempt 미증가, 토큰 입력 후 자동 회복 */
export const ERROR_TOKEN_NOT_SET = "ZALO_TOKEN_NOT_SET";

const PERMANENT_ERRORS: ReadonlySet<string> = new Set([ERROR_NO_ZALO_LINK]);

// ===================== 순수 함수 층 (단위 테스트 대상) =====================

/** payload._attempt 안전 추출 — 없거나 오염된 값은 0 */
export function getAttemptCount(payload: unknown): number {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const raw = (payload as Record<string, unknown>)._attempt;
    if (typeof raw === "number" && Number.isInteger(raw) && raw >= 0) return raw;
  }
  return 0;
}

/** payload에 _attempt 기록 (스키마 변경 금지 — Json 컬럼 내 카운터) */
export function withAttempt(payload: unknown, attempt: number): Prisma.InputJsonValue {
  const base =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {};
  return { ...base, _attempt: attempt } as Prisma.InputJsonValue;
}

/**
 * FAILED 알림 재시도 판정.
 * - NO_ZALO_LINK: 영구 실패 — 재시도 안 함
 * - BOT_NOT_CONNECTED(구 ZALO_TOKEN_NOT_SET): attempt 미증가 → 항상 재시도 대상
 *   (봇 재로그인 후 다음 cron에서 자동 발송 — ADR-0006 D5.4)
 * - 그 외(타임아웃·API 오류): attempt < MAX_SEND_ATTEMPTS 일 때만 재시도
 */
export function isRetryableFailure(error: string | null | undefined, attempt: number): boolean {
  if (error && PERMANENT_ERRORS.has(error)) return false;
  if (error === ERROR_TOKEN_NOT_SET || error === ERROR_BOT_NOT_CONNECTED) return true;
  return attempt < MAX_SEND_ATTEMPTS;
}

/** "YYYY-MM-DD" → vi 표기 "DD/MM/YYYY". 비정상 값은 안전 폴백 */
function formatDateVi(value: unknown): string {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-");
    return `${d}/${m}/${y}`;
  }
  return typeof value === "string" && value.length > 0 ? value : "—";
}

/** ISO 타임스탬프 → Asia/Ho_Chi_Minh "HH:mm DD/MM/YYYY" */
function formatDateTimeVi(value: unknown): string {
  if (typeof value !== "string") return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("hour")}:${get("minute")} ${get("day")}/${get("month")}/${get("year")}`;
}

/** VND 금액 vi 표기 (점 구분: 5.000.000). 숫자/문자열 허용, 비정상은 null */
function formatVndVi(value: unknown): string | null {
  let n: bigint;
  if (typeof value === "number" && Number.isFinite(value)) n = BigInt(Math.trunc(value));
  else if (typeof value === "string" && /^-?\d+$/.test(value)) n = BigInt(value);
  else return null;
  return n.toLocaleString("de-DE"); // de-DE = 점 천단위 구분 (vi 금액 표기 규칙)
}

function str(value: unknown, fallback = "—"): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

/**
 * payload에서 첨부 URL 배열을 안전 추출 (전달 증빙용).
 * 현재 TAMTRU_PASSPORT의 passportPhotoUrls만 미러 attachmentUrls에 기록한다.
 * (Phase 1: 텍스트 알림 + 첨부 URL 증빙. 실 이미지 발송은 잔여 — dispatchOne 주석 참조)
 */
export function extractAttachmentUrls(payload: unknown): string[] {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const raw = (payload as Record<string, unknown>).passportPhotoUrls;
    if (Array.isArray(raw)) {
      return raw.filter((u): u is string => typeof u === "string" && u.length > 0);
    }
  }
  return [];
}

function num(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "—";
}

/**
 * NotificationType별 vi 본문 빌더 (LOC 용어 사전 .claude/skills/loc/i18n-pattern.md 준수).
 *
 * 규칙:
 * - 첫 줄에 용건, 빌라명·날짜는 변수 (빌라명은 고유명사 — 번역 금지)
 * - 2인칭은 bạn, 명령형은 Vui lòng ~
 * - 판매가(KRW)·마진 절대 미포함 — 화이트리스트 필드만 읽으므로 빌더 레벨에서 차단됨
 * - 용어: Giữ chỗ(가예약)·Đã đặt(확정)·Dọn dẹp(청소, vệ sinh 금지)·Duyệt/Từ chối(승인/반려)
 */
export function buildNotificationText(
  type: NotificationType,
  payload: Record<string, unknown> | null | undefined
): string {
  const p = payload ?? {};
  const villa = str(p.villaName);
  const stay = `Nhận phòng: ${formatDateVi(p.checkIn)} → Trả phòng: ${formatDateVi(p.checkOut)}`;

  switch (type) {
    case NotificationType.BOOKING_HOLD:
      return [
        `🔔 Giữ chỗ mới: ${villa}`,
        stay,
        `Số khách: ${num(p.guestCount)}`,
        `Giữ chỗ đến: ${formatDateTimeVi(p.holdExpiresAt)}`,
        `Vui lòng giữ lịch trống cho khoảng thời gian này.`,
      ].join("\n");

    case NotificationType.BOOKING_CONFIRMED:
      return [
        `✅ Đã đặt: ${villa}`,
        stay,
        `Số khách: ${num(p.guestCount)}`,
        `Đặt chỗ đã được xác nhận. Vui lòng chuẩn bị đón khách.`,
      ].join("\n");

    case NotificationType.HOLD_EXPIRED:
      return [
        `⏰ Giữ chỗ đã hết hạn: ${villa}`,
        stay,
        `Lịch đã được mở lại (Trống).`,
      ].join("\n");

    case NotificationType.BOOKING_CANCELLED:
      return [
        `❌ Đặt chỗ đã bị hủy: ${villa}`,
        stay,
        `Lịch đã được mở lại (Trống).`,
      ].join("\n");

    case NotificationType.CLEANING_REQUEST: {
      const lines = [`🧹 Yêu cầu dọn dẹp: ${villa}`];
      if (p.periodic === true) lines.push(`Dọn dẹp định kỳ hàng tháng.`);
      if (typeof p.dueDate === "string") lines.push(`Hạn: ${formatDateVi(p.dueDate)}`);
      lines.push(`Vui lòng dọn dẹp và tải ảnh lên ứng dụng.`);
      return lines.join("\n");
    }

    case NotificationType.CLEANING_APPROVED:
      return [
        `✅ Dọn dẹp đã được duyệt: ${villa}`,
        `Villa đã sẵn sàng đón khách tiếp theo. Cảm ơn bạn!`,
      ].join("\n");

    case NotificationType.CLEANING_REJECTED:
      return [
        `⚠️ Dọn dẹp bị từ chối: ${villa}`,
        `Lý do: ${str(p.rejectNote, "(không có ghi chú)")}`,
        `Vui lòng dọn dẹp lại và tải ảnh mới lên ứng dụng.`,
      ].join("\n");

    case NotificationType.TAMTRU_PASSPORT:
      return [
        `🛂 Hộ chiếu khách (đăng ký tạm trú): ${villa}`,
        `Khách: ${str(p.guestName)}`,
        `Nhận phòng: ${formatDateVi(p.checkIn)}`,
        `Vui lòng kiểm tra ảnh hộ chiếu được gửi kèm và đăng ký tạm trú.`,
      ].join("\n");

    case NotificationType.SETTLEMENT_READY: {
      const lines = [`💰 Bảng thanh toán tháng ${str(p.yearMonth)} đã sẵn sàng.`];
      const total = formatVndVi(p.totalVnd); // 공급자 자신의 정산액(원가 기반)만 — 마진·판매가 아님
      if (total !== null) lines.push(`Tổng: ${total}₫`);
      lines.push(`Vui lòng kiểm tra chi tiết trong ứng dụng.`);
      return lines.join("\n");
    }

    case NotificationType.VILLA_REJECTED:
      // T1.2b — 빌라 반려. reason은 ADMIN 입력 사유(번역 전 ko일 수 있음 — 변수만 노출)
      return [
        `⚠️ Villa cần chỉnh sửa: ${villa}`,
        `Lý do: ${str(p.reason, "(không có ghi chú)")}`,
        `Vui lòng kiểm tra và cập nhật lại thông tin trong ứng dụng.`,
      ].join("\n");

    case NotificationType.RATE_CHANGED_DURING_PROPOSAL:
      // 제안 유효기간 중 빌라 요율 변경 알림 (enum만 선등록 — enqueue 사용처는 후속 세션).
      // 원가 등 금액 미노출(마진 비공개) — 안내만. 후속에서 문구 정교화 가능.
      return [
        `📋 Cập nhật giá: ${villa}`,
        `Giá thuê đã được cập nhật trong thời gian đề xuất còn hiệu lực.`,
        `Vui lòng kiểm tra chi tiết trong ứng dụng.`,
      ].join("\n");
  }
}

// ===================== 큐 적재 (비즈니스 로직 진입점) =====================

export interface EnqueueNotificationParams {
  userId: string;
  type: NotificationType;
  payload: Record<string, unknown>;
  /** 비즈니스 트랜잭션 안에서 원자적으로 적재할 때 tx 주입 (T1.3·T1.8 패턴) */
  db?: DbClient;
}

/**
 * Notification(PENDING, channel ZALO) 생성 — 발송은 cron이 담당.
 * 비즈니스 로직이 호출하는 유일한 진입점 (발송 실패가 본 트랜잭션을 깨지 않도록 분리)
 */
export async function enqueueNotification(
  params: EnqueueNotificationParams
): Promise<Notification> {
  const db = params.db ?? prisma;
  return db.notification.create({
    data: {
      userId: params.userId,
      type: params.type,
      channel: "ZALO",
      payload: params.payload as Prisma.InputJsonValue,
      status: NotificationStatus.PENDING,
    },
  });
}

// ===================== Zalo OA API 호출 =====================

export type ZaloSendResult =
  | { ok: true; messageId: string | null }
  | { ok: false; error: string };

interface ZaloCsResponse {
  error?: number;
  message?: string;
  data?: { message_id?: string };
}

/**
 * Zalo OA CS 메시지(text) 단건 발송. 10s 타임아웃, 예외 없이 결과 객체 반환.
 * 성공 판정: HTTP 2xx AND body.error === 0
 */
export async function sendZaloText(
  zaloUserId: string,
  text: string,
  accessToken: string
): Promise<ZaloSendResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(ZALO_CS_API_URL, {
      method: "POST",
      headers: { access_token: accessToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        recipient: { user_id: zaloUserId },
        message: { text },
      }),
      signal: controller.signal,
    });
    if (!res.ok) return { ok: false, error: `HTTP_${res.status}` };
    const body = (await res.json()) as ZaloCsResponse;
    if (body.error !== 0) {
      return {
        ok: false,
        error: `ZALO_${body.error ?? "UNKNOWN"}: ${body.message ?? ""}`.slice(0, 500),
      };
    }
    return { ok: true, messageId: body.data?.message_id ?? null };
  } catch (e) {
    const isAbort = e instanceof Error && e.name === "AbortError";
    return {
      ok: false,
      error: isAbort ? "TIMEOUT" : `FETCH_ERROR: ${e instanceof Error ? e.message : String(e)}`.slice(0, 500),
    };
  } finally {
    clearTimeout(timer);
  }
}

// ===================== 배치 발송 (cron 진입점) =====================

export interface DispatchSummary {
  /** SENT 전환 건수 */
  sent: number;
  /** FAILED 기록 건수 (NO_ZALO_LINK·TOKEN_NOT_SET 포함) */
  failed: number;
  /** 재시도 판정에서 제외된 건수 (3회 초과·영구 실패) */
  skipped: number;
  /** 발송은 성공했으나 ZaloConversation 부재로 ZaloMessage 미러를 생략한 건수 */
  mirrorSkipped: number;
}

type DispatchTarget = Notification & { user: { zaloUserId: string | null } };

/**
 * PENDING + 재시도 대상 FAILED 알림 배치 발송 (오래된 순).
 * 개별 실패가 배치를 중단시키지 않는다 (per-item try/catch).
 */
export async function dispatchPendingNotifications(limit = 20): Promise<DispatchSummary> {
  const summary: DispatchSummary = { sent: 0, failed: 0, skipped: 0, mirrorSkipped: 0 };

  // 영구 실패(NO_ZALO_LINK)는 DB 레벨에서 제외, attempt 판정은 Json 필드라 JS에서 수행
  const candidates = await prisma.notification.findMany({
    where: {
      channel: "ZALO",
      OR: [
        { status: NotificationStatus.PENDING },
        {
          status: NotificationStatus.FAILED,
          NOT: { error: { in: [...PERMANENT_ERRORS] } },
        },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: limit * 3, // attempt 초과분이 섞여 있을 수 있어 여유 조회
    include: { user: { select: { zaloUserId: true } } },
  });

  const targets: DispatchTarget[] = [];
  for (const n of candidates) {
    if (
      n.status === NotificationStatus.FAILED &&
      !isRetryableFailure(n.error, getAttemptCount(n.payload))
    ) {
      summary.skipped += 1;
      continue;
    }
    if (targets.length < limit) targets.push(n);
  }

  for (const notification of targets) {
    try {
      await dispatchOne(notification, summary);
    } catch (e) {
      // 개별 실패가 배치를 중단시키지 않게 — 기록 시도 후 다음 항목으로
      console.error(`[zalo] 알림 ${notification.id} 처리 중 예외`, e);
      summary.failed += 1;
      const attempt = getAttemptCount(notification.payload);
      await prisma.notification
        .update({
          where: { id: notification.id },
          data: {
            status: NotificationStatus.FAILED,
            error: `INTERNAL: ${e instanceof Error ? e.message : String(e)}`.slice(0, 500),
            payload: withAttempt(notification.payload, attempt + 1),
          },
        })
        .catch((err) => console.error(`[zalo] 알림 ${notification.id} FAILED 기록 실패`, err));
    }
  }

  return summary;
}

async function dispatchOne(
  notification: DispatchTarget,
  summary: DispatchSummary
): Promise<void> {
  const attempt = getAttemptCount(notification.payload);
  const zaloUserId = notification.user.zaloUserId;

  // 1) 사용자 Zalo 미연결 — 영구 실패, 재시도 제외 (계약 완료 기준 2)
  if (!zaloUserId) {
    await prisma.notification.update({
      where: { id: notification.id },
      data: { status: NotificationStatus.FAILED, error: ERROR_NO_ZALO_LINK },
    });
    summary.failed += 1;
    return;
  }

  // 2) 발송 (S4 — zca-js 봇 경유). 본문 빌더는 화이트리스트 필드만 → 마진·판매가 미노출.
  const text = buildNotificationText(
    notification.type,
    notification.payload as Record<string, unknown> | null
  );
  const result = await sendBotMessage(zaloUserId, text);

  // 봇 미연결 — 기록만(크래시 금지), attempt 미증가로 재시도 대상 유지 (D5.4)
  if (!result.ok && result.error === ERROR_BOT_NOT_CONNECTED) {
    await prisma.notification.update({
      where: { id: notification.id },
      data: { status: NotificationStatus.FAILED, error: ERROR_BOT_NOT_CONNECTED },
    });
    summary.failed += 1;
    return;
  }

  if (!result.ok) {
    await prisma.notification.update({
      where: { id: notification.id },
      data: {
        status: NotificationStatus.FAILED,
        error: result.error,
        payload: withAttempt(notification.payload, attempt + 1),
      },
    });
    summary.failed += 1;
    return;
  }

  // 4) 성공 — SENT 전환. 미러 실패가 SENT 상태를 되돌리지 않도록 별도 처리
  await prisma.notification.update({
    where: { id: notification.id },
    data: { status: NotificationStatus.SENT, sentAt: new Date(), error: null },
  });
  summary.sent += 1;

  // 5) ZaloMessage(SYSTEM·OUTBOUND) 미러 (ADR-0003) — Conversation 없으면 생략 후 집계 표기.
  //    ADR-0007: 시스템 미러는 시스템봇 소유자(테오) 대화 공간에만 기록(복합키).
  //    시스템봇 소유자 미상이면(미연결) 미러 생략 — 발송 자체(SENT)는 유효.
  try {
    const systemOwnerId = await getSystemBotOwnerId();
    if (!systemOwnerId) {
      summary.mirrorSkipped += 1;
      return;
    }
    const conversation = await prisma.zaloConversation.findUnique({
      where: {
        ownerAdminId_zaloUserId: { ownerAdminId: systemOwnerId, zaloUserId },
      },
      select: { id: true },
    });
    if (!conversation) {
      summary.mirrorSkipped += 1;
      return;
    }
    // 전달 증빙 — TAMTRU_PASSPORT의 여권 사진 URL을 미러에 기록 (T3.6).
    // Phase 1은 텍스트 본문만 실제 발송됨. 실 이미지 발송(Zalo OA upload API:
    //   /v2.0/oa/upload/image → attachment_id → message.attachment.payload)은 잔여 —
    //   토큰·미디어 권한 확보 후 sendZaloText와 별도 발송 함수로 추가 예정.
    const attachmentUrls = extractAttachmentUrls(notification.payload);
    await prisma.zaloMessage.create({
      data: {
        conversationId: conversation.id,
        direction: ZaloMessageDirection.OUTBOUND,
        source: ZaloMessageSource.SYSTEM,
        msgType: attachmentUrls.length > 0 ? "image" : "text",
        text,
        attachmentUrls,
        zaloMsgId: result.messageId,
        status: ZaloMessageStatus.SENT,
      },
    });
    await prisma.zaloConversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: new Date() },
    });
  } catch (e) {
    // 미러는 채팅 UI 표시용 부가 기록 — 실패해도 발송 자체(SENT)는 유효
    console.error(`[zalo] 알림 ${notification.id} ZaloMessage 미러 기록 실패`, e);
    summary.mirrorSkipped += 1;
  }
}
