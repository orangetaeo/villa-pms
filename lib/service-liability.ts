// lib/service-liability.ts — 부가서비스 책임 제한 고지 + 동의 단일 원천 (계약 service-order-liability-consent)
//   운영자(Villa GO)는 부가서비스를 "중개"만 하며, 이행·품질·위생·안전 책임은 각 제공업체에 있음을 신청 시점에 고지·동의.
//   게스트(/g)·파트너(/p) 화면 모두 이 모듈에서 문구를 가져다 쓴다(이중 관리 금지). 서버 스냅샷 version도 여기서 단일 관리.
//   ★순수 상수 모듈 — "use client"/서버 전용 의존성 없음. 서버·클라 양쪽에서 import 가능.
//   ⚠문구를 수정하면 반드시 SERVICE_LIABILITY_VERSION을 올린다(동의 증빙 무결성 — 스냅샷 version이 곧 당시 문구 식별자).

/** 동의 스냅샷에 박히는 문구 버전. 문구 변경 시 반드시 증가. */
export const SERVICE_LIABILITY_VERSION = "2026-07-16.v1";

export interface ServiceLiabilityText {
  title: string;
  body: string;
  consentLabel: string;
}

// 5언어 고지 텍스트. ko=계약 확정 초안. en/vi/ru/zh=LOC 감수 완료(2026-07-16, 미배포 초판).
//   ★body는 평문(markdown 볼드 금지) — 작은 글씨 고지 박스에 그대로 렌더.
const TEXT: Record<string, ServiceLiabilityText> = {
  ko: {
    title: "책임 제한 안내",
    body: "부가서비스(마사지·BBQ·티켓 등)는 Villa GO가 중개하며, 서비스의 이행·품질·위생·안전에 대한 책임은 각 서비스 제공업체에 있습니다. 이용 중 발생한 문제(음식 위생, 안전사고 등)는 제공업체에 책임이 있으며, Villa GO는 연락과 분쟁 해결을 지원합니다.",
    consentLabel: "위 내용을 확인했으며 동의합니다.",
  },
  en: {
    title: "Limitation of Liability",
    body: "Add-on services (massage, BBQ, tickets, etc.) are arranged by Villa GO acting as an intermediary. Responsibility for the delivery, quality, hygiene and safety of each service lies with the respective service provider. Any problem arising during use (food hygiene, safety incidents, etc.) is the responsibility of the provider; Villa GO assists with communication and dispute resolution.",
    consentLabel: "I have read and agree to the above.",
  },
  vi: {
    title: "Giới hạn trách nhiệm",
    body: "Các dịch vụ bổ sung (massage, BBQ, vé, v.v.) do Villa GO làm trung gian sắp xếp. Trách nhiệm về việc thực hiện, chất lượng, vệ sinh và an toàn của mỗi dịch vụ thuộc về nhà cung cấp dịch vụ tương ứng. Mọi vấn đề phát sinh khi sử dụng (vệ sinh thực phẩm, sự cố an toàn, v.v.) thuộc trách nhiệm của nhà cung cấp; Villa GO hỗ trợ việc liên hệ và giải quyết tranh chấp.",
    consentLabel: "Tôi đã đọc và đồng ý với nội dung trên.",
  },
  ru: {
    title: "Ограничение ответственности",
    body: "Дополнительные услуги (массаж, барбекю, билеты и т. д.) организуются Villa GO в качестве посредника. Ответственность за оказание, качество, гигиену и безопасность каждой услуги несёт соответствующий поставщик услуг. За любые проблемы, возникшие во время использования (гигиена продуктов питания, несчастные случаи и т. д.), отвечает поставщик; Villa GO оказывает содействие в налаживании контакта и разрешении споров.",
    consentLabel: "Я ознакомлен(а) и согласен(на) с изложенным выше.",
  },
  zh: {
    title: "责任限制说明",
    body: "附加服务（按摩、烧烤、门票等）由 Villa GO 作为中介安排，各项服务的履行、质量、卫生与安全责任由相应的服务提供商承担。使用过程中发生的任何问题（食品卫生、安全事故等）均由服务提供商负责，Villa GO 协助沟通联络并处理纠纷。",
    consentLabel: "我已阅读并同意上述内容。",
  },
};

/** 고지 텍스트 접근자 — 미지원 로케일은 en 폴백. 서버·클라 공용. */
export function getServiceLiabilityText(locale: string): ServiceLiabilityText {
  return TEXT[locale] ?? TEXT.en;
}
