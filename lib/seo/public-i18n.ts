// lib/seo/public-i18n.ts — 공개 홈(villa-go.net) 전용 5개 언어 사전 (테오 2026-07-24)
//
// ★ 왜 별도 시스템인가: 앱 전역 i18n(next-intl)은 운영자 ko / 공급자 vi **2개만** 지원한다.
//   공개 홈만 5개 언어(ko·en·vi·ru·zh)로 늘리기 위해 전역 로케일을 확장하면 admin/supplier
//   메시지(ko/vi만 존재)가 깨진다. 그래서 공개 홈은 이 파일의 자체 사전 + `pub-locale` 쿠키로
//   독립 동작한다 — 전역 `locale`/`pref-locale` 쿠키·next-intl에 전혀 손대지 않는다.
// ★ 블로그 본문·빌라 콘텐츠는 한국어 SEO 자산이라 번역 대상이 아니다(캐논은 ko). 이 사전은 홈의
//   UI 문구(정적 텍스트)만 5개 언어로 전환한다. 비-ko 방문자는 UI만 자국어, 글은 한국어를 본다.
//
// ★ 이 파일은 **순수 모듈**로 유지한다(next/headers 등 서버 전용 import 금지) — 클라이언트
//   컴포넌트(public-lang-switcher)가 PUBLIC_LOCALES를 import하기 때문. 쿠키 읽기는 public-locale.ts(서버).

/** 공개 홈 지원 로케일. 러시아어 포함 = 푸꾸옥 러시아 관광객 비중(테오 결정 2026-07-24). */
export const PUBLIC_LOCALES = [
  { code: "ko", label: "한국어", short: "KO" },
  { code: "en", label: "English", short: "EN" },
  { code: "vi", label: "Tiếng Việt", short: "VI" },
  { code: "ru", label: "Русский", short: "RU" },
  { code: "zh", label: "中文", short: "ZH" },
] as const;

export type PublicLocale = (typeof PUBLIC_LOCALES)[number]["code"];

/** 검색·광고 랜딩 캐논 언어. 알 수 없는 쿠키 값은 여기로 폴백. */
export const DEFAULT_PUBLIC_LOCALE: PublicLocale = "ko";

const CODES = new Set(PUBLIC_LOCALES.map((l) => l.code));

export function normalizePublicLocale(v: string | null | undefined): PublicLocale {
  return typeof v === "string" && CODES.has(v as PublicLocale) ? (v as PublicLocale) : DEFAULT_PUBLIC_LOCALE;
}

// ── 러시아어 수사 굴절(1/2~4/5+) ─────────────────────────────────────────────
function ruPlural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}

// ── 홈 문구 사전 ─────────────────────────────────────────────────────────────
export interface HomeStrings {
  navBlog: string;
  navLogin: string;
  navConsult: string;
  heroEyebrow: string;
  heroTitle: string;
  heroSubtitle: string;
  heroCta: string;
  /** 블로그 슬라이드 "자세히 보기" 링크 문구 */
  readMore: string;
  areasTitle: string;
  villaCount: (n: number) => string;
  featuresTitle: string;
  featuredTitle: string;
  viewAll: string;
  bedrooms: (n: number) => string;
  maxGuests: (n: number) => string;
  pool: string;
  breakfast: string;
  inquiry: string;
  whyTitle: string;
  why1t: string;
  why1d: string;
  why2t: string;
  why2d: string;
  why3t: string;
  why3d: string;
  whyCta: string;
  blogTitle: string;
  blogDesc: string;
  blogCta: string;
  partnerTitle: string;
  partnerLink1: string;
  partnerLink2: string;
  partnerLink3: string;
  footerTagline: string;
  footerContact: string;
  privacy: string;
  stickyCta: string;
  /** 조건 칩 라벨 — HOME_FEATURES의 key로 조회 */
  features: Record<string, string>;
}

const ko: HomeStrings = {
  navBlog: "블로그",
  navLogin: "로그인",
  navConsult: "상담하기",
  heroEyebrow: "푸꾸옥 현지 빌라",
  heroTitle: "푸꾸옥 풀빌라, 조건으로 찾으세요",
  heroSubtitle: "인원·시설로 골라보는 현지 빌라. 현지에서 직접 운영하고 검수합니다.",
  heroCta: "1분 견적 상담",
  readMore: "자세히 보기 →",
  areasTitle: "지역으로 찾기",
  villaCount: (n) => `빌라 ${n}곳`,
  featuresTitle: "조건으로 찾기",
  featuredTitle: "추천 빌라",
  viewAll: "전체 보기 →",
  bedrooms: (n) => `침실 ${n}`,
  maxGuests: (n) => `최대 ${n}인`,
  pool: "수영장",
  breakfast: "조식",
  inquiry: "견적 문의 →",
  whyTitle: "Villa GO는 이렇게 다릅니다",
  why1t: "현지 운영",
  why1d: "푸꾸옥 현지에서 빌라를 직접 관리합니다. 체크인·청소·현장 대응을 직접 처리합니다.",
  why2t: "검수한 빌라만",
  why2d: "청소 검수를 통과한 빌라만 안내합니다. 사진과 실제가 다른 일이 없도록 공간별로 확인합니다.",
  why3t: "조건에 맞춰 제안",
  why3d: "인원과 일정, 원하는 시설을 알려주시면 조건에 맞는 빌라를 골라 견적과 함께 보내드립니다.",
  whyCta: "조건 알려주고 견적 받기",
  blogTitle: "빌라 이야기 · 여행 가이드",
  blogDesc: "푸꾸옥 빌라 고르는 법, 지역별 특징, 현지 여행 팁을 정리했습니다.",
  blogCta: "블로그 글 보기 →",
  partnerTitle: "함께 일하실 분",
  partnerLink1: "여행사·랜드사 파트너 안내 →",
  partnerLink2: "빌라 관리인(공급자) 안내 →",
  partnerLink3: "부가서비스 업체 안내 →",
  footerTagline: "푸꾸옥 빌라 예약·현지 운영",
  footerContact: "문의",
  privacy: "개인정보처리방침",
  stickyCta: "빌라 문의하기",
  features: {
    privatePool: "프라이빗 풀",
    viewSea: "바다뷰",
    beachFront: "해변 바로앞",
    bbq: "BBQ 가능",
    golfNearby: "골프장 근처",
    kidsPool: "키즈풀",
  },
};

const en: HomeStrings = {
  navBlog: "Blog",
  navLogin: "Log in",
  navConsult: "Get a quote",
  heroEyebrow: "Phu Quoc local villas",
  heroTitle: "Find your Phu Quoc pool villa by the details that matter",
  heroSubtitle: "Browse local villas by group size and amenities. Operated and inspected on the ground.",
  heroCta: "Get a quote in 1 min",
  readMore: "Read more →",
  areasTitle: "Find by area",
  villaCount: (n) => `${n} ${n === 1 ? "villa" : "villas"}`,
  featuresTitle: "Find by feature",
  featuredTitle: "Featured villas",
  viewAll: "View all →",
  bedrooms: (n) => `${n} ${n === 1 ? "bedroom" : "bedrooms"}`,
  maxGuests: (n) => `Up to ${n} guests`,
  pool: "Pool",
  breakfast: "Breakfast",
  inquiry: "Ask for a quote →",
  whyTitle: "Why Villa GO",
  why1t: "Local operation",
  why1d: "We manage the villas ourselves in Phu Quoc — check‑in, cleaning and on‑site support handled directly.",
  why2t: "Only inspected villas",
  why2d: "We only list villas that pass a cleaning inspection, checked space by space so photos match reality.",
  why3t: "Proposals to fit you",
  why3d: "Tell us your group, dates and must‑have amenities — we pick matching villas and send them with a quote.",
  whyCta: "Tell us and get a quote",
  blogTitle: "Villa stories · Travel guide",
  blogDesc: "How to pick a Phu Quoc villa, area highlights and local travel tips.",
  blogCta: "Read the blog →",
  partnerTitle: "Work with us",
  partnerLink1: "For travel agencies & land operators →",
  partnerLink2: "For villa managers (suppliers) →",
  partnerLink3: "For add‑on service vendors →",
  footerTagline: "Phu Quoc villa booking · local operation",
  footerContact: "Contact",
  privacy: "Privacy Policy",
  stickyCta: "Inquire about villas",
  features: {
    privatePool: "Private pool",
    viewSea: "Sea view",
    beachFront: "Beachfront",
    bbq: "BBQ",
    golfNearby: "Near golf",
    kidsPool: "Kids pool",
  },
};

const vi: HomeStrings = {
  navBlog: "Blog",
  navLogin: "Đăng nhập",
  navConsult: "Tư vấn",
  heroEyebrow: "Biệt thự tại Phú Quốc",
  heroTitle: "Tìm biệt thự hồ bơi Phú Quốc theo đúng nhu cầu",
  heroSubtitle: "Chọn biệt thự theo số khách và tiện nghi. Chúng tôi vận hành và kiểm tra trực tiếp tại địa phương.",
  heroCta: "Nhận báo giá trong 1 phút",
  readMore: "Xem chi tiết →",
  areasTitle: "Tìm theo khu vực",
  villaCount: (n) => `${n} biệt thự`,
  featuresTitle: "Tìm theo tiện ích",
  featuredTitle: "Biệt thự nổi bật",
  viewAll: "Xem tất cả →",
  bedrooms: (n) => `${n} phòng ngủ`,
  maxGuests: (n) => `Tối đa ${n} khách`,
  pool: "Hồ bơi",
  breakfast: "Bữa sáng",
  inquiry: "Hỏi báo giá →",
  whyTitle: "Villa GO khác biệt thế nào",
  why1t: "Vận hành tại chỗ",
  why1d: "Chúng tôi tự quản lý biệt thự tại Phú Quốc — nhận phòng, dọn dẹp và hỗ trợ tại chỗ đều do đội ngũ trực tiếp lo.",
  why2t: "Chỉ biệt thự đã kiểm tra",
  why2d: "Chỉ giới thiệu biệt thự đã qua kiểm tra vệ sinh, kiểm từng khu vực để hình ảnh đúng với thực tế.",
  why3t: "Đề xuất theo nhu cầu",
  why3d: "Cho biết số khách, ngày và tiện nghi mong muốn — chúng tôi chọn biệt thự phù hợp kèm báo giá.",
  whyCta: "Cho biết nhu cầu & nhận báo giá",
  blogTitle: "Chuyện biệt thự · Cẩm nang du lịch",
  blogDesc: "Cách chọn biệt thự Phú Quốc, đặc điểm từng khu vực và mẹo du lịch tại chỗ.",
  blogCta: "Đọc blog →",
  partnerTitle: "Hợp tác cùng chúng tôi",
  partnerLink1: "Dành cho đại lý du lịch & land tour →",
  partnerLink2: "Dành cho quản lý biệt thự (nhà cung cấp) →",
  partnerLink3: "Dành cho nhà cung cấp dịch vụ bổ sung →",
  footerTagline: "Đặt biệt thự Phú Quốc · vận hành tại chỗ",
  footerContact: "Liên hệ",
  privacy: "Chính sách bảo mật",
  stickyCta: "Hỏi về biệt thự",
  features: {
    privatePool: "Hồ bơi riêng",
    viewSea: "View biển",
    beachFront: "Sát biển",
    bbq: "BBQ",
    golfNearby: "Gần sân golf",
    kidsPool: "Hồ trẻ em",
  },
};

const ru: HomeStrings = {
  navBlog: "Блог",
  navLogin: "Вход",
  navConsult: "Консультация",
  heroEyebrow: "Виллы на Фукуоке",
  heroTitle: "Найдите виллу с бассейном на Фукуоке по нужным параметрам",
  heroSubtitle: "Подбирайте виллы по числу гостей и удобствам. Управляем и проверяем всё на месте.",
  heroCta: "Расчёт за 1 минуту",
  readMore: "Подробнее →",
  areasTitle: "Поиск по району",
  villaCount: (n) => `${n} ${ruPlural(n, "вилла", "виллы", "вилл")}`,
  featuresTitle: "Поиск по удобствам",
  featuredTitle: "Рекомендуемые виллы",
  viewAll: "Все виллы →",
  bedrooms: (n) => `${n} ${ruPlural(n, "спальня", "спальни", "спален")}`,
  maxGuests: (n) => `До ${n} ${ruPlural(n, "гостя", "гостей", "гостей")}`,
  pool: "Бассейн",
  breakfast: "Завтрак",
  inquiry: "Запросить цену →",
  whyTitle: "Чем отличается Villa GO",
  why1t: "Местное управление",
  why1d: "Мы сами управляем виллами на Фукуоке — заселение, уборка и поддержка на месте напрямую.",
  why2t: "Только проверенные виллы",
  why2d: "Показываем только виллы, прошедшие проверку уборки — каждую зону сверяем, чтобы фото совпадали с реальностью.",
  why3t: "Подбор под вас",
  why3d: "Расскажите о составе группы, датах и нужных удобствах — подберём подходящие виллы и пришлём с ценой.",
  whyCta: "Оставить запрос и получить цену",
  blogTitle: "О виллах · Гид по поездке",
  blogDesc: "Как выбрать виллу на Фукуоке, особенности районов и местные советы для поездки.",
  blogCta: "Читать блог →",
  partnerTitle: "Сотрудничество",
  partnerLink1: "Для турагентств и land‑операторов →",
  partnerLink2: "Для управляющих виллами (поставщиков) →",
  partnerLink3: "Для поставщиков доп‑услуг →",
  footerTagline: "Бронирование вилл на Фукуоке · местное управление",
  footerContact: "Контакт",
  privacy: "Политика конфиденциальности",
  stickyCta: "Оставить заявку",
  features: {
    privatePool: "Свой бассейн",
    viewSea: "Вид на море",
    beachFront: "У пляжа",
    bbq: "Барбекю",
    golfNearby: "Рядом гольф",
    kidsPool: "Детский бассейн",
  },
};

const zh: HomeStrings = {
  navBlog: "博客",
  navLogin: "登录",
  navConsult: "咨询",
  heroEyebrow: "富国岛本地别墅",
  heroTitle: "按条件找到您的富国岛泳池别墅",
  heroSubtitle: "按人数和设施挑选本地别墅。我们在当地直接运营并验收。",
  heroCta: "1分钟获取报价",
  readMore: "查看详情 →",
  areasTitle: "按区域查找",
  villaCount: (n) => `${n} 套别墅`,
  featuresTitle: "按条件查找",
  featuredTitle: "推荐别墅",
  viewAll: "查看全部 →",
  bedrooms: (n) => `${n} 间卧室`,
  maxGuests: (n) => `最多 ${n} 人`,
  pool: "泳池",
  breakfast: "早餐",
  inquiry: "咨询报价 →",
  whyTitle: "Villa GO 的不同之处",
  why1t: "本地运营",
  why1d: "我们在富国岛亲自管理别墅——入住、清洁和现场支持均由团队直接负责。",
  why2t: "只推荐验收过的别墅",
  why2d: "只推荐通过清洁验收的别墅，逐个空间核对，确保照片与实物一致。",
  why3t: "按需求推荐",
  why3d: "告诉我们人数、日期和想要的设施，我们挑选合适的别墅并附上报价。",
  whyCta: "告诉我们并获取报价",
  blogTitle: "别墅故事 · 旅行指南",
  blogDesc: "如何挑选富国岛别墅、各区域特点以及本地旅行贴士。",
  blogCta: "阅读博客 →",
  partnerTitle: "与我们合作",
  partnerLink1: "旅行社与地接合作 →",
  partnerLink2: "别墅管理者（供应商）合作 →",
  partnerLink3: "增值服务供应商合作 →",
  footerTagline: "富国岛别墅预订 · 本地运营",
  footerContact: "联系",
  privacy: "隐私政策",
  stickyCta: "咨询别墅",
  features: {
    privatePool: "私人泳池",
    viewSea: "海景",
    beachFront: "海滩旁",
    bbq: "烧烤",
    golfNearby: "近高尔夫",
    kidsPool: "儿童泳池",
  },
};

const DICT: Record<PublicLocale, HomeStrings> = { ko, en, vi, ru, zh };

/** 로케일별 홈 문구 — 알 수 없는 값은 ko. */
export function homeStrings(locale: PublicLocale): HomeStrings {
  return DICT[locale] ?? ko;
}
