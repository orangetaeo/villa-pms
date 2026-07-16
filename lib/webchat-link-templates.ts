// lib/webchat-link-templates.ts — 게스트 링크 안내문 템플릿 (T-webchat-guest-link-share)
//
// 운영자가 채팅에서 원클릭으로 "방문자 언어 안내문 + 게스트 링크"를 발송할 때 쓰는 사전 번역 문구.
//   ★Gemini 미경유 — 5언어(ko/vi/en/zh/ru) 사전 번역이라 번역 비용 0·번역 실패 0·URL 훼손 0.
//   ★5언어 밖 locale(hi 등 미래 언어)은 en 폴백(웹챗 번역 대상 집합과 동일 정책).
//   ★URL은 번역문과 분리 — 본문 뒤에 줄바꿈 후 붙인다(번역문 안에 URL이 섞이지 않게).
//   문구는 자연스러운 초안(추후 LOC 감수 예정). 브랜드명 "Villa GO".

/** 발송 가능한 링크 종류 — /g(체크인) · /g/options(부가서비스) · /g/receipt(영수증) · /p(제안 링크). */
export type LinkKind = "checkin" | "options" | "receipt" | "proposal";

/** 사전 번역 지원 언어(웹챗 5언어와 동일). */
const TEMPLATE_LOCALES = ["ko", "vi", "en", "zh", "ru"] as const;
export type TemplateLocale = (typeof TEMPLATE_LOCALES)[number];

// kind × locale → 안내문 본문(URL 제외). URL은 renderLinkMessage에서 본문 뒤에 줄바꿈으로 삽입.
const BODY: Record<LinkKind, Record<TemplateLocale, string>> = {
  checkin: {
    ko: "[Villa GO] 체크인 안내입니다. 아래 링크에서 여권 등록과 동의서 서명을 진행해 주세요. 감사합니다.",
    vi: "[Villa GO] Hướng dẫn nhận phòng. Quý khách vui lòng khai báo hộ chiếu và ký bản đồng ý qua liên kết bên dưới. Xin cảm ơn.",
    en: "[Villa GO] Here is your check-in guide. Please register your passport and sign the agreement using the link below. Thank you.",
    zh: "[Villa GO] 这是您的入住指引。请通过以下链接登记护照并签署同意书。谢谢。",
    ru: "[Villa GO] Информация для заезда. Пожалуйста, зарегистрируйте паспорт и подпишите согласие по ссылке ниже. Спасибо.",
  },
  options: {
    ko: "[Villa GO] 부가서비스 안내입니다. 아래 링크에서 마사지·투어·픽업 등 원하시는 서비스를 신청하실 수 있습니다.",
    vi: "[Villa GO] Dịch vụ bổ sung. Quý khách có thể đặt massage, tour, đưa đón và nhiều dịch vụ khác qua liên kết bên dưới.",
    en: "[Villa GO] Add-on services. You can book massage, tours, pickup and more using the link below.",
    zh: "[Villa GO] 附加服务。您可以通过以下链接预订按摩、旅游、接送等服务。",
    ru: "[Villa GO] Дополнительные услуги. Вы можете заказать массаж, туры, трансфер и другое по ссылке ниже.",
  },
  receipt: {
    ko: "[Villa GO] 체크아웃 정산 내역서입니다. 아래 링크에서 이용 내역과 보증금 환불 내역을 확인하실 수 있습니다.",
    vi: "[Villa GO] Bảng kê thanh toán khi trả phòng. Quý khách có thể xem chi tiết chi phí và hoàn tiền đặt cọc qua liên kết bên dưới.",
    en: "[Villa GO] Your check-out receipt. You can review your charges and deposit refund using the link below.",
    zh: "[Villa GO] 您的退房结算单。您可以通过以下链接查看消费明细和押金退款。",
    ru: "[Villa GO] Итоговый счёт при выезде. Вы можете посмотреть детали расходов и возврат депозита по ссылке ниже.",
  },
  proposal: {
    ko: "[Villa GO] 요청하신 빌라 제안입니다. 아래 링크에서 빌라 정보와 가격을 확인하신 뒤 마음에 드시는 빌라로 예약을 신청하실 수 있습니다. 링크에는 유효기간이 있으니 기간 내에 확인 부탁드립니다.",
    vi: "[Villa GO] Đây là đề xuất biệt thự theo yêu cầu của Quý khách. Quý khách vui lòng xem thông tin và giá qua liên kết bên dưới, sau đó đặt biệt thự mình ưng ý. Liên kết có thời hạn hiệu lực, kính mong Quý khách kiểm tra trong thời gian đó.",
    en: "[Villa GO] Here is the villa proposal you requested. Please review the villa details and prices using the link below, then request a booking for the villa you like. The link has an expiry date, so please check it in time.",
    zh: "[Villa GO] 这是您所需的别墅提案。请通过以下链接查看别墅信息和价格，然后选择您心仪的别墅提交预订申请。链接设有有效期，请在期限内查看。",
    ru: "[Villa GO] Это предложение вилл по вашему запросу. Пожалуйста, ознакомьтесь с информацией и ценами по ссылке ниже, а затем отправьте заявку на понравившуюся виллу. Ссылка действует ограниченное время, просьба проверить её вовремя.",
  },
};

export interface RenderedLinkMessage {
  /** 운영자 기록용 ko 원문(본문 + 줄바꿈 + URL) — WebChatMessage.text에 저장. */
  ko: string;
  /** 방문자 언어 완성문(본문 + 줄바꿈 + URL) — translatedText에 직접 기록(번역 미경유). */
  visitor: string;
  /** 방문자 완성문의 실제 언어(5언어 밖이면 en 폴백) — translatedTo에 기록. */
  visitorLocale: TemplateLocale;
}

/** 임의 locale 문자열을 지원 5언어로 정규화(밖이면 en 폴백). */
function resolveTemplateLocale(locale: string | null | undefined): TemplateLocale {
  const s = (locale ?? "").trim().toLowerCase();
  return (TEMPLATE_LOCALES as readonly string[]).includes(s) ? (s as TemplateLocale) : "en";
}

/**
 * kind·방문자 locale·URL로 안내문 조립.
 *   ko 원문(운영자 기록용) + 방문자 언어 완성문(translatedText용)을 동시에 반환.
 *   URL은 각 본문 뒤에 줄바꿈으로 붙인다(번역문과 URL 분리 — URL 훼손 0).
 */
export function renderLinkMessage(
  kind: LinkKind,
  locale: string | null | undefined,
  url: string
): RenderedLinkMessage {
  const visitorLocale = resolveTemplateLocale(locale);
  const compose = (loc: TemplateLocale) => `${BODY[kind][loc]}\n${url}`;
  return {
    ko: compose("ko"),
    visitor: compose(visitorLocale),
    visitorLocale,
  };
}
