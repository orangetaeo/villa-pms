// lib/webchat-widget-i18n.ts — 방문자 위젯 문구 사전 (T-webchat-mvp)
//
// ⚠ next-intl·admin 번들과 완전 분리(공개 위젯 경량·누수 방지). 위젯은 이 사전만 사용한다.
// 번역은 FE 최선(LOC 후속 감수 대상). 오프라인 안내 시각(09:00~22:00 ICT)은 5언어 고정.
// 지원 언어: vi/ko/en/zh/ru (기획 D9). 미지원 locale은 en 폴백(coerceWebChatLocale).

import type { WebChatLocale } from "@/lib/webchat-constants";

export interface WidgetStrings {
  /** 헤더 부제(브랜드명 Villa GO는 고정). */
  headerSubtitle: string;
  /** 최초 인사 버블. */
  greeting: string;
  /** 입력창 placeholder. */
  placeholder: string;
  /** 전송 버튼(aria-label). */
  send: string;
  /** OUTBOUND 원문(ko) 펼치기. */
  showOriginal: string;
  /** OUTBOUND 원문 접기. */
  hideOriginal: string;
  /** 번역 실패 안내(원문 표시 상태). */
  translationFailed: string;
  /** 첫 발신 직후 시스템 버블(응답 시간 안내). */
  afterSendNotice: string;
  /** 운영자 오프라인/미응답 안내(고정 시간대). */
  offlineNotice: string;
  /** 연락처 남기기 버튼(시스템 버블 내). */
  leaveContact: string;
  /** 연락처 카드 제목. */
  contactTitle: string;
  /** Zalo 입력 라벨/placeholder. */
  contactZalo: string;
  /** 이메일 입력 라벨/placeholder. */
  contactEmail: string;
  /** 연락처 저장 버튼. */
  contactSave: string;
  /** 연락처 건너뛰기. */
  contactSkip: string;
  /** 연락처 저장 후 감사 버블. */
  contactSaved: string;
  /** PII 고지 1줄(하단 상시). */
  pii: string;
  /** 킬스위치(503) 안내. */
  paused: string;
  /** 세션 만료(410) 안내. */
  expired: string;
  /** 스로틀(429) 안내. */
  throttled: string;
  /** 차단(403) 안내. */
  blocked: string;
  /** 새 대화 시작 버튼(만료 시). */
  newChat: string;
  /** 일반 전송 실패(네트워크 등). */
  sendFailed: string;
  /** 링크 카드 문구(운영자가 보낸 체크인·부가서비스·영수증·제안 링크·빌라 공유). */
  card: {
    checkin: string;
    options: string;
    receipt: string;
    proposal: string;
    /** 빌라 공유 카드 제목. */
    villa: string;
    /** "열기" 버튼. */
    open: string;
    /** 빌라 공유 카드 "상세 보기" 버튼(공개 상세페이지 링크 있을 때만). */
    detail: string;
    /** 카드 부제(짧은 안내). */
    hint: string;
  };
}

const vi: WidgetStrings = {
  headerSubtitle: "Trò chuyện với chúng tôi",
  greeting: "Xin chào! 👋 Bạn cần hỗ trợ gì về villa ở Phú Quốc? Cứ nhắn bằng ngôn ngữ của bạn.",
  placeholder: "Nhập tin nhắn…",
  send: "Gửi",
  showOriginal: "Xem bản gốc",
  hideOriginal: "Ẩn bản gốc",
  translationFailed: "Không dịch được tin nhắn này — đây là bản gốc.",
  afterSendNotice: "Đã gửi! Chúng tôi thường trả lời trong vài phút.",
  offlineNotice: "Chúng tôi thường trả lời trong khung giờ 09:00–22:00 (giờ Việt Nam). Để lại liên hệ để được báo khi có trả lời nhé.",
  leaveContact: "Để lại liên hệ",
  contactTitle: "Để chúng tôi liên hệ lại với bạn",
  contactZalo: "Số Zalo",
  contactEmail: "Email",
  contactSave: "Lưu",
  contactSkip: "Để sau",
  contactSaved: "Cảm ơn bạn! Chúng tôi sẽ liên hệ lại sớm.",
  pii: "Tin nhắn và thông tin liên hệ của bạn được lưu để hỗ trợ bạn.",
  paused: "Kênh chat đang tạm đóng. Vui lòng nhắn Zalo cho chúng tôi.",
  expired: "Cuộc trò chuyện đã kết thúc. Bắt đầu cuộc mới nhé.",
  throttled: "Bạn gửi hơi nhanh — vui lòng thử lại sau giây lát.",
  blocked: "Cuộc trò chuyện này đã bị hạn chế.",
  newChat: "Bắt đầu trò chuyện mới",
  sendFailed: "Gửi không thành công. Vui lòng thử lại.",
  card: {
    checkin: "Hướng dẫn nhận phòng",
    options: "Đặt dịch vụ bổ sung",
    receipt: "Bảng kê thanh toán",
    proposal: "Đề xuất biệt thự",
    villa: "Thông tin biệt thự",
    open: "Mở",
    detail: "Xem chi tiết",
    hint: "Nhấn nút bên dưới để mở.",
  },
};

const ko: WidgetStrings = {
  headerSubtitle: "무엇이든 물어보세요",
  greeting: "안녕하세요! 👋 푸꾸옥 빌라에 대해 무엇을 도와드릴까요? 편한 언어로 남겨 주세요.",
  placeholder: "메시지를 입력하세요…",
  send: "보내기",
  showOriginal: "원문 보기",
  hideOriginal: "원문 숨기기",
  translationFailed: "이 메시지는 번역에 실패했어요 — 원문 그대로 보여드립니다.",
  afterSendNotice: "전송했어요! 보통 몇 분 안에 답변드립니다.",
  offlineNotice: "보통 09:00~22:00 (베트남 시간) 안에 답변드려요. 연락처를 남겨 주시면 답변 시 알려드릴게요.",
  leaveContact: "연락처 남기기",
  contactTitle: "답변을 받으실 연락처를 남겨 주세요",
  contactZalo: "Zalo 번호",
  contactEmail: "이메일",
  contactSave: "저장",
  contactSkip: "나중에",
  contactSaved: "감사합니다! 곧 연락드리겠습니다.",
  pii: "대화 내용과 연락처는 상담을 위해 저장됩니다.",
  paused: "지금은 채팅이 잠시 닫혀 있어요. Zalo로 문의해 주세요.",
  expired: "대화가 종료되었어요. 새 대화를 시작해 주세요.",
  throttled: "너무 빠르게 보내셨어요 — 잠시 후 다시 보내주세요.",
  blocked: "이 대화는 이용이 제한되었습니다.",
  newChat: "새 대화 시작",
  sendFailed: "전송하지 못했어요. 다시 시도해 주세요.",
  card: {
    checkin: "체크인 안내",
    options: "부가서비스 신청",
    receipt: "정산 영수증",
    proposal: "빌라 제안",
    villa: "빌라 안내",
    open: "열기",
    detail: "상세 보기",
    hint: "아래 버튼을 눌러 여세요.",
  },
};

const en: WidgetStrings = {
  headerSubtitle: "Chat with us",
  greeting: "Hi there! 👋 How can we help with your villa in Phu Quoc? Feel free to write in your own language.",
  placeholder: "Type a message…",
  send: "Send",
  showOriginal: "Show original",
  hideOriginal: "Hide original",
  translationFailed: "We couldn't translate this message — showing the original.",
  afterSendNotice: "Sent! We usually reply within a few minutes.",
  offlineNotice: "We usually reply between 09:00–22:00 (Vietnam time). Leave your contact and we'll notify you when we reply.",
  leaveContact: "Leave your contact",
  contactTitle: "Leave a contact so we can reach you",
  contactZalo: "Zalo number",
  contactEmail: "Email",
  contactSave: "Save",
  contactSkip: "Later",
  contactSaved: "Thank you! We'll be in touch soon.",
  pii: "Your messages and contact details are stored to assist you.",
  paused: "Chat is temporarily closed. Please message us on Zalo.",
  expired: "This conversation has ended. Please start a new one.",
  throttled: "You're sending a bit fast — please try again shortly.",
  blocked: "This conversation has been restricted.",
  newChat: "Start a new chat",
  sendFailed: "Couldn't send. Please try again.",
  card: {
    checkin: "Check-in guide",
    options: "Book add-on services",
    receipt: "Settlement receipt",
    proposal: "Villa proposal",
    villa: "Villa details",
    open: "Open",
    detail: "View details",
    hint: "Tap the button below to open.",
  },
};

const zh: WidgetStrings = {
  headerSubtitle: "在线咨询",
  greeting: "您好！👋 关于富国岛的别墅有什么可以帮您？可以用您的语言留言。",
  placeholder: "输入消息…",
  send: "发送",
  showOriginal: "查看原文",
  hideOriginal: "隐藏原文",
  translationFailed: "此消息无法翻译 —— 显示原文。",
  afterSendNotice: "已发送！我们通常几分钟内回复。",
  offlineNotice: "我们通常在 09:00–22:00（越南时间）回复。留下联系方式，回复时会通知您。",
  leaveContact: "留下联系方式",
  contactTitle: "留下联系方式，方便我们联系您",
  contactZalo: "Zalo 号码",
  contactEmail: "电子邮箱",
  contactSave: "保存",
  contactSkip: "稍后",
  contactSaved: "谢谢！我们会尽快与您联系。",
  pii: "您的消息和联系方式将被保存以便为您服务。",
  paused: "聊天暂时关闭，请通过 Zalo 联系我们。",
  expired: "对话已结束，请开始新的对话。",
  throttled: "您发送得有点快 —— 请稍后再试。",
  blocked: "此对话已被限制。",
  newChat: "开始新对话",
  sendFailed: "发送失败，请重试。",
  card: {
    checkin: "入住指引",
    options: "预订附加服务",
    receipt: "结算单",
    proposal: "别墅推荐",
    villa: "别墅详情",
    open: "打开",
    detail: "查看详情",
    hint: "点击下方按钮打开。",
  },
};

const ru: WidgetStrings = {
  headerSubtitle: "Напишите нам",
  greeting: "Здравствуйте! 👋 Чем помочь с виллой на Фукуоке? Пишите на своём языке.",
  placeholder: "Введите сообщение…",
  send: "Отправить",
  showOriginal: "Показать оригинал",
  hideOriginal: "Скрыть оригинал",
  translationFailed: "Не удалось перевести это сообщение — показан оригинал.",
  afterSendNotice: "Отправлено! Обычно мы отвечаем в течение нескольких минут.",
  offlineNotice: "Обычно мы отвечаем с 09:00 до 22:00 (время Вьетнама). Оставьте контакт — мы сообщим, когда ответим.",
  leaveContact: "Оставить контакт",
  contactTitle: "Оставьте контакт, чтобы мы могли связаться с вами",
  contactZalo: "Номер Zalo",
  contactEmail: "Эл. почта",
  contactSave: "Сохранить",
  contactSkip: "Позже",
  contactSaved: "Спасибо! Мы скоро свяжемся с вами.",
  pii: "Ваши сообщения и контакты сохраняются, чтобы мы могли вам помочь.",
  paused: "Чат временно закрыт. Напишите нам в Zalo.",
  expired: "Разговор завершён. Пожалуйста, начните новый.",
  throttled: "Вы отправляете слишком быстро — повторите попытку чуть позже.",
  blocked: "Этот разговор ограничен.",
  newChat: "Начать новый чат",
  sendFailed: "Не удалось отправить. Попробуйте ещё раз.",
  card: {
    checkin: "Инструкция для заезда",
    options: "Заказать дополнительные услуги",
    receipt: "Итоговый счёт",
    proposal: "Предложение вилл",
    villa: "О вилле",
    open: "Открыть",
    detail: "Подробнее",
    hint: "Нажмите кнопку ниже, чтобы открыть.",
  },
};

const DICT: Record<WebChatLocale, WidgetStrings> = { vi, ko, en, zh, ru };

/** 위젯 문구 조회(미지원 locale은 en 폴백은 호출측 coerceWebChatLocale 책임). */
export function widgetStrings(locale: WebChatLocale): WidgetStrings {
  return DICT[locale] ?? en;
}

/** 언어 칩 라벨(간결한 코드 표기). */
export const LOCALE_CHIP_LABEL: Record<WebChatLocale, string> = {
  vi: "VI",
  ko: "KO",
  en: "EN",
  zh: "中",
  ru: "RU",
};
