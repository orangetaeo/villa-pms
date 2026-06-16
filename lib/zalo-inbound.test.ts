// S3 수신 파싱 순수 함수 단위 테스트 (ADR-0006 S3) — DB·zca-js 의존 없음
import { describe, expect, it } from "vitest";
import {
  extractText,
  isPhoneLike,
  extractPhone,
  isEchoMessage,
  isSelfMessage,
  parseZaloTs,
  buildInboundKey,
} from "./zalo-inbound";

describe("extractText", () => {
  it("문자열 content는 그대로", () => {
    expect(extractText("Xin chào")).toBe("Xin chào");
  });

  it("객체 content는 title/description/msg 우선 추출", () => {
    expect(extractText({ title: "T" })).toBe("T");
    expect(extractText({ description: "D" })).toBe("D");
    expect(extractText({ msg: "M" })).toBe("M");
  });

  it("추출 불가(빈 객체·null·숫자)는 빈 문자열", () => {
    expect(extractText({})).toBe("");
    expect(extractText(null)).toBe("");
    expect(extractText(123)).toBe("");
  });
});

describe("extractPhone / isPhoneLike — 전화번호 추출 (T3.7)", () => {
  it("베트남 로컬 번호 그대로", () => {
    expect(extractPhone("0901234567")).toBe("0901234567");
    expect(isPhoneLike("0901234567")).toBe(true);
  });

  it("하이픈·공백·점·괄호 정규화", () => {
    expect(extractPhone("090-123-4567")).toBe("0901234567");
    expect(extractPhone("090 123 4567")).toBe("0901234567");
    expect(extractPhone("(090) 123.4567")).toBe("0901234567");
  });

  it("+84 / 0084 / 84 국가코드 → 0 로컬 표기로 환원", () => {
    expect(extractPhone("+84901234567")).toBe("0901234567");
    expect(extractPhone("0084901234567")).toBe("0901234567");
    expect(extractPhone("84901234567")).toBe("0901234567");
  });

  it("번호 외 잡문이 섞이면 매칭 안 함(과매칭 방지)", () => {
    expect(extractPhone("제 번호는 0901234567 입니다")).toBeNull();
    expect(extractPhone("Xin chào")).toBeNull();
    expect(isPhoneLike("Xin chào")).toBe(false);
  });

  it("길이 범위 밖(너무 짧거나 긴)은 null", () => {
    expect(extractPhone("12345")).toBeNull();
    expect(extractPhone("1234567890123456")).toBeNull();
  });

  it("빈 값·비문자열 안전", () => {
    expect(extractPhone("")).toBeNull();
    expect(extractPhone("   ")).toBeNull();
    expect(extractPhone(undefined as unknown as string)).toBeNull();
  });
});

describe("isSelfMessage — 본인 발신 판정(OUTBOUND 분기)", () => {
  it("isSelf=true는 본인 발신", () => {
    expect(isSelfMessage({ isSelf: true, senderId: "x" }, "bot1")).toBe(true);
  });

  it("발신자 id가 봇 ownId와 일치하면 본인 발신", () => {
    expect(isSelfMessage({ isSelf: false, senderId: "bot1" }, "bot1")).toBe(true);
  });

  it("상대 발신(다른 id, isSelf 아님)은 본인 발신 아님(INBOUND)", () => {
    expect(isSelfMessage({ isSelf: false, senderId: "supplier1" }, "bot1")).toBe(false);
  });

  it("봇 ownId 미상(null)이면 senderId 비교 생략 — isSelf만 신뢰", () => {
    expect(isSelfMessage({ isSelf: false, senderId: "bot1" }, null)).toBe(false);
    expect(isSelfMessage({ isSelf: true, senderId: "bot1" }, null)).toBe(true);
  });

  it("isEchoMessage 별칭은 isSelfMessage와 동일", () => {
    expect(isEchoMessage).toBe(isSelfMessage);
    expect(isEchoMessage({ isSelf: true, senderId: "x" }, "bot1")).toBe(true);
  });
});

describe("parseZaloTs — zca-js 타임스탬프 → Date(정렬 보존)", () => {
  it("ms epoch 문자열을 Date로", () => {
    const d = parseZaloTs("1718506800000");
    expect(d).toBeInstanceOf(Date);
    expect(d!.getTime()).toBe(1718506800000);
  });

  it("ms epoch 숫자도 처리", () => {
    expect(parseZaloTs(1718506800000)!.getTime()).toBe(1718506800000);
  });

  it("없거나 비정상(빈문자열·0·음수·NaN)이면 null → 호출부에서 now", () => {
    expect(parseZaloTs("")).toBeNull();
    expect(parseZaloTs(undefined)).toBeNull();
    expect(parseZaloTs(0)).toBeNull();
    expect(parseZaloTs(-1)).toBeNull();
    expect(parseZaloTs("abc")).toBeNull();
  });
});

describe("buildInboundKey — 멱등 키(zaloMsgId)", () => {
  it("문자열 msgId 그대로", () => {
    expect(buildInboundKey({ msgId: "abc123" })).toBe("abc123");
  });

  it("숫자 msgId는 문자열화", () => {
    expect(buildInboundKey({ msgId: 987654321 })).toBe("987654321");
  });

  it("없거나 빈 값은 null(멱등 불가)", () => {
    expect(buildInboundKey({})).toBeNull();
    expect(buildInboundKey({ msgId: "" })).toBeNull();
    expect(buildInboundKey({ msgId: undefined })).toBeNull();
  });
});
