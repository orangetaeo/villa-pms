// B2C 소비자 결제 약관·공시 문구 + 공개 화면 표시 계산 (ADR-0048 P5).
//   문구 정본 = docs/business/b2c-payment-terms-draft.md (테오 확정 2026-07-24).
//   /p 다른 라벨(PUBLIC_LABELS)과 동일하게 **코드 상수**로 둔다(요율·선행일만 AppSetting로 조정).
//   계약금 50% / 잔금 체크인 D-14 / 14일 이내 100% 선결제 / 잔금 원화는 D-14 환율로 확정(공시).
import type { PublicLang } from "./public-i18n";
import { computeB2cSchedule } from "./b2c-payment";

/** 약관 문구 버전 — 동의 스냅샷(policyConsentJson.b2c.fxDisclosureVersion) 추적용. 문구 변경 시 +1. */
export const B2C_TERMS_VERSION = 1;

export interface B2cTermsText {
  /** 카드 제목 */
  heading: string;
  /** 금액 행 라벨: 계약금 / 잔금(약) / 전액 */
  depositLabel: string;
  balanceLabel: string;
  fullLabel: string;
  /** 결제 안내 줄들 (계약금·잔금·임박예약·통화) */
  paymentLines: string[];
  /** ★잔금 환율 변동 공시 (강조 노출) */
  fxDisclosure: string;
  /** 취소·환불 고지 (기존 취소규정 표와 함께) */
  cancelNote: string;
}

/** 지원 5언어 결제 약관 문구 (일본어 제외 — 테오 2026-07-24). */
export const B2C_PAYMENT_TERMS: Record<PublicLang, B2cTermsText> = {
  ko: {
    heading: "결제 안내",
    depositLabel: "계약금",
    balanceLabel: "잔금 (약)",
    fullLabel: "전액 선결제",
    paymentLines: [
      "예약을 확정하려면 계약금 50%를 입금해 주세요. 나머지 잔금은 체크인 14일 전에 안내드립니다.",
      "체크인까지 14일 이내에 예약하시는 경우 전액(100%)을 한 번에 결제합니다.",
      "결제 통화는 안내받으신 계좌 기준입니다(한국 고객은 원화 계좌).",
    ],
    fxDisclosure:
      "잔금 원화 금액은 잔금 청구 시점(체크인 14일 전)의 환율로 확정되며, 계약금 때와 다를 수 있습니다. 숙박 요금 자체는 현지 통화 기준으로 고정되어 있고, 환율에 따른 원화 환산액만 달라집니다.",
    cancelNote:
      "취소 시 환불은 아래 취소 규정의 환불율에 따르며, 결제하신 통화·금액 그대로 환불됩니다(환율 재계산 없음).",
  },
  vi: {
    heading: "Hướng dẫn thanh toán",
    depositLabel: "Tiền cọc",
    balanceLabel: "Còn lại (ước tính)",
    fullLabel: "Thanh toán toàn bộ",
    paymentLines: [
      "Để xác nhận đặt phòng, vui lòng thanh toán tiền cọc 50%. Phần còn lại sẽ được thông báo 14 ngày trước khi nhận phòng.",
      "Nếu đặt trong vòng 14 ngày trước khi nhận phòng, quý khách thanh toán toàn bộ (100%) một lần.",
      "Loại tiền thanh toán theo tài khoản được hướng dẫn.",
    ],
    fxDisclosure:
      "Số tiền còn lại (quy đổi) được chốt theo tỷ giá tại thời điểm thông báo (14 ngày trước nhận phòng), có thể khác lúc đặt cọc. Giá phòng gốc theo VND là cố định; chỉ số tiền quy đổi thay đổi theo tỷ giá.",
    cancelNote:
      "Khi hủy, hoàn tiền theo tỷ lệ trong quy định hủy phòng dưới đây, và được hoàn đúng loại tiền và số tiền đã thanh toán (không quy đổi lại).",
  },
  en: {
    heading: "Payment",
    depositLabel: "Deposit",
    balanceLabel: "Balance (approx.)",
    fullLabel: "Full payment",
    paymentLines: [
      "To confirm your booking, please pay a 50% deposit. The balance will be requested 14 days before check-in.",
      "For bookings made within 14 days of check-in, the full amount (100%) is due at once.",
      "Payment currency follows the account provided to you.",
    ],
    fxDisclosure:
      "The converted balance amount is fixed at the exchange rate on the request date (14 days before check-in) and may differ from the deposit. The room price in local currency (VND) is fixed; only the converted amount varies with the exchange rate.",
    cancelNote:
      "On cancellation, refunds follow the refund rates in the cancellation policy below, returned in the exact currency and amount you paid (no re-conversion).",
  },
  zh: {
    heading: "付款说明",
    depositLabel: "定金",
    balanceLabel: "余款（约）",
    fullLabel: "全额付款",
    paymentLines: [
      "如需确认预订，请支付 50% 定金。余款将在入住前 14 天通知。",
      "若在入住前 14 天以内预订，需一次性支付全额（100%）。",
      "付款货币以向您提供的账户为准。",
    ],
    fxDisclosure:
      "余款的折算金额将按通知日（入住前 14 天）的汇率确定，可能与支付定金时不同。房费本身以当地货币（VND）固定，仅折算金额随汇率变动。",
    cancelNote:
      "取消时，退款依照以下取消政策的退款比例，并按您支付的原币种与金额退还（不重新折算）。",
  },
  ru: {
    heading: "Оплата",
    depositLabel: "Депозит",
    balanceLabel: "Остаток (прибл.)",
    fullLabel: "Полная оплата",
    paymentLines: [
      "Чтобы подтвердить бронирование, внесите депозит 50%. Остаток будет запрошен за 14 дней до заезда.",
      "При бронировании менее чем за 14 дней до заезда оплачивается вся сумма (100%) сразу.",
      "Валюта оплаты — согласно предоставленному вам счёту.",
    ],
    fxDisclosure:
      "Пересчитанная сумма остатка фиксируется по курсу на дату запроса (за 14 дней до заезда) и может отличаться от депозита. Стоимость проживания в местной валюте (VND) фиксирована; меняется только сумма пересчёта.",
    cancelNote:
      "При отмене возврат осуществляется согласно ставкам возврата в правилах отмены ниже, в той же валюте и сумме, которые вы оплатили (без повторного пересчёта).",
  },
};

/** 공개 화면 표시용 결제 분할 (청구통화 최소단위 그대로). computeB2cSchedule의 통화 무관 산식 재사용. */
export interface B2cDisplaySplit {
  /** 체크인 임박(D-lead 이내) → 전액 선결제(계약금=총액, 잔금 0) */
  fullPrepay: boolean;
  /** 계약금(확정) — 청구통화 최소단위. */
  deposit: bigint;
  /** 잔금(약) — 청구통화 최소단위. fullPrepay면 0. deposit + balanceApprox = 총액. */
  balanceApprox: bigint;
}

/**
 * 제안/예약의 청구통화 총액을 계약금/잔금으로 분할 (표시 전용).
 * ⚠ 여기서 산출한 잔금은 "약(approx)" — 실제 잔금 청구통화 금액은 D-14 환율로 확정(ADR-0048). VND 앵커는 고정.
 * @param billingTotal 청구통화 총액(최소단위, KRW=원·VND=동·USD=센트 등 정수). 음수·0은 전부 0 분할.
 */
export function computeB2cDisplaySplit(
  billingTotal: bigint,
  opts: { checkIn: Date; now: Date; depositRatePct: number; balanceLeadDays: number }
): B2cDisplaySplit {
  // computeB2cSchedule의 분할·D-lead 판정은 통화 무관(퍼센트+날짜) — 청구통화 총액을 그대로 넣어 재사용.
  const s = computeB2cSchedule({
    totalVnd: billingTotal > 0n ? billingTotal : 0n,
    checkIn: opts.checkIn,
    now: opts.now,
    depositRatePct: opts.depositRatePct,
    balanceLeadDays: opts.balanceLeadDays,
  });
  return { fullPrepay: s.fullPrepay, deposit: s.depositDueVnd, balanceApprox: s.balanceDueVnd };
}
