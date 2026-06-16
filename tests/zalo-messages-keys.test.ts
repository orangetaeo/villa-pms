import { describe, expect, it } from "vitest";
import ko from "@/messages/ko.json";
import vi from "@/messages/vi.json";

// T6.6/T3.7 i18n 키 존재·양쪽 동기 검증 (LOC: 키 쌍 누락 방지)
// ADR-0009: 첨부·공유·번역모드·별명 키 추가(중첩 객체 — 점 경로로 검증).
const ADMIN_MESSAGES_KEYS = [
  "title",
  "searchPlaceholder",
  "empty",
  "windowExpiredBadge",
  "selectConversation",
  "noMessages",
  "connected",
  "translationLabel",
  "hideTranslation",
  "showTranslation",
  "systemBadge",
  "statusSent",
  "statusFailed",
  "statusAuto",
  "send",
  "inputPlaceholder",
  "previewLabel",
  "previewLabelEn",
  "previewEmpty",
  "translating",
  "retranslate",
  "translateUnavailable",
  "sendFailed",
  "windowClosedWarning",
  "windowClosedPlaceholder",
  "zaloOriginalInline",
  // ADR-0009 중첩 키 (점 경로)
  "filter.all",
  "counterparty.supplier",
  "counterparty.customer",
  "counterparty.unknown",
  "classify.bannerTitle",
  "classify.bannerHint",
  "classify.supplier",
  "classify.customer",
  "classify.unknown",
  "classify.change",
  "classify.heading",
  "preview.photo",
  "preview.villaShare",
  "preview.proposalShare",
  "preview.settlementShare",
  "card.villaShare",
  "card.proposalShare",
  "card.settlementShare",
  "translateMode.heading",
  "translateMode.off",
  "translateMode.vi",
  "translateMode.en",
  "nickname.title",
  "nickname.edit",
  "nickname.save",
  "nickname.hint",
  "nickname.zaloOriginal",
  "attach.button",
  "attach.heading",
  "attach.photo",
  "attach.camera",
  "attach.villa",
  "attach.proposal",
  "attach.settlement",
  "attach.lockedHint",
  "settlementStatus.DRAFT",
  "settlementStatus.CONFIRMED",
  "settlementStatus.PAID",
  "shareModal.cancel",
  "shareModal.share",
  "shareModal.sendLink",
  "shareModal.sendSummary",
  "shareModal.villaTitle",
  "shareModal.villaSubtitleSupplier",
  "shareModal.villaSubtitleCustomer",
  "shareModal.proposalTitle",
  "shareModal.proposalFor",
  "shareModal.proposalGuard",
  "shareModal.settlementTitle",
  "shareModal.settlementSubtitle",
  "shareModal.settlementGuard",
] as const;

/** 점 경로로 중첩 문자열 값 조회 (없으면 undefined) */
function lookup(obj: unknown, path: string): string | undefined {
  const v = path
    .split(".")
    .reduce<unknown>((acc, k) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined), obj);
  return typeof v === "string" ? v : undefined;
}

const ZALO_CONNECT_KEYS = [
  "topTitle",
  "step",
  "stepLabel",
  "heroTitle",
  "heroDesc",
  "addFriend",
  "oaUnavailable",
  "qrTitle",
  "qrPlaceholder",
  "skip",
  "done",
  "connectedTitle",
  "connectedDesc",
] as const;

describe("i18n 키 — adminMessages (b14)", () => {
  it("ko/vi 모두 adminMessages 네임스페이스 보유", () => {
    expect(ko.adminMessages).toBeDefined();
    expect(vi.adminMessages).toBeDefined();
  });
  it.each(ADMIN_MESSAGES_KEYS)("키 '%s' 존재 (ko·vi 비어있지 않음)", (key) => {
    expect(lookup(ko.adminMessages, key)?.length).toBeGreaterThan(0);
    expect(lookup(vi.adminMessages, key)?.length).toBeGreaterThan(0);
  });
});

describe("i18n 키 — zaloConnect (a0)", () => {
  it("ko/vi 모두 zaloConnect 네임스페이스 보유", () => {
    expect(ko.zaloConnect).toBeDefined();
    expect(vi.zaloConnect).toBeDefined();
  });
  it.each(ZALO_CONNECT_KEYS)("키 '%s' 존재 (ko·vi 비어있지 않음)", (key) => {
    expect((ko.zaloConnect as Record<string, string>)[key]?.length).toBeGreaterThan(0);
    expect((vi.zaloConnect as Record<string, string>)[key]?.length).toBeGreaterThan(0);
  });
});

describe("i18n 키 — nav.messages", () => {
  it("ko/vi 모두 nav.messages 보유", () => {
    expect((ko.nav as Record<string, string>).messages?.length).toBeGreaterThan(0);
    expect((vi.nav as Record<string, string>).messages?.length).toBeGreaterThan(0);
  });
});
