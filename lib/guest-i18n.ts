// lib/guest-i18n.ts — /g/[token] 게스트 셀프 체크인 5개 언어 딕셔너리 (ADR-0019 S3)
//
// 설계: /p(public-i18n)와 동일 패턴 — 서버가 lang을 해석해 GUEST_LABELS[lang]을 클라이언트에 주입.
//   게스트=한국 여행객 기본 ko, ?lang=ko/vi/en/zh/ru 지원. PublicLang(ko/en/ru/zh/vi) 재사용.
// 범위: G1~G5 정적 UI 텍스트만 5개 언어. 빌라명·옵션명 등 동적 데이터는 카탈로그 ko/vi/en에서 해석.
// ⚠ 마진 비공개: 이 모듈은 라벨만 — 원가·마진 문자열 없음. 판매가 표기는 단위/통화 접미만 담당.

import type { PublicLang } from "@/lib/public-i18n";

export interface GuestLabels {
  brandTagline: string; // 헤더 보조 문구
  // 공통
  next: string;
  back: string;
  confirm: string;
  done: string;
  // 진행 단계 라벨 (4스텝)
  steps: { amenities: string; agreement: string; addons: string; done: string };
  stepCount: (cur: number, total: number) => string;
  // G1 예약 확인
  home: {
    kicker: string;
    title: string;
    subtitle: string;
    badgeConfirmed: string;
    nights: (n: number) => string;
    guests: (n: number) => string;
    breakfastOn: string;
    breakfastOff: string;
    privacyNote: string;
    startCta: string;
  };
  // G2 비품 확인
  amenities: {
    title: string;
    intro: string;
    minibarTitle: string;
    minibarPaid: string;
    stocked: (n: number) => string;
    minibarNote: string;
    confirmCheck: string;
    categories: { KITCHEN: string; BATHROOM: string; APPLIANCE: string; MINIBAR: string };
  };
  // G3 동의서
  agreement: {
    title: string;
    docTitleFallback: string;
    versionChip: (v: string) => string;
    signLabel: string;
    clear: string;
    signPrompt: string;
    signUploading: string;
    agreeCheck: string;
    submitCta: string;
    submitting: string;
    alreadySigned: string;
    alreadySignedAt: (v: string) => string;
    error: string;
  };
  // G4 옵션
  addons: {
    title: string;
    banner: string;
    optionLabel: string; // "옵션 선택"
    timeLabel: string; // "시간 선택"
    typeLabel: string; // "종류"
    addonsLabel: string; // "세부 시술 선택"
    addonsTrigger: (n: number) => string;
    selectedCount: (n: number) => string;
    apply: string;
    sheetTitle: string;
    sheetHint: string;
    estTotal: string;
    requestCta: string;
    requesting: string;
    requested: string; // 요청 완료 토스트
    error: string;
    perUnit: (label: string) => string;
    variantRequired: string;
    goNext: string; // 옵션 없이 다음
  };
  // G5 완료
  result: {
    title: string;
    subtitle: string;
    agreementDone: string;
    agreementDoneAt: (v: string) => string;
    requestedTitle: string;
    statusPending: string;
    statusConfirmed: string;
    statusOther: string;
    estTotal: string;
    settleNote: string;
    empty: string;
    finishCta: string;
  };
  footerNote: string;
}

// KRW 접미(ko "원" / 그 외 "₩") — public-i18n과 동일 규칙
const krwSuffix = (lang: PublicLang): string => (lang === "ko" ? "원" : "₩");

/** 판매가 표기 — KRW 우선(있으면), 없으면 VND. 천단위 쉼표는 formatThousands가 처리. */
export function guestKrwSuffix(lang: PublicLang): string {
  return krwSuffix(lang);
}

export const GUEST_LABELS: Record<PublicLang, GuestLabels> = {
  // ─────────────────────────────── 한국어 ───────────────────────────────
  ko: {
    brandTagline: "셀프 체크인",
    next: "다음",
    back: "뒤로",
    confirm: "확인",
    done: "완료",
    steps: { amenities: "비품 확인", agreement: "이용 동의", addons: "옵션 선택", done: "완료" },
    stepCount: (c, t) => `${c}/${t}`,
    home: {
      kicker: "셀프 체크인",
      title: "체크인을 시작합니다",
      subtitle: "도착 전 미리 비품 확인·동의서 서명·옵션 선택을 마치면 현장 절차가 빨라집니다.",
      badgeConfirmed: "예약 확정",
      nights: (n) => `${n}박`,
      guests: (n) => `성인 ${n}명`,
      breakfastOn: "조식 포함",
      breakfastOff: "조식 불포함",
      privacyNote: "이 링크는 고객님의 예약 한 건에만 연결됩니다. 약 2분이면 끝납니다.",
      startCta: "체크인 진행하기",
    },
    amenities: {
      title: "비품 확인",
      intro: "빌라에 비치된 비품입니다. 가볍게 확인하신 뒤 다음으로 넘어가 주세요.",
      minibarTitle: "미니바",
      minibarPaid: "소비 시 유료",
      stocked: (n) => `비치 ${n}개`,
      minibarNote: "소비하신 미니바는 체크아웃 시 정산됩니다 (현금/계좌이체).",
      confirmCheck: "비품을 확인했습니다",
      categories: { KITCHEN: "주방", BATHROOM: "욕실", APPLIANCE: "가전", MINIBAR: "미니바" },
    },
    agreement: {
      title: "이용 동의서",
      docTitleFallback: "빌라 이용 동의서",
      versionChip: (v) => `버전 ${v}`,
      signLabel: "서명",
      clear: "지우기",
      signPrompt: "여기에 서명해주세요",
      signUploading: "업로드 중…",
      agreeCheck: "위 내용에 동의하며 서명합니다",
      submitCta: "동의하고 서명 완료",
      submitting: "처리 중…",
      alreadySigned: "이용 동의서 서명이 완료되었습니다.",
      alreadySignedAt: (v) => `버전 ${v}`,
      error: "서명 처리 중 문제가 발생했습니다. 잠시 후 다시 시도해주세요.",
    },
    addons: {
      title: "옵션 선택",
      banner: "요청 후 운영자 확인 시 확정됩니다. 결제는 체크아웃 시 현금/계좌이체로 정산합니다.",
      optionLabel: "옵션 선택",
      timeLabel: "시간 선택",
      typeLabel: "종류",
      addonsLabel: "세부 시술 선택",
      addonsTrigger: (n) => `세부 시술 선택 (${n})`,
      selectedCount: (n) => `${n}개 선택`,
      apply: "적용",
      sheetTitle: "세부 시술 선택",
      sheetHint: "여러 개 선택할 수 있어요",
      estTotal: "합계 (예상)",
      requestCta: "이 옵션 요청하기",
      requesting: "요청 처리 중…",
      requested: "요청이 접수되었습니다.",
      error: "요청 처리 중 문제가 발생했습니다. 잠시 후 다시 시도해주세요.",
      perUnit: (l) => `/ ${l}`,
      variantRequired: "옵션을 선택해주세요",
      goNext: "옵션 없이 완료",
    },
    result: {
      title: "체크인 정보가\n접수되었습니다",
      subtitle: "도착하시면 빠르게 안내해 드리겠습니다.",
      agreementDone: "이용 동의서 서명 완료",
      agreementDoneAt: (v) => `버전 ${v}`,
      requestedTitle: "요청한 옵션",
      statusPending: "확인 대기",
      statusConfirmed: "확정",
      statusOther: "처리됨",
      estTotal: "예상 합계",
      settleNote: "미니바 및 선택하신 옵션은 체크아웃 시 정산됩니다 (현금/계좌이체). 운영자 확인 후 최종 금액을 안내해 드립니다.",
      empty: "아직 요청한 옵션이 없습니다.",
      finishCta: "확인",
    },
    footerNote: "문의사항은 예약하신 여행사로 연락해 주세요.",
  },

  // ─────────────────────────────── English ───────────────────────────────
  en: {
    brandTagline: "Self check-in",
    next: "Next",
    back: "Back",
    confirm: "Confirm",
    done: "Done",
    steps: { amenities: "Amenities", agreement: "Agreement", addons: "Options", done: "Done" },
    stepCount: (c, t) => `${c}/${t}`,
    home: {
      kicker: "Self check-in",
      title: "Let's start check-in",
      subtitle: "Confirming amenities, signing the agreement, and choosing options before arrival speeds up the on-site process.",
      badgeConfirmed: "Confirmed",
      nights: (n) => `${n} night${n === 1 ? "" : "s"}`,
      guests: (n) => `${n} adult${n === 1 ? "" : "s"}`,
      breakfastOn: "Breakfast included",
      breakfastOff: "No breakfast",
      privacyNote: "This link is tied to your single booking only. It takes about 2 minutes.",
      startCta: "Start check-in",
    },
    amenities: {
      title: "Amenities",
      intro: "These amenities are provided in the villa. Take a quick look and continue.",
      minibarTitle: "Minibar",
      minibarPaid: "Paid if consumed",
      stocked: (n) => `${n} stocked`,
      minibarNote: "Minibar items you consume are settled at check-out (cash/bank transfer).",
      confirmCheck: "I have reviewed the amenities",
      categories: { KITCHEN: "Kitchen", BATHROOM: "Bathroom", APPLIANCE: "Appliances", MINIBAR: "Minibar" },
    },
    agreement: {
      title: "Agreement",
      docTitleFallback: "Villa House Rules Agreement",
      versionChip: (v) => `Version ${v}`,
      signLabel: "Signature",
      clear: "Clear",
      signPrompt: "Sign here",
      signUploading: "Uploading…",
      agreeCheck: "I agree to the above and sign",
      submitCta: "Agree & sign",
      submitting: "Processing…",
      alreadySigned: "The house rules agreement has been signed.",
      alreadySignedAt: (v) => `Version ${v}`,
      error: "Something went wrong while signing. Please try again shortly.",
    },
    addons: {
      title: "Options",
      banner: "Requests are confirmed after the operator reviews them. Payment is settled at check-out (cash/bank transfer).",
      optionLabel: "Choose option",
      timeLabel: "Choose duration",
      typeLabel: "Type",
      addonsLabel: "Choose add-ons",
      addonsTrigger: (n) => `Choose add-ons (${n})`,
      selectedCount: (n) => `${n} selected`,
      apply: "Apply",
      sheetTitle: "Choose add-ons",
      sheetHint: "You can pick several",
      estTotal: "Estimated total",
      requestCta: "Request these options",
      requesting: "Submitting…",
      requested: "Your request has been received.",
      error: "Something went wrong. Please try again shortly.",
      perUnit: (l) => `/ ${l}`,
      variantRequired: "Please choose an option",
      goNext: "Finish without options",
    },
    result: {
      title: "Your check-in info\nhas been received",
      subtitle: "We'll guide you quickly upon arrival.",
      agreementDone: "House rules agreement signed",
      agreementDoneAt: (v) => `Version ${v}`,
      requestedTitle: "Requested options",
      statusPending: "Pending",
      statusConfirmed: "Confirmed",
      statusOther: "Processed",
      estTotal: "Estimated total",
      settleNote: "Minibar and selected options are settled at check-out (cash/bank transfer). The operator will confirm the final amount.",
      empty: "No options requested yet.",
      finishCta: "Done",
    },
    footerNote: "For inquiries, please contact your travel agency.",
  },

  // ─────────────────────────────── Русский ───────────────────────────────
  ru: {
    brandTagline: "Самостоятельное заселение",
    next: "Далее",
    back: "Назад",
    confirm: "Подтвердить",
    done: "Готово",
    steps: { amenities: "Удобства", agreement: "Соглашение", addons: "Опции", done: "Готово" },
    stepCount: (c, t) => `${c}/${t}`,
    home: {
      kicker: "Самостоятельное заселение",
      title: "Начнём заселение",
      subtitle: "Проверка удобств, подпись соглашения и выбор опций заранее ускоряют процесс на месте.",
      badgeConfirmed: "Подтверждено",
      nights: (n) => `${n} ноч.`,
      guests: (n) => `${n} взросл.`,
      breakfastOn: "Завтрак включён",
      breakfastOff: "Без завтрака",
      privacyNote: "Эта ссылка привязана только к вашему бронированию. Займёт около 2 минут.",
      startCta: "Начать заселение",
    },
    amenities: {
      title: "Удобства",
      intro: "Эти удобства предоставлены на вилле. Кратко ознакомьтесь и продолжите.",
      minibarTitle: "Мини-бар",
      minibarPaid: "Платно при использовании",
      stocked: (n) => `В наличии ${n}`,
      minibarNote: "Использованные позиции мини-бара оплачиваются при выезде (наличные/перевод).",
      confirmCheck: "Я ознакомился с удобствами",
      categories: { KITCHEN: "Кухня", BATHROOM: "Ванная", APPLIANCE: "Техника", MINIBAR: "Мини-бар" },
    },
    agreement: {
      title: "Соглашение",
      docTitleFallback: "Соглашение о правилах виллы",
      versionChip: (v) => `Версия ${v}`,
      signLabel: "Подпись",
      clear: "Очистить",
      signPrompt: "Распишитесь здесь",
      signUploading: "Загрузка…",
      agreeCheck: "Я согласен с вышеизложенным и подписываю",
      submitCta: "Согласиться и подписать",
      submitting: "Обработка…",
      alreadySigned: "Соглашение о правилах подписано.",
      alreadySignedAt: (v) => `Версия ${v}`,
      error: "Произошла ошибка при подписании. Повторите попытку позже.",
    },
    addons: {
      title: "Опции",
      banner: "Запросы подтверждаются после проверки оператором. Оплата при выезде (наличные/перевод).",
      optionLabel: "Выберите опцию",
      timeLabel: "Выберите длительность",
      typeLabel: "Тип",
      addonsLabel: "Выберите доп. услуги",
      addonsTrigger: (n) => `Выберите доп. услуги (${n})`,
      selectedCount: (n) => `Выбрано ${n}`,
      apply: "Применить",
      sheetTitle: "Выберите доп. услуги",
      sheetHint: "Можно выбрать несколько",
      estTotal: "Примерный итог",
      requestCta: "Запросить эти опции",
      requesting: "Отправка…",
      requested: "Ваш запрос принят.",
      error: "Произошла ошибка. Повторите попытку позже.",
      perUnit: (l) => `/ ${l}`,
      variantRequired: "Выберите опцию",
      goNext: "Завершить без опций",
    },
    result: {
      title: "Данные заселения\nприняты",
      subtitle: "По прибытии мы быстро вас обслужим.",
      agreementDone: "Соглашение о правилах подписано",
      agreementDoneAt: (v) => `Версия ${v}`,
      requestedTitle: "Запрошенные опции",
      statusPending: "Ожидает",
      statusConfirmed: "Подтверждено",
      statusOther: "Обработано",
      estTotal: "Примерный итог",
      settleNote: "Мини-бар и выбранные опции оплачиваются при выезде (наличные/перевод). Оператор подтвердит итоговую сумму.",
      empty: "Опции ещё не запрошены.",
      finishCta: "Готово",
    },
    footerNote: "По вопросам обращайтесь в ваше турагентство.",
  },

  // ─────────────────────────────── 中文(简体) ───────────────────────────────
  zh: {
    brandTagline: "自助入住",
    next: "下一步",
    back: "返回",
    confirm: "确认",
    done: "完成",
    steps: { amenities: "设施确认", agreement: "使用同意", addons: "选项", done: "完成" },
    stepCount: (c, t) => `${c}/${t}`,
    home: {
      kicker: "自助入住",
      title: "开始办理入住",
      subtitle: "抵达前先确认设施、签署同意书并选择选项，可加快现场流程。",
      badgeConfirmed: "预订确认",
      nights: (n) => `${n}晚`,
      guests: (n) => `成人${n}人`,
      breakfastOn: "含早餐",
      breakfastOff: "不含早餐",
      privacyNote: "此链接仅对应您的一笔预订。大约2分钟即可完成。",
      startCta: "开始办理入住",
    },
    amenities: {
      title: "设施确认",
      intro: "以下是别墅内配备的设施用品。请简单确认后继续。",
      minibarTitle: "迷你吧",
      minibarPaid: "消费需付费",
      stocked: (n) => `配备${n}个`,
      minibarNote: "您消费的迷你吧将在退房时结算（现金/转账）。",
      confirmCheck: "我已确认设施用品",
      categories: { KITCHEN: "厨房", BATHROOM: "浴室", APPLIANCE: "电器", MINIBAR: "迷你吧" },
    },
    agreement: {
      title: "使用同意书",
      docTitleFallback: "别墅使用同意书",
      versionChip: (v) => `版本 ${v}`,
      signLabel: "签名",
      clear: "清除",
      signPrompt: "请在此处签名",
      signUploading: "上传中…",
      agreeCheck: "我同意以上内容并签名",
      submitCta: "同意并完成签名",
      submitting: "处理中…",
      alreadySigned: "使用同意书已完成签名。",
      alreadySignedAt: (v) => `版本 ${v}`,
      error: "签名处理出现问题，请稍后再试。",
    },
    addons: {
      title: "选项",
      banner: "请求经运营者确认后即确定。付款于退房时以现金/转账结算。",
      optionLabel: "选择选项",
      timeLabel: "选择时长",
      typeLabel: "种类",
      addonsLabel: "选择细项",
      addonsTrigger: (n) => `选择细项 (${n})`,
      selectedCount: (n) => `已选${n}个`,
      apply: "应用",
      sheetTitle: "选择细项",
      sheetHint: "可选择多项",
      estTotal: "合计（预估）",
      requestCta: "请求这些选项",
      requesting: "提交中…",
      requested: "您的请求已受理。",
      error: "处理时出现问题，请稍后再试。",
      perUnit: (l) => `/ ${l}`,
      variantRequired: "请选择选项",
      goNext: "不选选项直接完成",
    },
    result: {
      title: "入住信息\n已受理",
      subtitle: "您抵达后我们将迅速为您安排。",
      agreementDone: "使用同意书签名完成",
      agreementDoneAt: (v) => `版本 ${v}`,
      requestedTitle: "已请求的选项",
      statusPending: "待确认",
      statusConfirmed: "已确定",
      statusOther: "已处理",
      estTotal: "预估合计",
      settleNote: "迷你吧及所选选项将在退房时结算（现金/转账）。运营者确认后将告知最终金额。",
      empty: "尚未请求任何选项。",
      finishCta: "确认",
    },
    footerNote: "如有疑问，请联系您预订的旅行社。",
  },

  // ─────────────────────────────── Tiếng Việt ───────────────────────────────
  vi: {
    brandTagline: "Tự nhận phòng",
    next: "Tiếp",
    back: "Quay lại",
    confirm: "Xác nhận",
    done: "Hoàn tất",
    steps: { amenities: "Tiện nghi", agreement: "Đồng ý", addons: "Tùy chọn", done: "Hoàn tất" },
    stepCount: (c, t) => `${c}/${t}`,
    home: {
      kicker: "Tự nhận phòng",
      title: "Bắt đầu nhận phòng",
      subtitle: "Kiểm tra tiện nghi, ký bản đồng ý và chọn tùy chọn trước khi đến giúp thủ tục tại chỗ nhanh hơn.",
      badgeConfirmed: "Đã xác nhận",
      nights: (n) => `${n} đêm`,
      guests: (n) => `${n} người lớn`,
      breakfastOn: "Gồm bữa sáng",
      breakfastOff: "Không bữa sáng",
      privacyNote: "Liên kết này chỉ gắn với một đặt phòng của bạn. Mất khoảng 2 phút.",
      startCta: "Tiến hành nhận phòng",
    },
    amenities: {
      title: "Tiện nghi",
      intro: "Đây là các tiện nghi có sẵn trong biệt thự. Vui lòng kiểm tra nhanh rồi tiếp tục.",
      minibarTitle: "Minibar",
      minibarPaid: "Có phí nếu sử dụng",
      stocked: (n) => `Có sẵn ${n}`,
      minibarNote: "Các món minibar bạn dùng sẽ được tính khi trả phòng (tiền mặt/chuyển khoản).",
      confirmCheck: "Tôi đã kiểm tra tiện nghi",
      categories: { KITCHEN: "Bếp", BATHROOM: "Phòng tắm", APPLIANCE: "Thiết bị điện", MINIBAR: "Minibar" },
    },
    agreement: {
      title: "Bản đồng ý",
      docTitleFallback: "Bản đồng ý sử dụng biệt thự",
      versionChip: (v) => `Phiên bản ${v}`,
      signLabel: "Chữ ký",
      clear: "Xóa",
      signPrompt: "Ký tại đây",
      signUploading: "Đang tải lên…",
      agreeCheck: "Tôi đồng ý với nội dung trên và ký tên",
      submitCta: "Đồng ý & ký",
      submitting: "Đang xử lý…",
      alreadySigned: "Đã ký bản đồng ý sử dụng.",
      alreadySignedAt: (v) => `Phiên bản ${v}`,
      error: "Đã xảy ra lỗi khi ký. Vui lòng thử lại sau.",
    },
    addons: {
      title: "Tùy chọn",
      banner: "Yêu cầu được xác nhận sau khi người vận hành kiểm tra. Thanh toán khi trả phòng (tiền mặt/chuyển khoản).",
      optionLabel: "Chọn tùy chọn",
      timeLabel: "Chọn thời lượng",
      typeLabel: "Loại",
      addonsLabel: "Chọn dịch vụ thêm",
      addonsTrigger: (n) => `Chọn dịch vụ thêm (${n})`,
      selectedCount: (n) => `Đã chọn ${n}`,
      apply: "Áp dụng",
      sheetTitle: "Chọn dịch vụ thêm",
      sheetHint: "Bạn có thể chọn nhiều",
      estTotal: "Tổng (dự kiến)",
      requestCta: "Yêu cầu các tùy chọn này",
      requesting: "Đang gửi…",
      requested: "Đã nhận yêu cầu của bạn.",
      error: "Đã xảy ra lỗi. Vui lòng thử lại sau.",
      perUnit: (l) => `/ ${l}`,
      variantRequired: "Vui lòng chọn tùy chọn",
      goNext: "Hoàn tất không chọn tùy chọn",
    },
    result: {
      title: "Thông tin nhận phòng\nđã được ghi nhận",
      subtitle: "Khi bạn đến, chúng tôi sẽ hỗ trợ nhanh chóng.",
      agreementDone: "Đã ký bản đồng ý sử dụng",
      agreementDoneAt: (v) => `Phiên bản ${v}`,
      requestedTitle: "Tùy chọn đã yêu cầu",
      statusPending: "Chờ xác nhận",
      statusConfirmed: "Đã xác nhận",
      statusOther: "Đã xử lý",
      estTotal: "Tổng dự kiến",
      settleNote: "Minibar và các tùy chọn đã chọn sẽ được tính khi trả phòng (tiền mặt/chuyển khoản). Người vận hành sẽ xác nhận số tiền cuối cùng.",
      empty: "Chưa yêu cầu tùy chọn nào.",
      finishCta: "Xác nhận",
    },
    footerNote: "Mọi thắc mắc vui lòng liên hệ công ty du lịch của bạn.",
  },
};
