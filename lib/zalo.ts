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
import {
  sendBotMessage,
  sendBotMessageWithAttachments,
  sendBotGroupMessage,
  ERROR_BOT_NOT_CONNECTED,
  type BotAttachment,
} from "@/lib/zalo-runtime";
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

/** payload.bookingId(cuid) → 짧은 표시용 예약번호 "#ABC123". 없으면 null (구 payload 호환) */
function bookingRef(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length < 6) return null;
  return `#${value.trim().slice(-6).toUpperCase()}`;
}

/** 시즌 라벨 ko (운영자 알림용) */
const SEASON_LABEL_KO: Record<string, string> = {
  LOW: "비수기",
  HIGH: "성수기",
  PEAK: "극성수기",
};

/**
 * 마케팅 알림 kind별 한국어 제목 프리픽스 (MARKETING_ALERT payload.kind 분기 — marketing-s2 §D).
 * ★ lib/marketing-notify.MarketingAlertKind와 1:1. 새 kind 추가 시 양쪽 동시 등재.
 */
const MARKETING_ALERT_PREFIX: Record<string, string> = {
  IG_DRAFTS_READY: "📸 인스타 초안 승인 대기",
  YT_DRAFTS_READY: "📹 유튜브 쇼츠 초안 승인 대기",
  IG_PUBLISH_FAILED: "🚨 인스타 발행 실패",
  YT_PUBLISH_FAILED: "🚨 유튜브 쇼츠 업로드 실패",
  YT_DRAFT_FAILED: "🚨 유튜브 쇼츠 초안 실패",
  IG_TOKEN_REFRESH_FAILED: "🚨 인스타 토큰 갱신 실패",
  IG_INSIGHTS_FAILED: "🚨 인스타 인사이트 수집 실패",
  YT_STATS_FAILED: "🚨 유튜브 성과 수집 실패",
  YT_EDIT_DONE: "✅ 유튜브 편집 완료",
  YT_EDIT_FAILED: "🚨 유튜브 편집 실패",
};

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
    case NotificationType.BOOKING_HOLD: {
      const ref = bookingRef(p.bookingId);
      const lines = [`🔔 Giữ chỗ mới: ${villa}`];
      if (ref) lines.push(`Mã đặt phòng: ${ref}`);
      lines.push(stay, `Số khách: ${num(p.guestCount)}`);
      // 예약자명 — 손님맞이 준비용(판매가·마진 아님). 구 payload는 미포함 → 줄 생략.
      if (typeof p.guestName === "string" && p.guestName.trim().length > 0) {
        lines.push(`Tên khách: ${p.guestName.trim()}`);
      }
      lines.push(
        `Giữ chỗ đến: ${formatDateTimeVi(p.holdExpiresAt)}`,
        `Vui lòng giữ lịch trống cho khoảng thời gian này.`
      );
      return lines.join("\n");
    }

    case NotificationType.BOOKING_CONFIRMED: {
      const ref = bookingRef(p.bookingId);
      const lines = [`✅ Đã đặt: ${villa}`];
      if (ref) lines.push(`Mã đặt phòng: ${ref}`);
      lines.push(stay, `Số khách: ${num(p.guestCount)}`);
      if (typeof p.guestName === "string" && p.guestName.trim().length > 0) {
        lines.push(`Tên khách: ${p.guestName.trim()}`);
      }
      // 조식 — true일 때만 표기(홀드 시점 기본값 false 노이즈 방지)
      if (p.breakfastIncluded === true) lines.push(`Bao gồm bữa sáng.`);
      lines.push(`Đặt chỗ đã được xác nhận. Vui lòng chuẩn bị đón khách.`);
      return lines.join("\n");
    }

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
      // 사전 알림(phase=upcoming) — 체크아웃 예정 안내(아직 청소 시작 아님). 실제 청소요청과 구분.
      if (p.phase === "upcoming") {
        const lines = [`📅 Sắp dọn dẹp: ${villa}`];
        if (typeof p.dueDate === "string")
          lines.push(`Dự kiến trả phòng: ${formatDateVi(p.dueDate)}`);
        lines.push(`Khách sắp trả phòng — vui lòng chuẩn bị dọn dẹp.`);
        return lines.join("\n");
      }
      const lines = [`🧹 Yêu cầu dọn dẹp: ${villa}`];
      if (p.periodic === true) lines.push(`Dọn dẹp định kỳ hàng tháng.`);
      if (typeof p.dueDate === "string") lines.push(`Hạn: ${formatDateVi(p.dueDate)}`);
      // 다음 손님 체크인 — 긴급도 판단용(체크아웃 청소 요청에만 caller가 채움)
      if (typeof p.nextCheckIn === "string" && p.nextCheckIn.length > 0) {
        lines.push(
          `Khách tiếp theo nhận phòng: ${formatDateVi(p.nextCheckIn)} — vui lòng dọn xong trước ngày này.`
        );
      }
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
      // 월 정산서 PDF 다운로드 링크 (P2-4) — statementPath 있고 base URL 설정 시. 링크는 로그인 게이트.
      const stmtPath =
        typeof p.statementPath === "string" && p.statementPath.startsWith("/")
          ? p.statementPath
          : null;
      const base = (
        process.env.VILLA_PUBLIC_BASE_URL ||
        process.env.NEXTAUTH_URL ||
        ""
      ).replace(/\/+$/, "");
      if (stmtPath && base) lines.push(`📄 Tải phiếu quyết toán: ${base}${stmtPath}`);
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

    case NotificationType.RATE_CHANGED_DURING_PROPOSAL: {
      // 수신자=운영자(테오) → 한국어 (NOTIFICATIONS.md A-06 검토 반영 — 종전 베트남어 오작성 수정).
      // 원가는 운영자 정당 열람 정보. 변경 전→후 원가·영향 제안 수까지 표기해 즉시 판단 가능하게.
      const season = str(p.season);
      const seasonLabel = SEASON_LABEL_KO[season] ?? season;
      const oldCost = formatVndVi(p.oldCostVnd);
      const newCost = formatVndVi(p.newCostVnd);
      const lines = [`📋 견적 진행 중 원가 변경: ${villa}`];
      if (oldCost !== null) {
        lines.push(
          newCost !== null
            ? `${seasonLabel}: ${oldCost}₫ → ${newCost}₫`
            : `${seasonLabel}: ${oldCost}₫ (기간 삭제됨)`
        );
      }
      const count =
        typeof p.proposalCount === "number" && p.proposalCount > 0 ? `${p.proposalCount}건` : null;
      lines.push(
        count
          ? `유효한 제안 ${count}에 영향이 있습니다. 원가 경보에서 확인해주세요.`
          : `유효한 제안에 영향이 있습니다. 원가 경보에서 확인해주세요.`
      );
      return lines.join("\n");
    }

    case NotificationType.ROSTER_REMINDER: {
      // 수신자=운영자(테오) → 한국어. 체크인 임박·명단 미입력 안내 (가격·마진 미노출).
      const lines = [
        `📋 투숙객 명단 미입력: ${villa}`,
        `체크인: ${formatDateVi(p.checkIn)} · 예약자: ${str(p.guestName)} (${num(p.guestCount)}명)`,
      ];
      // 판매 채널 — 독촉 연락처 즉시 파악용. 직접판매(파트너 없음)면 줄 생략.
      if (typeof p.partnerName === "string" && p.partnerName.trim().length > 0) {
        const phone =
          typeof p.partnerPhone === "string" && p.partnerPhone.trim().length > 0
            ? ` (${p.partnerPhone.trim()})`
            : "";
        lines.push(`판매 채널: ${p.partnerName.trim()}${phone}`);
      }
      lines.push(`곧 체크인입니다. 실제 투숙객 명단을 확인·입력하거나 여행사에 안내해주세요.`);
      return lines.join("\n");
    }

    case NotificationType.SUPPLIER_DIRECT_BOOKING: {
      // F10 — 수신자=운영자(테오) → 한국어. 공급자가 자기 고객에 직접 판매·기록 → 선착순 점유.
      // 공급자 수금액(supplierSalePriceVnd)은 공급자 정보이므로 알림에 미포함.
      const ref = bookingRef(p.bookingId);
      const lines = [`🏠 공급자 직접예약 등록: ${villa}`];
      if (typeof p.supplierName === "string" && p.supplierName.trim().length > 0) {
        lines.push(`공급자: ${p.supplierName.trim()}`);
      }
      lines.push(
        `체크인: ${formatDateVi(p.checkIn)} → 체크아웃: ${formatDateVi(p.checkOut)} · ${num(p.guestCount)}명`
      );
      if (typeof p.guestName === "string" && p.guestName.trim().length > 0) {
        lines.push(`예약자: ${p.guestName.trim()}${ref ? ` · 예약번호 ${ref}` : ""}`);
      }
      lines.push(`공급자가 직접 판매한 예약입니다. 해당 날짜는 점유 처리되었습니다.`);
      return lines.join("\n");
    }

    case NotificationType.VENDOR_PO: {
      // 수신자=원천 공급자 → 베트남어(vi). 발주(주문) 알림.
      // ★ 판매가·마진 미노출. costVnd(벤더 자기 정산액=라인 총액)는 벤더 정당 정보라 표기(정산투명성).
      const lines = [`🧺 Đơn đặt hàng mới: ${str(p.itemName)} x${num(p.quantity)}`];
      // 선택 옵션 — 라벨만(caller가 selectedOptionLabels로 가격 제거 후 전달)
      if (Array.isArray(p.optionLabels) && p.optionLabels.length > 0) {
        const labels = p.optionLabels.filter((l): l is string => typeof l === "string" && l.length > 0);
        if (labels.length > 0) lines.push(`Tùy chọn: ${labels.join(" · ")}`);
      }
      // 이용자 이름 — 응대 대상 식별용(이름만, 전화 금지). payload에 없으면 줄 생략(구 payload 하위호환).
      if (typeof p.customerName === "string" && p.customerName.trim().length > 0) {
        lines.push(`Khách: ${p.customerName.trim()}`);
      }
      lines.push(`Địa điểm: ${villa}`);
      // 이행 장소 주소 — 발주받은 빌라 1채의 주소만(재고 비공개 원칙과 무관, 판매가·마진 아님).
      if (typeof p.villaAddress === "string" && p.villaAddress.trim().length > 0) {
        lines.push(`Địa chỉ: ${p.villaAddress.trim()}`);
      }
      if (typeof p.serviceDate === "string" && p.serviceDate.length > 0) {
        const time =
          typeof p.serviceTime === "string" && p.serviceTime.trim().length > 0
            ? ` ${p.serviceTime.trim()}`
            : "";
        lines.push(`Ngày: ${formatDateVi(p.serviceDate)}${time}`);
      }
      const cost = formatVndVi(p.costVnd);
      if (cost !== null && cost !== "0") lines.push(`Thanh toán cho bạn: ${cost}₫`);
      // 게스트 요청사항 — 게스트가 직접 쓴 텍스트(판매가·마진 무관, 노출 OK). 이행자에게 전달.
      if (typeof p.guestNote === "string" && p.guestNote.trim().length > 0) {
        lines.push(`Yêu cầu của khách: ${p.guestNote.trim()}`);
      }
      lines.push(`Vui lòng kiểm tra và xác nhận trong ứng dụng (/vendor).`);
      return lines.join("\n");
    }

    case NotificationType.VENDOR_PO_CANCELLED: {
      // 수신자=원천 공급자 → 베트남어(vi). 발주된 주문 취소 통보.
      // ★ 금액 미노출 — 취소 사실·항목·날짜만. 공급자는 준비 중단하면 됨.
      const lines = [`❌ Đơn hàng đã hủy: ${str(p.itemName)} x${num(p.quantity)}`];
      lines.push(`Địa điểm: ${villa}`);
      if (typeof p.serviceDate === "string" && p.serviceDate.length > 0) {
        lines.push(`Ngày: ${formatDateVi(p.serviceDate)}`);
      }
      lines.push(`Đơn đặt hàng này đã được hủy. Vui lòng không chuẩn bị nữa.`);
      return lines.join("\n");
    }

    case NotificationType.VENDOR_PO_RESPONSE: {
      // 수신자=운영자(테오) → 한국어(ko). 공급자 가부 응답 통지.
      const vendorName = str(p.vendorName);
      const itemName = str(p.itemName);
      // 발주 요약(일정·수량·발주액) — 운영자가 알림만으로 어떤 건인지 특정하도록. 구 payload는 생략.
      const orderSummary = (() => {
        const parts: string[] = [];
        if (typeof p.serviceDate === "string" && p.serviceDate.length > 0) {
          const time =
            typeof p.serviceTime === "string" && p.serviceTime.trim().length > 0
              ? ` ${p.serviceTime.trim()}`
              : "";
          parts.push(`일정: ${formatDateVi(p.serviceDate)}${time}`);
        }
        if (typeof p.quantity === "number") parts.push(`수량 x${p.quantity}`);
        const cost = formatVndVi(p.costVnd);
        if (cost !== null && cost !== "0") parts.push(`발주액 ${cost}₫`);
        return parts.length > 0 ? parts.join(" · ") : null;
      })();
      // 일정 협의(propose) — 수락하되 대안 시간 제안. 운영자가 앱에서 적용/무시해야 고객확정 가능.
      if (p.action === "propose") {
        const date = formatDateVi(p.proposedServiceDate);
        const time =
          typeof p.proposedServiceTime === "string" && p.proposedServiceTime.length > 0
            ? ` ${p.proposedServiceTime}`
            : "";
        const lines = [`⏰ 공급자 일정 제안: ${vendorName} — ${itemName} (${villa})`];
        if (orderSummary) lines.push(orderSummary);
        lines.push(
          `제안: ${date}${time}`,
          `사유: ${str(p.proposalNote, "(메모 없음)")}`,
          `앱에서 적용/무시하세요.`
        );
        return lines.join("\n");
      }
      // 서비스 이행 완료 보고 — 공급자가 /vendor에서 완료 버튼(vendorCompletedAt). 정산 처리 신호.
      if (p.action === "complete") {
        const lines = [`🏁 공급자 서비스 완료: ${vendorName} — ${itemName} (${villa})`];
        if (orderSummary) lines.push(orderSummary);
        return lines.join("\n");
      }
      // accepted: accept/propose는 true(수락 계열), reject만 false — 기존 동작 보존.
      if (p.accepted === true) {
        const lines = [`✅ 공급자 수락: ${vendorName} — ${itemName} (${villa})`];
        if (orderSummary) lines.push(orderSummary);
        return lines.join("\n");
      }
      const lines = [`❌ 공급자 거절: ${vendorName} — ${itemName} (${villa})`];
      if (orderSummary) lines.push(orderSummary);
      lines.push(`사유: ${str(p.rejectReason, "(사유 없음)")}`);
      return lines.join("\n");
    }

    case NotificationType.VENDOR_PROPOSAL_RESULT: {
      // 수신자=원천 공급자 — 일정 제안 결과(적용/무시). payload.locale로 ko/vi 분기(공급자는 베트남인·한국인 혼합).
      // ★ 금액 미노출 — 품목·빌라·확정(또는 유지) 일정만.
      const ko = p.locale === "ko";
      const itemName = str(p.itemName);
      const date =
        typeof p.serviceDate === "string" && p.serviceDate.length > 0
          ? formatDateVi(p.serviceDate)
          : "—";
      const time =
        typeof p.serviceTime === "string" && p.serviceTime.length > 0 ? ` ${p.serviceTime}` : "";
      if (p.applied === true) {
        return ko
          ? [
              `✅ 시간 제안이 수락되었습니다: ${itemName} (${villa})`,
              `확정 일정: ${date}${time}`,
            ].join("\n")
          : [
              `✅ Đề xuất giờ đã được chấp nhận: ${itemName} (${villa})`,
              `Lịch xác nhận: ${date}${time}`,
            ].join("\n");
      }
      // ★ 고객(게스트) 거절 분기 — declinedByGuest=true면 발주함 복귀 안내(원래 시간 재검토).
      //   구 payload(플래그 없음)는 아래 운영자 무시(dismiss) 문구로 하위호환.
      if (p.declinedByGuest === true) {
        return ko
          ? [
              `↩️ 고객이 제안 시간을 거절했습니다: ${itemName} (${villa})`,
              `원래 시간(${date}${time}) 기준으로 발주함에서 다시 응답해주세요.`,
            ].join("\n")
          : [
              `↩️ Khách đã từ chối giờ đề xuất: ${itemName} (${villa})`,
              `Vui lòng phản hồi lại trong hộp đơn theo giờ ban đầu (${date}${time}).`,
            ].join("\n");
      }
      return ko
        ? [
            `ℹ️ 시간 제안이 반영되지 않았습니다: ${itemName} (${villa})`,
            `기존 일정 유지: ${date}${time}`,
          ].join("\n")
        : [
            `ℹ️ Đề xuất giờ không được áp dụng: ${itemName} (${villa})`,
            `Giữ lịch ban đầu: ${date}${time}`,
          ].join("\n");
    }

    case NotificationType.BOOKING_MODIFIED: {
      // 예약 변경(날짜·빌라·인원 등) → 수신자=공급자(vi). 판매가·마진·원가 미포함(화이트리스트 필드만).
      const lines = [`✏️ Đặt phòng đã thay đổi: ${villa}`];
      // 변경 전 일정 — 실제로 날짜가 바뀐 경우에만 비교 표기(구 payload는 prev 미포함 → 생략)
      const dateChanged =
        typeof p.prevCheckIn === "string" &&
        typeof p.prevCheckOut === "string" &&
        (p.prevCheckIn !== p.checkIn || p.prevCheckOut !== p.checkOut);
      if (dateChanged) {
        lines.push(`Lịch cũ: ${formatDateVi(p.prevCheckIn)} → ${formatDateVi(p.prevCheckOut)}`);
        lines.push(`Lịch mới: ${formatDateVi(p.checkIn)} → ${formatDateVi(p.checkOut)}`);
      } else {
        lines.push(stay);
      }
      const guestChanged =
        typeof p.prevGuestCount === "number" &&
        typeof p.guestCount === "number" &&
        p.prevGuestCount !== p.guestCount;
      lines.push(
        guestChanged
          ? `Số khách: ${num(p.guestCount)} (trước: ${num(p.prevGuestCount)})`
          : `Số khách: ${num(p.guestCount)}`
      );
      lines.push(`Thông tin đặt phòng đã được cập nhật. Vui lòng kiểm tra lịch trong ứng dụng.`);
      return lines.join("\n");
    }

    case NotificationType.SECURITY_ALERT: {
      // 수신자=운영자(테오) → 한국어. 보안 이상탐지 경보. 비번·해시·마진·판매가 절대 미포함(category·count·출처만).
      const labels: Record<string, string> = {
        LOGIN_FAIL_SPIKE: "로그인 실패 급증",
        AUTHZ_DENY_SPIKE: "권한 거부(403) 급증",
        CRED_DECRYPT_FAIL: "자격증명 복호화 실패",
        SSRF_BLOCK: "내부망 접근 차단(SSRF)",
        RATE_LIMIT_FLOOD: "요청 한도 차단 급증",
      };
      const cat = str(p.category);
      const lines = [
        `🚨 보안 경보: ${labels[cat] ?? cat}`,
        `최근 ${num(p.windowMin)}분간 ${num(p.count)}건 탐지.`,
      ];
      if (typeof p.top === "string" && p.top.length > 0) lines.push(`주요 출처: ${p.top}`);
      lines.push(`SecurityEvent를 확인하세요. (대응 절차: docs/ops/incident-response.md)`);
      return lines.join("\n");
    }

    case NotificationType.VILLA_PENDING_REVIEW: {
      // 수신자=운영자 → 한국어. 공급자 신규 등록/반려 후 재제출 → 승인 대기 통지. 금액 정보 없음.
      const lines = [
        p.resubmitted === true
          ? `🏠 반려 빌라 재제출: ${villa}`
          : `🏠 새 빌라 등록: ${villa}`,
        `공급자: ${str(p.supplierName)}`,
      ];
      // 규모 요약 — 알림만으로 검토 우선순위 판단(구 payload는 생략)
      if (typeof p.bedrooms === "number") {
        const spec = [
          typeof p.complex === "string" && p.complex.trim().length > 0
            ? `단지 ${p.complex.trim()}`
            : null,
          `침실 ${num(p.bedrooms)} · 욕실 ${num(p.bathrooms)} · 최대 ${num(p.maxGuests)}인`,
          typeof p.photoCount === "number" ? `사진 ${p.photoCount}장` : null,
        ].filter(Boolean);
        lines.push(spec.join(" · "));
      }
      lines.push(`승인 대기 중입니다. 관리자 화면에서 검토해주세요.`);
      return lines.join("\n");
    }

    case NotificationType.VILLA_CONTENT_UPDATED: {
      // 수신자=운영자 → 한국어. 승인(ACTIVE)된 빌라의 사진/비품/규칙 변경 통지. 금액 정보 없음.
      const kindLabels: Record<string, string> = {
        PHOTOS: "사진",
        AMENITIES: "비품",
        INFO: "이용규칙·위치 정보",
      };
      const kind = str(p.kind);
      return [
        `✏️ 판매중 빌라 정보 변경: ${villa}`,
        `변경 항목: ${kindLabels[kind] ?? kind}`,
        `공급자가 수정했습니다. 내용을 확인해주세요.`,
      ].join("\n");
    }

    case NotificationType.GUEST_PAYMENT_NOTICE:
      // 수신자=운영자 → 한국어. 게스트 "입금했습니다" 통보 — 홀드만료 전 은행 대조·확정 유도 (A1). 금액 미포함.
      return [
        `💰 입금통보 도착: ${villa}`,
        `게스트: ${str(p.guestName)}${p.depositorName ? ` (입금자명: ${str(p.depositorName)})` : ""}`,
        stay,
        `홀드 만료: ${formatDateTimeVi(p.holdExpiresAt)}`,
        `은행 입금을 대조한 뒤 예약 상세에서 확정해주세요.`,
      ].join("\n");

    case NotificationType.SERVICE_ORDER_REQUESTED:
      // 수신자=운영자 → 한국어. 게스트/파트너 부가서비스 요청 통지 (A1). 금액 미포함(원칙2).
      return [
        `🛎️ 부가서비스 요청: ${villa}`,
        `항목: ${str(p.serviceName)} × ${num(p.quantity)}`,
        `희망: ${str(p.serviceDate) || "-"} ${str(p.serviceTime) || ""}`.trim(),
        `예약 상세에서 확인·확정해주세요.`,
      ].join("\n");

    case NotificationType.ZALO_LISTENER_DOWN:
      // 수신자=운영자 → 한국어. 리스너 미연결 경보(워치독) — credential·비번 미포함, 계정 표시명·경과만.
      return [
        `📵 Zalo 수신 연결 끊김: ${str(p.accountName) || "계정"}`,
        `${num(p.downMinutes)}분째 미연결 — 이 계정의 수신 메시지가 도착하지 않습니다.`,
        `사유: ${str(p.lastError, "알 수 없음")}`,
        `해당 관리자 폰으로 /zalo-connect 에서 QR 재로그인해주세요.`,
      ].join("\n");

    case NotificationType.WEBCHAT_NEW_MESSAGE: {
      // 수신자=운영자(테오) → 한국어. 홈페이지 웹 채팅 신규 문의 알림(T-webchat-mvp).
      // payload는 lib/webchat-notify가 화이트리스트로 구성 — 방문자 연락처·원문 전문·판매가·마진 미포함.
      // preview=ko 번역 미리보기 120자(webchat-notify에서 절삭). adminUrl=상대경로 → base 접두로 절대경로화.
      const preview = str(p.preview, "(내용 없음)");
      const lines = [
        `🌐 웹 채팅 새 문의 (언어: ${str(p.visitorLocale)})`,
        preview,
      ];
      const adminPath =
        typeof p.adminUrl === "string" && p.adminUrl.startsWith("/") ? p.adminUrl : null;
      const base = (
        process.env.VILLA_PUBLIC_BASE_URL ||
        process.env.NEXTAUTH_URL ||
        ""
      ).replace(/\/+$/, "");
      if (adminPath) lines.push(base ? `${base}${adminPath}` : adminPath);
      return lines.join("\n");
    }

    case NotificationType.MARKETING_ALERT: {
      // 수신자=운영자 → 한국어. 마케팅 자동화 통지(IG 초안·IG/YT 발행실패·YT 토큰·성과·편집 잡).
      // ★ 화이트리스트 필드(kind·summary·href)만 — 판매가·마진 개념 없음. href는 base 접두로 절대경로화(로그인 게이트).
      const kind = typeof p.kind === "string" ? p.kind : "";
      const prefix = MARKETING_ALERT_PREFIX[kind] ?? "📣 마케팅 알림";
      const lines = [`${prefix}: ${str(p.summary, "상세는 관리자 화면에서 확인해주세요.")}`];
      const hrefPath = typeof p.href === "string" && p.href.startsWith("/") ? p.href : null;
      const base = (
        process.env.VILLA_PUBLIC_BASE_URL ||
        process.env.NEXTAUTH_URL ||
        ""
      ).replace(/\/+$/, "");
      if (hrefPath && base) lines.push(`${base}${hrefPath}`);
      return lines.join("\n");
    }
  }
}

// ===================== 큐 적재 (비즈니스 로직 진입점) =====================

export interface EnqueueNotificationParams {
  userId: string;
  type: NotificationType;
  payload: Record<string, unknown>;
  /** 비즈니스 트랜잭션 안에서 원자적으로 적재할 때 tx 주입 (T1.3·T1.8 패턴) */
  db?: DbClient;
  /**
   * 그룹 발송 대상 thread id (ADR-0040) — 설정 시 dispatchOne이 시스템봇 ThreadType.Group으로 발송한다.
   * 운영자 그룹 라우팅은 lib/operator-notify.enqueueOperatorNotification가 채운다(직접 호출 지양).
   */
  groupThreadId?: string | null;
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
      ...(params.groupThreadId ? { groupThreadId: params.groupThreadId } : {}),
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

/** 정산서 PDF Buffer → 봇 첨부 (순수). 파일명 quyet-toan-{YYYY-MM}.pdf. */
export function buildStatementAttachment(
  buffer: Buffer,
  yearMonth: string
): BotAttachment {
  const safe = yearMonth.replace(/[^0-9-]/g, "") || "statement";
  return {
    data: buffer,
    filename: `quyet-toan-${safe}.pdf`,
    totalSize: buffer.length,
  };
}

/**
 * SETTLEMENT_READY 알림의 정산서 PDF 첨부 해석 — private/statements 파일을 읽어 첨부로.
 * 미생성이면 정산서 서비스(동적 import, react-pdf 포함)로 온디맨드 생성 후 재읽기.
 * 어떤 실패든 null 반환 → 호출부는 텍스트 발송으로 graceful 폴백.
 */
async function resolveStatementAttachment(
  notification: DispatchTarget
): Promise<BotAttachment | null> {
  if (notification.type !== NotificationType.SETTLEMENT_READY) return null;
  const payload = notification.payload as Record<string, unknown> | null;
  const settlementId =
    typeof payload?.settlementId === "string" ? payload.settlementId : null;
  if (!settlementId) return null;
  try {
    const [{ getStatementDir, statementFileName }, fsmod, pathmod] = await Promise.all([
      import("@/lib/storage"),
      import("fs/promises"),
      import("path"),
    ]);
    const filePath = pathmod.join(getStatementDir(), statementFileName(settlementId));
    let buffer: Buffer;
    try {
      buffer = await fsmod.readFile(filePath);
    } catch {
      // 미생성 — 온디맨드 생성 후 재읽기
      const { generateSettlementStatement } = await import(
        "@/lib/settlement-statement-service"
      );
      const saved = await generateSettlementStatement(settlementId, "system:zalo-dispatch");
      if (!saved) return null;
      buffer = await fsmod.readFile(filePath);
    }
    const yearMonth =
      typeof payload?.yearMonth === "string" ? payload.yearMonth : "statement";
    return buildStatementAttachment(buffer, yearMonth);
  } catch {
    return null; // 첨부 실패 → 텍스트 발송 폴백 (발송 누락 없음)
  }
}

/**
 * 그룹방 발송 (ADR-0040) — 시스템봇 ThreadType.Group 1건. groupThreadId 있는 Notification 전용.
 *  - user.zaloUserId 미참조(소유자 미연결이어도 발송 가능·재시도 유지).
 *  - 첨부 없음: 그룹 라우팅 대상(GROUP_ROUTED_TYPES)은 전부 텍스트 알림(SETTLEMENT_READY 등 첨부류 제외).
 *  - 에러 정책은 개별 DM과 동일: BOT_NOT_CONNECTED=attempt 미증가 재시도, 그 외=attempt+1 일반 재시도(3회).
 *  - 미러: ownerAdminId_zaloUserId findUnique의 zaloUserId 자리에 groupThreadId를 넘기면 GROUP 대화 행에 매칭.
 */
async function dispatchGroupOne(
  notification: DispatchTarget,
  summary: DispatchSummary,
  groupThreadId: string,
  attempt: number
): Promise<void> {
  // 본문 빌더는 화이트리스트 필드만 → 마진·판매가 미노출 (개별 DM과 동일 빌더 재사용).
  const text = buildNotificationText(
    notification.type,
    notification.payload as Record<string, unknown> | null
  );
  const result = await sendBotGroupMessage(groupThreadId, text);

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

  // 성공 — SENT 전환. 미러 실패가 SENT 상태를 되돌리지 않도록 별도 처리.
  await prisma.notification.update({
    where: { id: notification.id },
    data: { status: NotificationStatus.SENT, sentAt: new Date(), error: null },
  });
  summary.sent += 1;

  // ZaloMessage(SYSTEM·OUTBOUND) 미러 — GROUP 대화(zaloUserId 슬롯=groupThreadId)에 기록.
  //   시스템봇 소유자 미상·그룹 대화 부재면 미러 생략(발송 자체는 유효).
  try {
    const systemOwnerId = await getSystemBotOwnerId();
    if (!systemOwnerId) {
      summary.mirrorSkipped += 1;
      return;
    }
    const conversation = await prisma.zaloConversation.findUnique({
      where: {
        ownerAdminId_zaloUserId: { ownerAdminId: systemOwnerId, zaloUserId: groupThreadId },
      },
      select: { id: true },
    });
    if (!conversation) {
      summary.mirrorSkipped += 1;
      return;
    }
    await prisma.zaloMessage.create({
      data: {
        conversationId: conversation.id,
        direction: ZaloMessageDirection.OUTBOUND,
        source: ZaloMessageSource.SYSTEM,
        msgType: "text",
        text,
        attachmentUrls: [],
        zaloMsgId: result.messageId,
        status: ZaloMessageStatus.SENT,
      },
    });
    await prisma.zaloConversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: new Date(), lastMessageText: text, lastMessageType: "text" },
    });
  } catch (e) {
    console.error(`[zalo] 알림 ${notification.id} 그룹 ZaloMessage 미러 기록 실패`, e);
    summary.mirrorSkipped += 1;
  }
}

async function dispatchOne(
  notification: DispatchTarget,
  summary: DispatchSummary
): Promise<void> {
  const attempt = getAttemptCount(notification.payload);

  // 0) 그룹 발송 분기 (ADR-0040) — NO_ZALO_LINK 판정보다 **먼저**.
  //    그룹 행(groupThreadId)은 user.zaloUserId를 절대 참조하지 않는다:
  //    시스템봇 소유자가 Zalo 미연결이어도 영구 FAILED(NO_ZALO_LINK)로 사장되면 안 되기 때문
  //    (TDA 지적 사고 지점 — 소유자 zaloUserId 유무와 그룹 발송 가능성은 무관).
  if (notification.groupThreadId) {
    await dispatchGroupOne(notification, summary, notification.groupThreadId, attempt);
    return;
  }

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
  // 정산서 PDF 첨부(SETTLEMENT_READY) — 있으면 파일 첨부 발송, 없으면 기존 텍스트 발송(폴백).
  const attachment = await resolveStatementAttachment(notification);
  const sentFile = attachment != null;
  const result = attachment
    ? await sendBotMessageWithAttachments(zaloUserId, text, [attachment])
    : await sendBotMessage(zaloUserId, text);

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
    let attachmentUrls = extractAttachmentUrls(notification.payload);
    // 정산서 PDF 파일 발송 시 — 미러에 다운로드 경로 기록 + msgType "file" (이미지와 구분).
    if (sentFile && attachmentUrls.length === 0) {
      const sp = (notification.payload as Record<string, unknown> | null)?.statementPath;
      if (typeof sp === "string") attachmentUrls = [sp];
    }
    const msgType = sentFile
      ? "file"
      : attachmentUrls.length > 0
        ? "image"
        : "text";
    await prisma.zaloMessage.create({
      data: {
        conversationId: conversation.id,
        direction: ZaloMessageDirection.OUTBOUND,
        source: ZaloMessageSource.SYSTEM,
        msgType,
        text,
        attachmentUrls,
        zaloMsgId: result.messageId,
        status: ZaloMessageStatus.SENT,
      },
    });
    await prisma.zaloConversation.update({
      where: { id: conversation.id },
      data: {
        lastMessageAt: new Date(),
        // 인박스 미리보기 비정규화(perf) — 발신 본문·타입 캐시.
        lastMessageText: text,
        lastMessageType: msgType,
      },
    });
  } catch (e) {
    // 미러는 채팅 UI 표시용 부가 기록 — 실패해도 발송 자체(SENT)는 유효
    console.error(`[zalo] 알림 ${notification.id} ZaloMessage 미러 기록 실패`, e);
    summary.mirrorSkipped += 1;
  }
}
