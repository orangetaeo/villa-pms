// ADR-0009 S0 — 백필/분류 로직 (inferCounterpartyType / defaultTranslateMode)
import { describe, expect, it } from "vitest";
import {
  defaultTranslateMode,
  inferCounterpartyType,
} from "@/lib/zalo-counterparty";

describe("inferCounterpartyType — 기존 대화 상대타입 백필 (D1.5)", () => {
  it("userId 매칭됨 → SUPPLIER", () => {
    expect(inferCounterpartyType(true)).toBe("SUPPLIER");
  });
  it("userId 없음(미매칭) → UNKNOWN (공유 잠금 — 보수적)", () => {
    expect(inferCounterpartyType(false)).toBe("UNKNOWN");
  });
});

describe("defaultTranslateMode — 상대타입 → 기본 번역모드 (D7.3)", () => {
  it("SUPPLIER → VI (베트남인 전제)", () => {
    expect(defaultTranslateMode("SUPPLIER")).toBe("VI");
  });
  it("CUSTOMER → OFF (오버트랜슬레이션 방지)", () => {
    expect(defaultTranslateMode("CUSTOMER")).toBe("OFF");
  });
  it("UNKNOWN → OFF", () => {
    expect(defaultTranslateMode("UNKNOWN")).toBe("OFF");
  });
});
