// AppSetting 키 검증자 단위 테스트 (T1.7-bank-contact)
// 라우트는 auth/prisma 의존으로 직접 테스트 어려움 → 순수 검증 규칙만 검증.
// 권한·배치 트랜잭션·clear 동작은 QA HTTP 실사용 검증 소관.
import { describe, it, expect } from "vitest";
import {
  VALIDATORS,
  SETTING_KEYS,
  CLEARABLE_SET,
  CLEARABLE_KEYS,
  isSettingKey,
  BANK_NAME_KEY,
  BANK_ACCOUNT_NUMBER_KEY,
  BANK_VN_NAME_KEY,
  BANK_VN_ACCOUNT_NUMBER_KEY,
  BANK_VN_ACCOUNT_HOLDER_KEY,
  CONTACT_KAKAO_URL_KEY,
  CONTACT_ZALO_URL_KEY,
  CONTACT_PHONE_KEY,
  ZALO_CONNECT_QR_URL_KEY,
  ZALO_CONNECT_OA_URL_KEY,
} from "@/app/api/settings/validators";

describe("isSettingKey 화이트리스트", () => {
  it("등록 키는 통과", () => {
    expect(isSettingKey(BANK_NAME_KEY)).toBe(true);
    expect(isSettingKey("FX_VND_PER_KRW")).toBe(true);
  });
  it("미등록 키는 거부 (임의 설정 주입 차단)", () => {
    expect(isSettingKey("ARBITRARY_KEY")).toBe(false);
    expect(isSettingKey("__proto__")).toBe(false);
  });
  it("모든 SETTING_KEYS에 검증자 존재", () => {
    for (const k of SETTING_KEYS) {
      expect(typeof VALIDATORS[k]).toBe("function");
    }
  });
  it("clearable 키는 SETTING_KEYS의 부분집합", () => {
    for (const k of CLEARABLE_KEYS) {
      expect(CLEARABLE_SET.has(k)).toBe(true);
      expect(isSettingKey(k)).toBe(true);
    }
    // 홀드·환율은 clear 불가 (필수 운영값)
    expect(CLEARABLE_SET.has("HOLD_HOURS_DEFAULT")).toBe(false);
    expect(CLEARABLE_SET.has("FX_VND_PER_KRW")).toBe(false);
  });
});

describe("BANK_NAME / BANK_ACCOUNT_HOLDER (텍스트 1~100)", () => {
  it("정상", () => {
    expect(VALIDATORS[BANK_NAME_KEY]("국민은행")).toBe(true);
  });
  it("100자 초과 거부", () => {
    expect(VALIDATORS[BANK_NAME_KEY]("a".repeat(101))).toBe(false);
  });
});

describe("BANK_ACCOUNT_NUMBER (숫자·하이픈·공백, 숫자 시작)", () => {
  it.each(["123456-04-567890", "1234567890", "110 220 330"])("정상: %s", (v) => {
    expect(VALIDATORS[BANK_ACCOUNT_NUMBER_KEY](v)).toBe(true);
  });
  it.each(["", "abc123", "-123456", "010-가나-다라"])("거부: %s", (v) => {
    expect(VALIDATORS[BANK_ACCOUNT_NUMBER_KEY](v)).toBe(false);
  });
});

describe("베트남(VND) 계좌 키 — 한국 계좌와 동일 규칙·화이트리스트 등록", () => {
  it("VN 키 모두 등록·clearable", () => {
    for (const k of [BANK_VN_NAME_KEY, BANK_VN_ACCOUNT_NUMBER_KEY, BANK_VN_ACCOUNT_HOLDER_KEY]) {
      expect(isSettingKey(k)).toBe(true);
      expect(CLEARABLE_SET.has(k)).toBe(true);
    }
  });
  it("VN 은행명·예금주 텍스트 1~100", () => {
    expect(VALIDATORS[BANK_VN_NAME_KEY]("Vietcombank")).toBe(true);
    expect(VALIDATORS[BANK_VN_ACCOUNT_HOLDER_KEY]("NGUYEN VAN A")).toBe(true);
    expect(VALIDATORS[BANK_VN_NAME_KEY]("a".repeat(101))).toBe(false);
  });
  it("VN 계좌번호 숫자·하이픈·공백", () => {
    expect(VALIDATORS[BANK_VN_ACCOUNT_NUMBER_KEY]("0123456789")).toBe(true);
    expect(VALIDATORS[BANK_VN_ACCOUNT_NUMBER_KEY]("")).toBe(false);
    expect(VALIDATORS[BANK_VN_ACCOUNT_NUMBER_KEY]("abc")).toBe(false);
  });
});

describe("CONTACT_KAKAO_URL (http(s) URL만)", () => {
  it.each(["https://open.kakao.com/o/villapms", "http://example.com"])("정상: %s", (v) => {
    expect(VALIDATORS[CONTACT_KAKAO_URL_KEY](v)).toBe(true);
  });
  it.each(["javascript:alert(1)", "open.kakao.com/o/x", "ftp://x", "not a url"])(
    "거부: %s",
    (v) => {
      expect(VALIDATORS[CONTACT_KAKAO_URL_KEY](v)).toBe(false);
    }
  );
  it("300자 초과 거부", () => {
    expect(VALIDATORS[CONTACT_KAKAO_URL_KEY]("https://x.com/" + "a".repeat(300))).toBe(false);
  });
});

describe("CONTACT_ZALO_URL (http(s) URL만)", () => {
  it.each(["https://zalo.me/0791234567", "http://example.com"])("정상: %s", (v) => {
    expect(VALIDATORS[CONTACT_ZALO_URL_KEY](v)).toBe(true);
  });
  it.each(["javascript:alert(1)", "zalo.me/x", "ftp://x", "not a url"])("거부: %s", (v) => {
    expect(VALIDATORS[CONTACT_ZALO_URL_KEY](v)).toBe(false);
  });
  it("300자 초과 거부", () => {
    expect(VALIDATORS[CONTACT_ZALO_URL_KEY]("https://x.com/" + "a".repeat(300))).toBe(false);
  });
  it("clearable 등록(비우면 삭제)", () => {
    expect(CLEARABLE_SET.has(CONTACT_ZALO_URL_KEY)).toBe(true);
    expect(isSettingKey(CONTACT_ZALO_URL_KEY)).toBe(true);
  });
});

describe("CONTACT_PHONE (전화 형식)", () => {
  it.each(["010-1234-5678", "+84 90 123 4567", "(028) 1234 5678"])("정상: %s", (v) => {
    expect(VALIDATORS[CONTACT_PHONE_KEY](v)).toBe(true);
  });
  it.each(["", "phone-number", "전화번호"])("거부: %s", (v) => {
    expect(VALIDATORS[CONTACT_PHONE_KEY](v)).toBe(false);
  });
});

describe("Zalo 연결 온보딩 키 — 화이트리스트·clearable 등록", () => {
  it("2키 모두 등록·clearable (비우면 env 폴백)", () => {
    for (const k of [ZALO_CONNECT_QR_URL_KEY, ZALO_CONNECT_OA_URL_KEY]) {
      expect(isSettingKey(k)).toBe(true);
      expect(CLEARABLE_SET.has(k)).toBe(true);
    }
  });
});

describe("ZALO_CONNECT_OA_URL (https:// 스킴만)", () => {
  it.each(["https://zalo.me/0799493138", "https://zalo.me/g/abcdef"])("정상: %s", (v) => {
    expect(VALIDATORS[ZALO_CONNECT_OA_URL_KEY](v)).toBe(true);
  });
  it.each([
    "javascript:alert(1)",
    "data:text/html,x",
    "http://zalo.me/0799493138",
    "//evil.com/zalo",
    "zalo.me/0799493138",
    "not a url",
  ])("거부: %s", (v) => {
    expect(VALIDATORS[ZALO_CONNECT_OA_URL_KEY](v)).toBe(false);
  });
  it("501자 초과 거부", () => {
    expect(VALIDATORS[ZALO_CONNECT_OA_URL_KEY]("https://zalo.me/" + "a".repeat(486))).toBe(false);
  });
});

describe("ZALO_CONNECT_QR_URL (/uploads/… 상대경로 또는 https://)", () => {
  it.each([
    "/uploads/abc123.png",
    "/uploads/2026/07/zalo-qr.jpg",
    "https://cdn.example.com/qr.png",
  ])("정상: %s", (v) => {
    expect(VALIDATORS[ZALO_CONNECT_QR_URL_KEY](v)).toBe(true);
  });
  it.each([
    "http://cdn.example.com/qr.png",
    "javascript:alert(1)",
    "data:image/png;base64,AAAA",
    "uploads/abc.png",
    "//evil.com/qr.png",
    "/etc/passwd",
    "not a url",
  ])("거부: %s", (v) => {
    expect(VALIDATORS[ZALO_CONNECT_QR_URL_KEY](v)).toBe(false);
  });
  it("501자 초과 거부", () => {
    expect(VALIDATORS[ZALO_CONNECT_QR_URL_KEY]("https://x.com/" + "a".repeat(490))).toBe(false);
  });
});

describe("기존 키 회귀 (홀드·환율)", () => {
  it("HOLD_HOURS_DEFAULT 1~168 정수", () => {
    expect(VALIDATORS["HOLD_HOURS_DEFAULT"]("48")).toBe(true);
    expect(VALIDATORS["HOLD_HOURS_DEFAULT"]("0")).toBe(false);
    expect(VALIDATORS["HOLD_HOURS_DEFAULT"]("169")).toBe(false);
    expect(VALIDATORS["HOLD_HOURS_DEFAULT"]("12.5")).toBe(false);
  });
  it("FX_VND_PER_KRW 양수 소수 4자리", () => {
    expect(VALIDATORS["FX_VND_PER_KRW"]("18.87")).toBe(true);
    expect(VALIDATORS["FX_VND_PER_KRW"]("0")).toBe(false);
    expect(VALIDATORS["FX_VND_PER_KRW"]("1.23456")).toBe(false);
  });
});

describe("FX_VND_PER_USD — USD 수동 환율 (후속확장 3)", () => {
  it("화이트리스트 등록·비-clearable", () => {
    expect(isSettingKey("FX_VND_PER_USD")).toBe(true);
    expect(CLEARABLE_SET.has("FX_VND_PER_USD")).toBe(false); // 필수 운영값
  });
  it.each(["26000", "25400.5", "26000.1234", "1"])("정상: %s", (v) => {
    expect(VALIDATORS["FX_VND_PER_USD"](v)).toBe(true);
  });
  it.each(["0", "0.0000", "-1", "1.23456", "abc", "1000000000"])("거부: %s", (v) => {
    expect(VALIDATORS["FX_VND_PER_USD"](v)).toBe(false); // 1e9 상한 포함
  });
});

describe("FX_MODE — 유효 환율 모드 (후속확장 3)", () => {
  it("화이트리스트 등록·비-clearable", () => {
    expect(isSettingKey("FX_MODE")).toBe(true);
    expect(CLEARABLE_SET.has("FX_MODE")).toBe(false);
  });
  it("MANUAL·AUTO만 허용", () => {
    expect(VALIDATORS["FX_MODE"]("MANUAL")).toBe(true);
    expect(VALIDATORS["FX_MODE"]("AUTO")).toBe(true);
  });
  it.each(["manual", "auto", "", "ON", "true", "1"])("거부: %s", (v) => {
    expect(VALIDATORS["FX_MODE"](v)).toBe(false);
  });
});
