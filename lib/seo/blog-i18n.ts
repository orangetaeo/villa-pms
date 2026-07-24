// lib/seo/blog-i18n.ts — 공개 블로그 화면 chrome 문구 5개 언어 (ADR-0049, 순수 모듈)
//
// ★ 글 본문(title·summary·blocks)은 SeoArticleTranslation에서 번역되어 온다. 이 사전은 그 주변
//   **화면 틀**(헤더 CTA·브레드크럼·위치 섹션·추천·CTA·푸터)만 언어별로 바꾼다.
// ★ next/headers·prisma import 금지(순수) — 서버 컴포넌트에서 import한다.
import type { PublicLocale } from "@/lib/seo/public-i18n";
import type { SeoArticleCategory } from "@/lib/seo/categories";

export interface BlogStrings {
  consult: string; // 헤더 CTA "상담하기"
  hubTitle: string; // 허브 h1 / 브레드크럼
  hubSubtitle: string;
  hubDesc: string; // 메타 description
  hubEmpty: string; // 발행 글 0건 안내
  hubEmptyCta: string; // 그 안내의 링크 문구
  categoryLabels: Record<SeoArticleCategory, string>;
  categoryIntro: (label: string) => string; // 카테고리 소개 문단
  categoryEmpty: string;
  allGuides: string; // "전체 가이드 보기"
  backToGuide: string; // "← 가이드 목록"
  location: string; // "위치"
  villaApproxNote: string;
  placeOpenInMaps: string;
  phuQuoc: string; // 지명 접두("푸꾸옥")
  recommendTitle: string;
  recommendAreaTitle: string;
  ctaTitle: string;
  ctaBody: string;
  ctaButton: string;
  footerContact: string;
  privacy: string;
  prev: string;
  next: string;
}

const ko: BlogStrings = {
  consult: "상담하기",
  hubTitle: "푸꾸옥 여행 가이드",
  hubSubtitle: "빌라 여행에 필요한 정보를 현지에서 직접 정리합니다.",
  hubDesc: "푸꾸옥 빌라 여행에 필요한 정보 — 이동, 시즌, 아이 동반, 골프, 빌라 고르는 법.",
  hubEmpty: "첫 가이드를 준비하고 있습니다. 지금 필요한 정보가 있으시면",
  hubEmptyCta: "상담으로 바로 물어보세요",
  categoryLabels: { villa: "빌라", service: "서비스", place: "맛집·장소", guide: "여행 가이드", video: "영상" },
  categoryIntro: (label) => `푸꾸옥 ${label} 관련 글을 모았습니다.`,
  categoryEmpty: "아직 이 분류의 글이 없습니다.",
  allGuides: "전체 가이드 보기",
  backToGuide: "← 가이드 목록",
  location: "위치",
  villaApproxNote: "정확한 주소는 예약 확정 후 안내드립니다. 아래는 대략적인 위치예요.",
  placeOpenInMaps: "구글 지도에서 열기 →",
  phuQuoc: "푸꾸옥",
  recommendTitle: "추천 빌라",
  recommendAreaTitle: "이 지역 추천 빌라",
  ctaTitle: "조건에 맞는 빌라가 궁금하세요?",
  ctaBody: "인원과 일정, 원하는 시설을 알려주시면 현지에서 검수한 빌라를 골라 견적과 함께 보내드립니다.",
  ctaButton: "1분 견적 상담",
  footerContact: "문의",
  privacy: "개인정보처리방침",
  prev: "← 이전",
  next: "다음 →",
};

const en: BlogStrings = {
  consult: "Get a quote",
  hubTitle: "Phu Quoc Travel Guide",
  hubSubtitle: "Local, first‑hand tips for a villa trip to Phu Quoc.",
  hubDesc: "Everything for a Phu Quoc villa trip — getting around, seasons, kids, golf, and how to pick a villa.",
  hubEmpty: "Our first guides are on the way. If there's something you need right now,",
  hubEmptyCta: "just ask us in chat",
  categoryLabels: { villa: "Villas", service: "Services", place: "Food & Places", guide: "Travel Guide", video: "Video" },
  categoryIntro: (label) => `A collection of Phu Quoc ${label.toLowerCase()} articles.`,
  categoryEmpty: "No articles in this category yet.",
  allGuides: "See all guides",
  backToGuide: "← All guides",
  location: "Location",
  villaApproxNote: "The exact address is shared after booking is confirmed. Below is the approximate area.",
  placeOpenInMaps: "Open in Google Maps →",
  phuQuoc: "Phu Quoc",
  recommendTitle: "Recommended villas",
  recommendAreaTitle: "Recommended villas nearby",
  ctaTitle: "Wondering which villa fits you?",
  ctaBody: "Tell us your group, dates and must‑have amenities, and we'll pick locally inspected villas and send a quote.",
  ctaButton: "Get a quote in 1 min",
  footerContact: "Contact",
  privacy: "Privacy Policy",
  prev: "← Previous",
  next: "Next →",
};

const vi: BlogStrings = {
  consult: "Tư vấn",
  hubTitle: "Cẩm nang du lịch Phú Quốc",
  hubSubtitle: "Kinh nghiệm tại chỗ cho chuyến đi biệt thự ở Phú Quốc.",
  hubDesc: "Mọi thứ cho chuyến đi biệt thự Phú Quốc — di chuyển, mùa, trẻ em, golf và cách chọn biệt thự.",
  hubEmpty: "Những cẩm nang đầu tiên đang được chuẩn bị. Nếu bạn cần thông tin ngay,",
  hubEmptyCta: "hãy hỏi chúng tôi qua chat",
  categoryLabels: { villa: "Biệt thự", service: "Dịch vụ", place: "Quán ăn · Địa điểm", guide: "Cẩm nang", video: "Video" },
  categoryIntro: (label) => `Tổng hợp bài viết về ${label} tại Phú Quốc.`,
  categoryEmpty: "Chưa có bài viết trong mục này.",
  allGuides: "Xem tất cả cẩm nang",
  backToGuide: "← Danh sách cẩm nang",
  location: "Vị trí",
  villaApproxNote: "Địa chỉ chính xác sẽ được cung cấp sau khi xác nhận đặt phòng. Dưới đây là khu vực tương đối.",
  placeOpenInMaps: "Mở trong Google Maps →",
  phuQuoc: "Phú Quốc",
  recommendTitle: "Biệt thự gợi ý",
  recommendAreaTitle: "Biệt thự gợi ý lân cận",
  ctaTitle: "Bạn muốn biết biệt thự nào phù hợp?",
  ctaBody: "Cho biết số khách, ngày và tiện nghi mong muốn — chúng tôi chọn biệt thự đã kiểm tra tại chỗ kèm báo giá.",
  ctaButton: "Nhận báo giá trong 1 phút",
  footerContact: "Liên hệ",
  privacy: "Chính sách bảo mật",
  prev: "← Trước",
  next: "Sau →",
};

const ru: BlogStrings = {
  consult: "Консультация",
  hubTitle: "Путеводитель по Фукуоку",
  hubSubtitle: "Местные советы из первых рук для поездки на виллу на Фукуоке.",
  hubDesc: "Всё для поездки на виллу на Фукуоке — передвижение, сезоны, дети, гольф и как выбрать виллу.",
  hubEmpty: "Первые гиды уже готовятся. Если что‑то нужно прямо сейчас,",
  hubEmptyCta: "просто спросите нас в чате",
  categoryLabels: { villa: "Виллы", service: "Услуги", place: "Еда и места", guide: "Путеводитель", video: "Видео" },
  categoryIntro: (label) => `Подборка статей о Фукуоке: ${label.toLowerCase()}.`,
  categoryEmpty: "В этой категории пока нет статей.",
  allGuides: "Все гиды",
  backToGuide: "← Все гиды",
  location: "Расположение",
  villaApproxNote: "Точный адрес сообщается после подтверждения брони. Ниже — примерный район.",
  placeOpenInMaps: "Открыть в Google Картах →",
  phuQuoc: "Фукуок",
  recommendTitle: "Рекомендуемые виллы",
  recommendAreaTitle: "Рекомендуемые виллы рядом",
  ctaTitle: "Не знаете, какая вилла вам подойдёт?",
  ctaBody: "Расскажите о составе группы, датах и нужных удобствах — подберём проверенные виллы и пришлём цену.",
  ctaButton: "Расчёт за 1 минуту",
  footerContact: "Контакт",
  privacy: "Политика конфиденциальности",
  prev: "← Назад",
  next: "Далее →",
};

const zh: BlogStrings = {
  consult: "咨询",
  hubTitle: "富国岛旅行指南",
  hubSubtitle: "本地一手的富国岛别墅旅行贴士。",
  hubDesc: "富国岛别墅旅行的一切——交通、季节、亲子、高尔夫，以及如何挑选别墅。",
  hubEmpty: "首批指南正在准备中。如果您现在需要信息，",
  hubEmptyCta: "可直接在聊天中咨询我们",
  categoryLabels: { villa: "别墅", service: "服务", place: "美食·地点", guide: "旅行指南", video: "视频" },
  categoryIntro: (label) => `富国岛${label}相关文章合集。`,
  categoryEmpty: "该分类暂无文章。",
  allGuides: "查看全部指南",
  backToGuide: "← 指南列表",
  location: "位置",
  villaApproxNote: "确切地址将在预订确认后提供。下方为大致区域。",
  placeOpenInMaps: "在 Google 地图中打开 →",
  phuQuoc: "富国岛",
  recommendTitle: "推荐别墅",
  recommendAreaTitle: "附近推荐别墅",
  ctaTitle: "想知道哪套别墅适合您？",
  ctaBody: "告诉我们人数、日期和想要的设施，我们挑选本地验收过的别墅并附上报价。",
  ctaButton: "1分钟获取报价",
  footerContact: "联系",
  privacy: "隐私政策",
  prev: "← 上一页",
  next: "下一页 →",
};

const DICT: Record<PublicLocale, BlogStrings> = { ko, en, vi, ru, zh };

/** 로케일별 블로그 chrome 문구 — 알 수 없는 값은 ko. */
export function blogStrings(locale: PublicLocale): BlogStrings {
  return DICT[locale] ?? ko;
}
