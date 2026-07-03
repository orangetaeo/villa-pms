// lib/partner-notify.ts — 파트너(여행사·랜드사) 알림 이중 채널 (T-partner-workflow-gaps ①)
//
//   채널 1: 인앱(InAppNotification) — Partner.userId(로그인 계정)가 있을 때 적재(파트너 포털 벨).
//   채널 2: Zalo 직접 발송 — Partner.contactZaloUid가 있을 때 시스템 봇으로 발송.
//            (파트너는 User 알림 큐가 아니라 contactZaloUid 직접 보유 — partner-invoices/send 패턴)
//   이벤트: 예약확정 · 홀드만료 · 청구서발행 · 연체전이 · 요청처리결과.
//
//   ★ 누수 금지(사업원칙 2): 텍스트에 마진·원가·KRW 판매가·신용한도 절대 미포함.
//     파트너에게 정당하게 청구되는 금액(자기 채권/청구서 VND)만 표기한다.
//   ★ 실패 격리: 알림 실패가 비즈니스 트랜잭션·API 응답을 깨지 않도록 notifyPartner는 절대 throw하지 않는다.
//   언어: Partner.country == "VN" → vi, 그 외(KR·null 포함) → ko (파트너 포털 기본 ko와 정합).
import { prisma } from "@/lib/prisma";
import { enqueueInAppNotification, formatVndDot } from "@/lib/inapp-notification";
import { sendBotMessage } from "@/lib/zalo-runtime";

export type PartnerNotifyLocale = "ko" | "vi";

export type PartnerNotifyEvent =
  | {
      kind: "BOOKING_CONFIRMED";
      bookingId: string;
      villaName: string;
      checkIn: string; // "yyyy-MM-dd"
      checkOut: string;
    }
  | {
      kind: "HOLD_EXPIRED";
      bookingId: string;
      villaName: string;
      checkIn: string;
      checkOut: string;
    }
  | {
      kind: "BOOKING_CANCELLED";
      bookingId: string;
      villaName: string;
      checkIn: string;
      checkOut: string;
    }
  | {
      kind: "BOOKING_MODIFIED";
      bookingId: string;
      villaName: string;
      checkIn: string; // 변경 후 일정
      checkOut: string;
      /** 변경 후 본인 채권 총액(BigInt 문자열) — 정당 금액만. 미변경/채권없음이면 null */
      newTotalVnd?: string | null;
    }
  | {
      kind: "INVOICE_ISSUED";
      invoiceId: string;
      invoiceNo: string;
      dueDate: string; // "yyyy-MM-dd"
      totalVnd: string; // BigInt 문자열 — 파트너 본인 청구 총액(정당 금액)
    }
  | {
      kind: "RECEIVABLE_OVERDUE";
      count: number;
      outstandingVnd: string; // BigInt 문자열 — 본인 연체 잔액 합
    }
  | {
      kind: "CHANGE_REQUEST_RESOLVED";
      bookingId: string;
      villaName: string;
      requestKind: string; // "CANCEL" | "MODIFY" | "HOLD_EXTEND"
      approved: boolean;
      resolutionNote?: string | null;
    };

export type PartnerNotifText = { title: string; body: string };

/** Partner.country → 알림 언어. VN만 vi, 그 외(한국 여행사 다수·null)는 ko. */
export function partnerNotifyLocale(country?: string | null): PartnerNotifyLocale {
  return country === "VN" ? "vi" : "ko";
}

const REQUEST_KIND_LABEL: Record<PartnerNotifyLocale, Record<string, string>> = {
  ko: { CANCEL: "취소 요청", MODIFY: "변경 요청", HOLD_EXTEND: "홀드 연장 요청" },
  vi: { CANCEL: "yêu cầu hủy", MODIFY: "yêu cầu thay đổi", HOLD_EXTEND: "yêu cầu gia hạn giữ chỗ" },
};

/** 이벤트 → 파트너 알림 제목/본문 (순수함수 — 단위테스트 대상). 금액은 본인 청구 VND만. */
export function buildPartnerNotifText(
  locale: PartnerNotifyLocale,
  ev: PartnerNotifyEvent
): PartnerNotifText {
  const ko = locale === "ko";
  switch (ev.kind) {
    case "BOOKING_CONFIRMED":
      return {
        title: ko ? "예약이 확정되었습니다" : "Đặt phòng đã được xác nhận",
        body: `${ev.villaName} · ${ev.checkIn} ~ ${ev.checkOut}`,
      };
    case "HOLD_EXPIRED":
      return {
        title: ko ? "가예약이 만료되었습니다" : "Giữ chỗ đã hết hạn",
        body: ko
          ? `${ev.villaName} · ${ev.checkIn} ~ ${ev.checkOut} · 재진행이 필요하면 연락해 주세요.`
          : `${ev.villaName} · ${ev.checkIn} ~ ${ev.checkOut} · Vui lòng liên hệ nếu cần đặt lại.`,
      };
    case "BOOKING_CANCELLED":
      // ★ 취소 사유는 미포함 — 운영 내부 표현이 섞일 수 있어 사실(취소·기간)만 전달.
      return {
        title: ko ? "예약이 취소되었습니다" : "Đặt phòng đã bị hủy",
        body: `${ev.villaName} · ${ev.checkIn} ~ ${ev.checkOut}`,
      };
    case "BOOKING_MODIFIED": {
      const total = ev.newTotalVnd
        ? ` · ${ko ? "변경 후 금액" : "Tổng mới"} ${formatVndDot(ev.newTotalVnd)}`
        : "";
      return {
        title: ko ? "예약이 변경되었습니다" : "Đặt phòng đã được thay đổi",
        body: `${ev.villaName} · ${ev.checkIn} ~ ${ev.checkOut}${total}`,
      };
    }
    case "INVOICE_ISSUED":
      return {
        title: ko ? "청구서가 발행되었습니다" : "Hóa đơn mới đã được phát hành",
        body: ko
          ? `${ev.invoiceNo} · 총 ${formatVndDot(ev.totalVnd)} · 기한 ${ev.dueDate}`
          : `${ev.invoiceNo} · Tổng ${formatVndDot(ev.totalVnd)} · Hạn ${ev.dueDate}`,
      };
    case "RECEIVABLE_OVERDUE":
      return {
        title: ko ? "연체된 미수금이 있습니다" : "Có công nợ quá hạn",
        body: ko
          ? `연체 ${ev.count}건 · 잔액 ${formatVndDot(ev.outstandingVnd)} · 확인 후 입금 부탁드립니다.`
          : `${ev.count} khoản quá hạn · Còn lại ${formatVndDot(ev.outstandingVnd)} · Vui lòng thanh toán.`,
      };
    case "CHANGE_REQUEST_RESOLVED": {
      const kindLabel = REQUEST_KIND_LABEL[locale][ev.requestKind] ?? ev.requestKind;
      const note = ev.resolutionNote?.trim() ? ` · ${ev.resolutionNote.trim()}` : "";
      return {
        title: ev.approved
          ? ko
            ? "요청이 처리되었습니다"
            : "Yêu cầu đã được xử lý"
          : ko
            ? "요청이 거절되었습니다"
            : "Yêu cầu bị từ chối",
        body: `${ev.villaName} · ${kindLabel}${note}`,
      };
    }
  }
}

/** 이벤트 → 파트너 포털 이동 경로(인앱 알림 href). */
export function partnerNotifHref(ev: PartnerNotifyEvent): string {
  switch (ev.kind) {
    case "BOOKING_CONFIRMED":
    case "HOLD_EXPIRED":
    case "BOOKING_CANCELLED":
    case "BOOKING_MODIFIED":
    case "CHANGE_REQUEST_RESOLVED":
      return `/partner/bookings/${ev.bookingId}`;
    case "INVOICE_ISSUED":
    case "RECEIVABLE_OVERDUE":
      return "/partner/receivables";
  }
}

export interface NotifyPartnerResult {
  inApp: boolean;
  zalo: boolean;
}

/**
 * 파트너에게 인앱 + Zalo 알림 발송. 트랜잭션 "커밋 후" 호출할 것(외부 발송 포함).
 * 어떤 실패도 throw하지 않는다(콘솔 경고만) — 알림은 비즈니스 흐름의 부수 채널.
 */
export async function notifyPartner(
  partnerId: string,
  ev: PartnerNotifyEvent
): Promise<NotifyPartnerResult> {
  const result: NotifyPartnerResult = { inApp: false, zalo: false };
  let partner: { userId: string | null; contactZaloUid: string | null; country: string | null } | null =
    null;
  try {
    partner = await prisma.partner.findUnique({
      where: { id: partnerId },
      select: { userId: true, contactZaloUid: true, country: true },
    });
  } catch (e) {
    console.warn("[partner-notify] 파트너 조회 실패", partnerId, e);
    return result;
  }
  if (!partner) return result;

  const locale = partnerNotifyLocale(partner.country);
  const text = buildPartnerNotifText(locale, ev);

  // 채널 1 — 인앱(로그인 계정 있을 때만)
  if (partner.userId) {
    try {
      await enqueueInAppNotification({
        userId: partner.userId,
        type: `PARTNER_${ev.kind}`,
        title: text.title,
        body: text.body,
        href: partnerNotifHref(ev),
      });
      result.inApp = true;
    } catch (e) {
      console.warn("[partner-notify] 인앱 적재 실패", partnerId, ev.kind, e);
    }
  }

  // 채널 2 — Zalo 직접 발송(연결 시). 봇 미연결 등 실패는 조용히 무시.
  const zaloUid = partner.contactZaloUid?.trim();
  if (zaloUid) {
    try {
      const sent = await sendBotMessage(zaloUid, `Villa Go | ${text.title}\n${text.body}`);
      result.zalo = sent.ok;
    } catch (e) {
      console.warn("[partner-notify] Zalo 발송 실패", partnerId, ev.kind, e);
    }
  }

  return result;
}
