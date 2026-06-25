// 빌라 이용 동의서 — 단일 콘텐츠 소스 (디지털 체크인 + 인쇄 시트 공용).
// 앱 UI i18n(messages json)에서 분리: ① 법적 문서라 길어지고 자주 바뀜 ② ko/vi 외
// 게스트용 en/zh/ru가 필요하나 앱 전체 번역은 불필요(동의서 텍스트만 다국어).
// 향후 조항 추가·수정 시 VERSION을 올린다 → 인쇄물에 버전이 찍혀 어느 판본에 서명했는지 추적.

export const AGREEMENT_VERSION = "2026-06";

export type AgreementLang = "ko" | "vi" | "en" | "zh" | "ru";

/** 게스트 언어 선택 옵션 — 라벨은 각 언어 고유 표기(언어 중립, i18n 불필요) */
export const AGREEMENT_LANGS: AgreementLang[] = ["ko", "vi", "en", "zh", "ru"];
export const AGREEMENT_LANG_LABELS: Record<AgreementLang, string> = {
  ko: "한국어",
  vi: "Tiếng Việt",
  en: "English",
  zh: "中文",
  ru: "Русский",
};

export function isAgreementLang(v: string | undefined | null): v is AgreementLang {
  return v === "ko" || v === "vi" || v === "en" || v === "zh" || v === "ru";
}

/** 조항 순서 — 수영장 빌라는 c2 뒤에 pool 조항 자동 삽입(번호 순서대로 재부여, SPEC F4) */
export function buildClauseOrder(hasPool: boolean): string[] {
  return hasPool
    ? ["c1", "c2", "pool", "c4", "c5", "c6", "c7"]
    : ["c1", "c2", "c4", "c5", "c6", "c7"];
}

type LangMap = Record<AgreementLang, string>;

export const AGREEMENT_DOC_TITLE: LangMap = {
  ko: "빌라 이용 수칙 및 안전 동의서",
  vi: "Nội quy sử dụng villa & cam kết an toàn",
  en: "Villa House Rules & Safety Agreement",
  zh: "别墅使用守则及安全同意书",
  ru: "Правила проживания на вилле и соглашение о безопасности",
};

export const AGREEMENT_CLAUSES: Record<string, LangMap> = {
  c1: {
    ko: "모든 투숙객은 체크인 시 여권 정보를 제공해야 합니다.",
    vi: "Mọi khách lưu trú phải cung cấp thông tin hộ chiếu khi nhận phòng.",
    en: "All guests must provide passport details at check-in.",
    zh: "所有住客须在入住时提供护照信息。",
    ru: "Все гости обязаны предоставить данные паспорта при заселении.",
  },
  c2: {
    ko: "빌라 내 전체 금연이며, 위반 시 청소 비용이 청구될 수 있습니다.",
    vi: "Cấm hút thuốc trong toàn bộ villa, vi phạm có thể bị tính phí vệ sinh.",
    en: "Smoking is prohibited throughout the villa; violations may incur a cleaning fee.",
    zh: "别墅内全面禁烟，违者可能被收取清洁费用。",
    ru: "Курение запрещено на всей территории виллы; за нарушение может взиматься плата за уборку.",
  },
  pool: {
    ko: "수영장 안전 이용: 영유아 및 아동은 반드시 성인 보호자의 동반 하에 이용해야 하며, 음주 후 입수를 엄격히 금지합니다. 수영장 내 다이빙은 금지됩니다.",
    vi: "An toàn hồ bơi: trẻ em phải có người lớn đi kèm, nghiêm cấm xuống hồ sau khi uống rượu bia. Cấm nhảy cầu trong hồ bơi.",
    en: "Pool safety: infants and children must be accompanied by an adult at all times; entering the pool after consuming alcohol is strictly prohibited; diving in the pool is not allowed.",
    zh: "泳池安全：婴幼儿及儿童必须由成人陪同使用，严禁饮酒后入池，禁止在泳池内跳水。",
    ru: "Безопасность у бассейна: младенцы и дети должны находиться под присмотром взрослых; вход в бассейн после употребления алкоголя строго запрещён; нырять в бассейне запрещено.",
  },
  c4: {
    ko: "가구 및 시설 파손 시 배상 책임이 있으며, 보증금에서 차감될 수 있습니다.",
    vi: "Làm hư hỏng nội thất, thiết bị phải bồi thường và có thể bị trừ vào tiền cọc.",
    en: "Guests are liable for damage to furniture and facilities, which may be deducted from the deposit.",
    zh: "如损坏家具及设施须负赔偿责任，可从押金中扣除。",
    ru: "Гости несут ответственность за повреждение мебели и оборудования; стоимость может быть удержана из депозита.",
  },
  c5: {
    ko: "밤 10시 이후 고성방가 및 소음 발생에 유의해 주시기 바랍니다.",
    vi: "Lưu ý không gây ồn ào sau 22 giờ.",
    en: "Please avoid loud noise and disturbances after 10:00 PM.",
    zh: "晚上10点后请勿喧哗及制造噪音。",
    ru: "Просьба не шуметь после 22:00.",
  },
  c6: {
    ko: "귀중품 분실에 대해서는 숙소 측에서 책임을 지지 않습니다.",
    vi: "Cơ sở không chịu trách nhiệm về việc mất tài sản quý giá.",
    en: "The property is not responsible for the loss of valuables.",
    zh: "住宿方对贵重物品遗失不承担责任。",
    ru: "Администрация не несёт ответственности за утрату ценных вещей.",
  },
  c7: {
    ko: "이용 수칙 미준수로 인한 사고의 책임은 투숙객 본인에게 있습니다.",
    vi: "Khách tự chịu trách nhiệm về sự cố do không tuân thủ nội quy.",
    en: "Guests are responsible for any accidents resulting from failure to follow the house rules.",
    zh: "因未遵守使用守则而发生的事故由住客本人负责。",
    ru: "Гости несут ответственность за происшествия, вызванные несоблюдением правил.",
  },
};
