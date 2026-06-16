import { describe, expect, it } from "vitest";
import ko from "@/messages/ko.json";
import vi from "@/messages/vi.json";

// T6.6/T3.7 i18n 키 존재·양쪽 동기 검증 (LOC: 키 쌍 누락 방지)
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
  "previewEmpty",
  "translating",
  "retranslate",
  "translateUnavailable",
  "sendFailed",
  "windowClosedWarning",
  "windowClosedPlaceholder",
] as const;

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
    expect((ko.adminMessages as Record<string, string>)[key]?.length).toBeGreaterThan(0);
    expect((vi.adminMessages as Record<string, string>)[key]?.length).toBeGreaterThan(0);
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
